# Factory Map — Architecture Documentation

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Browser (React 18 SPA)                        │
│                                                                    │
│  AuthContext  → JWT in localStorage → axios interceptor           │
│  ThemeContext (light/dark, persisted)                             │
│  ToastContext (app-wide notifications)                            │
│                                                                    │
│  Pages: Dashboard | Buildings | FloorDetails | MapView            │
│         Maintenance | Alerts | Network | UnplacedAssets           │
│         Reports | AuditLog | Settings | UserManagement            │
│                                                                    │
│  socket.io-client → live asset:created / updated / deleted        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP REST + WebSocket (same port)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Node.js / Express Backend  (port 4000)               │
│                                                                    │
│  Middleware:  helmet | cors | morgan | express-rate-limit         │
│  JWT authenticate (all /api/* except /auth)                       │
│  auditLog middleware wraps POST / PATCH / DELETE                  │
│                                                                    │
│  Routes → Controllers → TypeORM Repositories                      │
│                                                                    │
│  Services:                                                         │
│    AlertService  — email (nodemailer) + Teams (webhook fetch)     │
│    ITSMService   — adapter pattern: MockAdapter | RealAdapter     │
│    LdapAuthService — optional Active Directory login              │
│    SyncService   — ITSM → DB reconciliation (create/update/snap) │
│                                                                    │
│  Swagger UI at /api/docs  (swagger-jsdoc + swagger-ui-express)   │
│  node-cron  — 07:00 daily → AlertService.checkAndSend()          │
│  socket.io  — emits asset:created / updated / deleted             │
└──────────────────────────┬───────────────────────────────────────┘
                           │ TDS protocol (TCP 1433)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│           Microsoft SQL Server 2022 (Docker container)            │
│           Database: factorymap                                     │
│                                                                    │
│  buildings | floors | work_areas | sections | workstations        │
│  assets | asset_software | asset_connections                      │
│  network_rooms | network_racks | patch_panels | wall_ports        │
│  alert_config | alert_logs | scheduled_alerts                     │
│  users | active_sessions | audit_logs                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Entity hierarchy

```
Building (1)
  └── Floor (N)
        └── WorkArea (N)
              └── Section (N)
                    └── Workstation (N)

Asset (N) — FK columns reference any level of the hierarchy
  ├── AssetSoftware (N)    — CASCADE DELETE
  ├── AssetConnection (N)  — CASCADE DELETE (also removes reverse connection)
  └── AuditLog entries     — stored via document_id; no FK constraint

AlertConfig (1 row, id = 'global') — email + Teams alert configuration
AlertLog    (append-only)          — history of every sent alert
User        (N)                    — local + LDAP-provisioned accounts
```

### Key entity columns

#### Asset

| Group | Columns |
|-------|---------|
| Identity | `id` (UUID), `display_name`, `asset_tag`, `serial_number` |
| Type / status | `asset_type`, `status` (`active` / `maintenance` / `inactive` / `retired`) |
| Hardware | `manufacturer`, `model`, `cpu`, `ram`, `storage`, `gpu`, `mac_address` |
| Network | `ip_address`, `hostname`, `vlan`, `switch_port`, `dhcp_static` |
| OS | `os_type`, `os_version` |
| Location | `building_id`, `floor_id`, `workarea_id`, `section_id`, `workstation_id`, `loc_x`, `loc_y`, `loc_rotation`, `loc_icon_type`, `loc_history` (JSON) |
| Person | `person_id`, `person_full_name` |
| ITSM | `itsm_guid`, `hardware_asset_id`, `source_of_truth` (`local` / `itsm`), `sync_status`, `itsm_snapshot` |
| Maintenance | `maint_last_date`, `maint_next_date`, `maint_interval_days`, `maint_notes` |
| Operational | `remote_access_tool`, `backup_tool`, `backup_status`, `fortiedr_active`, `winupdate_date` |
| Custom | `environment`, `notes`, `tags` (JSON), `object_id`, `serial_object` |
| Work items | `work_items` (JSON array: `{id, description, done, priority, created_at}`) |
| Lifecycle | `predecessor_id`, `successor_id` — replacement chain |

#### AssetConnection

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | |
| `asset_id` | UUID FK | Source asset |
| `connected_asset_id` | UUID FK | Target asset |
| `connection_type` | string | `Ethernet`, `WiFi`, `USB`, `Fiber`, etc. |
| `label` | string | Short description |
| `bidirectional` | bool | Whether the reverse connection also exists |
| `strength` | int | Signal/link strength (1–5) |
| `patch_panel_name/port` | string | Patch panel routing |
| `switch_name/port` | string | Switch routing |

#### AlertConfig

Single-row table (id = `'global'`):

| Column | Notes |
|--------|-------|
| `email_enabled`, `email_recipients` | Comma-separated list of recipient addresses |
| `teams_enabled`, `teams_webhook_url` | Teams incoming webhook |
| `days_before_alert` | Alert N days before `maint_next_date` (default 7) |
| `alert_on_maintenance`, `alert_on_overdue` | Which conditions trigger an alert |

---

## Design Patterns

### 1. Adapter Pattern — ITSM integration

`ITSMService` is a singleton that picks `MockITSMAdapter` or `RealITSMAdapter` at startup based on `ITSM_MODE`. All callers depend only on the `IITSMAdapter` interface.

```typescript
// backend/src/services/itsm/IITSMAdapter.ts
interface IITSMAdapter {
  searchHardware(query: string): Promise<IITSMHardware[]>;
  getHardwareById(id: string): Promise<IITSMHardware>;
  syncAll(): Promise<IITSMSyncResult>;
}
```

### 2. `toApiResponse()` — flat SQL ↔ nested JSON

Every entity exposes `toApiResponse()` which maps flat SQL columns to the nested JSON shape the frontend expects. Frontend code never reads raw column names — it always reads the API shape.

```typescript
// entity stores flat columns:
asset.ip_address, asset.person_full_name, asset.maint_next_date

// toApiResponse() reconstructs:
{ network: { ip_address }, assigned_person: { full_name }, maintenance: { next_date } }
```

### 3. Response envelope

All endpoints return `{ success: boolean, data: ... }` on success and `{ success: false, error: string }` on failure.

### 4. Audit middleware chain

```
POST/PATCH/DELETE request
  → captureAuditBefore(Entity)   — snapshots the pre-change row
  → controller handler           — mutates + saves the entity
  → auditLog('entity_type')      — wraps res.json; writes AuditLog row with diff on response finish
```

### 5. Global search — client-side inverted index

`searchIndex.ts` builds a prefix-token inverted index over all loaded assets on the client. `GlobalSearch.tsx` (opened via the header search button or Ctrl+K) queries this index — no server round-trip after initial load.

### 6. Custom DOM event bus

`Header.tsx` dispatches `new CustomEvent('app:new-asset')` on Ctrl+N. `Dashboard.tsx` listens for this event and opens the asset creation modal. This avoids threading state or callbacks through the component tree.

---

## Authentication & Authorization

### JWT flow

1. `POST /api/auth/login` → returns `{ token, user }`
2. Token stored in `localStorage`; axios interceptor attaches `Authorization: Bearer <token>` on every request
3. Token lifetime: **8 hours**; auto-refreshed at 75% of lifetime by `AuthContext` timer
4. Axios interceptor also proactively calls `POST /api/auth/refresh` if the token expires within 5 minutes (deduplicated via `refreshPromise`)
5. On 401 → clear storage → redirect to `/login`

### Roles

| Role | Capabilities |
|------|-------------|
| `viewer` | Read-only: browse assets, maps, audit log, reports |
| `operator` | viewer + create/edit assets, connections, floor plans, hierarchy |
| `admin` | operator + user management, delete buildings/floors, alert config |

### Optional LDAP

`LdapAuthService` binds to the configured LDAP server, searches for the user, then verifies credentials with a second bind. On first login the user is auto-provisioned in `users` with `role = LDAP_DEFAULT_ROLE`.

---

## Maintenance Alerts

`AlertService.checkAndSend()` is called by node-cron at **07:00 every day**. It:

1. Fetches the `AlertConfig` row (or creates a default one)
2. Queries assets where `maint_next_date` is overdue or within `days_before_alert` days
3. If `email_enabled`: sends a single email via nodemailer listing all affected assets
4. If `teams_enabled`: POSTs an Adaptive Card JSON payload to the Teams webhook URL
5. Writes an `AlertLog` row for each channel (success/failure + body snippet)

Admins can trigger an immediate check via `POST /api/alerts/test` or configure all settings at `/alerts` in the UI.

---

## Real-Time Updates

Socket.io is mounted on the same HTTP server as Express. Asset controllers emit events after each mutation:

```typescript
io.emit('asset:created', asset.toApiResponse());
io.emit('asset:updated', asset.toApiResponse());
io.emit('asset:deleted', { _id: req.params.id });
```

Frontend components subscribe via `useSocket(event, handler)`, a shared module-level singleton that ensures only one socket connection exists per browser tab.

---

## API Documentation

Interactive Swagger UI is available at **`http://localhost:4000/api/docs`** (or `/api/docs.json` for the raw OpenAPI spec). All endpoints require Bearer auth except `/api/auth/*`. The spec is generated from `@swagger` JSDoc annotations in route and controller files by `swagger-jsdoc`.

---

## Testing

### Backend

- **Framework**: Jest + Supertest
- **Test suites** (20): `auth.test.ts`, `auth.extended.test.ts`, `auth.lockout.test.ts`, `session-revocation.test.ts`, `assets.test.ts`, `asset-connections.test.ts`, `asset-extras.test.ts`, `assets-filtering.test.ts`, `buildings.test.ts`, `floors.test.ts`, `workareas.test.ts`, `sections.test.ts`, `workstations.test.ts`, `network.test.ts`, `audit.test.ts`, `itsm.test.ts`, `users.test.ts`, `rbac.test.ts`, `alerts.test.ts`, `error-handling.test.ts`
- **DB**: tests run against the same Docker MSSQL instance; suites truncate relevant tables in `beforeAll`
- **Isolation**: `--runInBand` (sequential) prevents cross-suite DB state conflicts
- **Port conflict prevention**: `NODE_ENV=test` is set via `setupFiles` (before any module import) so `server.ts` skips `startServer()` during tests

```bash
docker exec factory-map-backend npm test
# script: jest --runInBand --forceExit --passWithNoTests
```

### Frontend

- **Framework**: React Testing Library + MSW (Mock Service Worker) for API mocking
- **Test suites** (15): `Alerts`, `AssetDetails`, `AssetFormModal`, `AssetReports`, `AuditLog`, `BuildingDetails`, `CommandPalette`, `Dashboard`, `GlobalSearch`, `Login`, `Maintenance`, `MapView`, `NetworkInfrastructure`, `Settings`, `UserManagement`
- **MSW handlers**: `src/mocks/handlers.ts` + `src/mocks/server.ts`

```bash
cd frontend && npm test -- --watchAll=false
```

### E2E (Playwright)

- **Framework**: `@playwright/test`
- **Config**: `playwright.config.ts` — `baseURL: http://localhost:5174`, `workers: 1`, `retries: 1`
- **Auth**: `globalSetup` logs in once and saves session to `e2e/.auth/user.json`; test files inherit `storageState` so only auth tests use a fresh session
- **Test suites** (12): `auth.spec.ts`, `buildings.spec.ts`, `assets.spec.ts`, `asset-detail.spec.ts`, `map.spec.ts`, `dashboard.spec.ts`, `alerts.spec.ts`, `audit.spec.ts`, `maintenance.spec.ts`, `network.spec.ts`, `reports.spec.ts`, `settings.spec.ts`

```bash
# Requires the full stack running (frontend on 5174, backend on 4000)
npx playwright test
npx playwright test --ui     # Interactive Playwright UI
```

---

## Security Headers

`helmet` sets automatically:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (in production)
- `Content-Security-Policy`

Login is rate-limited via `express-rate-limit`:
- **Production** (`NODE_ENV=production`): **20 requests / 15 minutes per IP**
- **Development**: **200 requests / 15 minutes per IP** (relaxed to prevent test suite lock-outs)

Account lockout kicks in after **5 failed login attempts** (30-minute lockout, independent of rate limiting).
