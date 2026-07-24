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
│                    (Real = Alemba/Operaio View API, READ-ONLY)    │
│    LdapAuthService — optional Active Directory login              │
│    SyncService   — ITSM → DB import (create/update/snapshot)      │
│    ReconcileService — per-asset read-only diff vs ITSM +          │
│                    per-field accept/ignore/unlink (local writes)  │
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
  ├── predecessor_id / successor_id — soft self-join, replacement lifecycle
  ├── master_ifs_id     — soft join → MasterAsset (IFS/CMDB, read-only)
  ├── entity_kind        — soft join → EntityKind (map-render config)
  ├── rack_id / u_position — soft join → NetworkRack (rack-mounted assets)
  └── AuditLog entries     — stored via document_id; no FK constraint

NetworkRoom (N) — building_id (FK), floor_id (soft join)
  └── NetworkRack (N) — real FK, CASCADE
        └── PatchPanel (N) — real FK, CASCADE
              └── WallPort (N) — real FK (SET NULL); floor_id/switch_asset_id soft joins

ProductionLine (N) ← WorkArea.production_line_code, WorkCenter.production_line_code (soft joins)
WorkCenter (N)     ← Section.workcenter_code (soft join)

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
| Reconcile | `reconcile_ignored` (JSON: per-field ignores, valid while ITSM value unchanged), `reconcile_last_at`, `reconcile_last_status` (`in_sync` / `differences` / `missing` / `error`), `reconcile_diff_count` |
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

#### Network Infrastructure — NetworkRoom → NetworkRack → PatchPanel → WallPort

A separate hierarchy from the spatial Building/Floor tree, modeling the
physical wiring closets, not map-placeable objects (except `WallPort`, which
has `pos_x`/`pos_y` and appears on the floor map):

| Entity | Key columns | Relation to parent |
|--------|-------------|---------------------|
| `NetworkRoom` | `name`, `type` (`idf`/`mdf`), `building_id`, `floor_id` (nullable), `description`, `redundant_pair_id` | `building_id` required, real FK; `floor_id` optional, soft join |
| `NetworkRack` | `name`, `network_room_id`, `u_count`, `description` | real FK to `NetworkRoom`, `onDelete: CASCADE` |
| `PatchPanel` | `name`, `rack_id`, `u_position`, `port_count`, `cable_type`, `description` | real FK to `NetworkRack`, `onDelete: CASCADE` |
| `WallPort` | `label`, `floor_id`, `pos_x`/`pos_y`, `patch_panel_id`, `patch_port`, `switch_asset_id`, `switch_port`, `description` | `patch_panel_id` real FK (`onDelete: SET NULL`); `floor_id`/`switch_asset_id` soft joins (no FK) |

`Asset.rack_id`/`u_position`/`rack_u_size` is a **soft join** from the Asset
side into `NetworkRack` — a rack-mounted asset (server, switch) references
its rack without a matching FK back, mirroring every other soft-join
convention in this schema.

**Guarded deletion** (added to close orphan gaps found during a live-use-case
audit): `deleteRack`/`deleteRoom` block with 400 if any `Asset.rack_id` still
points into the rack (or, for a room, into any of its racks) — the real FK
cascade would otherwise silently delete the rack/room out from under a
still-mounted asset. `deleteFloor`/`deleteBuilding` likewise block if any
`NetworkRoom`/`WallPort` still references them — `deleteBuilding`'s own
hierarchy cascade deletes floors directly via the repository, bypassing
`deleteFloor`'s guards, so it re-checks the same conditions itself rather
than relying on the other controller's logic.

**Collision guards**: two `WallPort`s cannot share the same
(`patch_panel_id`, `patch_port`) or the same (`switch_asset_id`,
`switch_port`) — a physical port can only terminate one cable
(`findWallPortCollision` in `network.controller.ts`). Same principle as the
pre-existing rack U-position collision check on `Asset` (`findRackCollision`
in `asset.controller.ts`).

**Physical-swap "replace" endpoints** (`POST /network/racks/:id/replace`,
`POST /network/patch-panels/:id/replace`, mirroring the pre-existing
`POST /assets/:id/replace`): when a cabinet or patch panel is physically
swapped, this moves everything it held — mounted assets and patch panels for
a rack, wired wall ports for a panel — to the replacement in one step
(keeping U-positions/port numbers), rejects with 409 if that would collide
with something already in the replacement, then removes the now-empty old
shell. Unlike `Asset` (which keeps `predecessor_id`/`successor_id` for
history), `NetworkRack`/`PatchPanel` have no identity fields worth preserving,
so the old row is simply deleted once empty rather than retained.

#### Master data & organizational hierarchy — MasterAsset, ProductionLine, WorkCenter, EntityKind

Added to align factorymap's model with shopfloor_visualizer's IFS-primary
approach (see `docs/DATA_MODEL_MIGRATION.md` for the full phase-by-phase
history) — all are **soft joins**, so a reference that stops resolving
(a re-import drops a row, a code is retyped) never cascades into deleting the
asset/work area/section that pointed at it:

| Entity | Key columns | Referenced (soft join) from |
|--------|-------------|------------------------------|
| `MasterAsset` | `ifs_id` (PK-like unique), `ifs_site`, `ifs_production_line_id`, `ifs_workcenter_id`, `ifs_machine_id`, `cmdb_id`, `cmdb_status`, … | `Asset.master_ifs_id` |
| `ProductionLine` | `code` (PK), `description` | `WorkArea.production_line_code`, `WorkCenter.production_line_code` |
| `WorkCenter` | `code` (PK), `description`, `production_line_code` | `Section.workcenter_code` |
| `EntityKind` | `value` (PK), `label`, `geometry_type`, `default_color`, `rotatable`, `exempt_from_orphan`, `footprint` (polygon) | `Asset.entity_kind` |

`GET /assets/:id` always resolves `master` (null if the join target is
missing — the **orphaned** case surfaced on the dedicated Orphaned Assets
page); `GET /assets?include_master=true` batches the same resolution for
lists. `entity_kind` drives a map-marker color/rotatable-badge fallback only
when the asset's own status-based color logic has nothing more specific to
say — it never overrides a real status color.

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
  getHardware(hardwareId: string): Promise<IITSMHardware>;
  searchHardware(query: string): Promise<IITSMHardware[]>;
  getPerson(personId: string): Promise<IITSMPerson>;
  getSoftware(softwareId: string): Promise<IITSMSoftware>;
  getTicketsByHardware(hardwareId: string): Promise<IITSMTicket[]>;
  syncAsset(hardwareId: string): Promise<IITSMSyncResult>;
  syncAll(): Promise<IITSMHardware[]>;
  buildTicketUrl(ticketId: string): string;
}
```

`RealITSMAdapter` targets the **Alemba / Operaio Service Manager View API**
(`GET {base}/api/ViewAPI/GetViewData/{ITSM_VIEW_ID}`) — the same endpoint the ITSM
web UI uses. Lookups are server-side filtered so a single-asset query never pulls
the whole catalogue. Column captions vary per tenant, so the canonical-field →
caption mapping lives in a `COLUMN_MAP` table that can be overridden without a
code change via the `ITSM_COLUMN_MAP` env var (JSON). **The adapter only ever
issues GET requests — nothing is written back to ITSM.**

### 1b. Read-only reconciliation — `ReconcileService`

ITSM is the single source of truth. The reconcile flow compares one local asset
at a time against ITSM (exactly one GET, on explicit user action — no bulk pulls,
no scheduled sync) and reports per-field differences. The user resolves each
difference individually:

| Action | Endpoint | Effect |
|--------|----------|--------|
| Check | `POST /api/itsm/reconcile/:id/check` | The only call that reads ITSM; stores a small result summary locally |
| Accept | `PATCH /api/itsm/reconcile/:id/accept` `{fields}` | Copies the chosen ITSM values into the **local** record |
| Ignore | `PATCH /api/itsm/reconcile/:id/ignore` `{field, itsm_value}` | Persists the ignore; resurfaces automatically if ITSM's value changes |
| Un-ignore | `PATCH /api/itsm/reconcile/:id/unignore/:field` | Field is compared again |
| Unlink | `PATCH /api/itsm/reconcile/:id/unlink` | Clears the local ITSM link (for records deleted from ITSM) |
| List / summary | `GET /api/itsm/reconcile/linked`, `GET /api/itsm/reconcile/summary` | Built from the local DB only — never call ITSM |

The comparable fields are declared in one table (`RECONCILE_FIELDS`) that drives
the diff, the accept write-back and the UI. Status values map through
`statusMapping.ts` (`Deployed⇄active`, `In Stock⇄inactive`, …) and MAC addresses
are normalised (`AA-BB-…` == `aa:bb:…`) so formatting differences are not flagged.
All reconcile writes go through the audit middleware (`captureAuditBefore` +
`auditLog`).

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

`searchIndex.ts` builds a prefix-token inverted index over all loaded assets on the client. `GlobalSearch.tsx` (Ctrl+K) queries this index — no server round-trip after initial load.

### 6. Custom DOM event bus

`Header.tsx` dispatches `new CustomEvent('app:new-asset')` on Ctrl+N. `Dashboard.tsx` listens for this event and opens the asset creation modal. This avoids threading state or callbacks through the component tree.

### 7. Soft-join guarded deletes

Almost every parent→child reference in this schema (`Asset.floor_id`,
`Asset.rack_id`, `WallPort.patch_panel_id`'s siblings, `WorkArea.production_line_code`,
…) is a plain column with no FK/cascade, by design — it keeps a re-import or
retyped code from ever cascading into deleting real data. The cost of that
design is that TypeORM/SQL can't enforce "don't delete a parent that still
has children" for you; every parent-delete controller (`deleteBuilding`,
`deleteFloor`, `deleteWorkArea`, `deleteSection`, `deleteRack`, `deleteRoom`,
…) does its own `count()` guard against the soft-joined children and returns
400 with a specific count-bearing message instead of deleting through. When a
cascade deletes a child controller's own resource internally (e.g.
`deleteBuilding` removing `Floor` rows directly via the repository, bypassing
`deleteFloor`'s own guards), the parent's guard re-checks the grandchild
conditions itself rather than assuming the child controller's logic ran.

### 8. Lifecycle "replace" — physical swap without losing wiring

`POST /assets/:id/replace`, `POST /network/racks/:id/replace`, and
`POST /network/patch-panels/:id/replace` all follow the same shape: given a
`replacement_id`, move everything the old row held (position, hierarchy,
connections, mounted children, wired ports — whatever is soft-joined to it)
onto the replacement, reject with 409 on any collision that transfer would
create, then dispose of the old row (for `Asset`, "dispose" means clear to
unplaced and keep it via `predecessor_id`/`successor_id` for audit history;
`NetworkRack`/`PatchPanel` have no identity worth keeping, so the empty shell
is deleted outright). This is the "I swapped the physical unit" workflow,
distinct from plain delete ("I removed it and nothing replaces it").

### 9. Surfacing real API error text (`getApiErrorMessage`)

Every controller error response is `{ success: false, error: string }` with a
specific, human-readable reason (a collision, a guarded-delete count, …).
`frontend/src/utils/apiError.ts`'s `getApiErrorMessage(err, fallback)` pulls
that string out of an Axios error's `response.data.error`; UI code should
call it in every `catch` block that surfaces a toast, instead of
`err.message` (which on an Axios error is just the generic "Request failed
with status code 409" and throws away the actual reason the backend gave).

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

Enforcement is server-side (`requireOperator`/`requireAdmin` middleware on
every mutating route) — the frontend hiding a button is a UX nicety, not the
actual boundary. Verified live: a `viewer` token gets `403 Operator or admin
access required` from the API directly (not just a hidden button) on every
write/delete endpoint tried, and `403 Admin access required` on user
management, while read (`GET`) endpoints remain open to all three roles.

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
- **Test suites**: `auth.test.ts`, `assets.test.ts`, `buildings.test.ts`, `itsm.test.ts`
- **DB**: tests run against the same Docker MSSQL instance; suites truncate relevant tables in `beforeAll`
- **Isolation**: `--runInBand` (sequential) prevents cross-suite DB state conflicts
- **Port conflict prevention**: `NODE_ENV=test` is set via `setupFiles` (before any module import) so `server.ts` skips `startServer()` during tests

```bash
docker exec factory-map-backend npm test
# script: jest --runInBand --forceExit --passWithNoTests
```

### Frontend

- **Framework**: React Testing Library + MSW (Mock Service Worker) for API mocking
- **Test suites**: `GlobalSearch.test.tsx`, `AssetFormModal.test.tsx`, `Login.test.tsx`
- **MSW handlers**: `src/mocks/handlers.ts` + `src/mocks/server.ts`

```bash
cd frontend && npm test -- --watchAll=false
```

### E2E (Playwright)

- **Framework**: `@playwright/test`
- **Config**: `playwright.config.ts` — `baseURL: http://localhost:5174`, `workers: 1`, `retries: 1`
- **Auth**: `globalSetup` logs in once and saves session to `e2e/.auth/user.json`; test files inherit `storageState` so only auth tests use a fresh session
- **Test suites**: `auth.spec.ts`, `buildings.spec.ts`, `assets.spec.ts`, `map.spec.ts`, `dashboard.spec.ts`, `alerts.spec.ts`

```bash
# Requires the full stack running (frontend on 5174, backend on 4000)
npx playwright test
npx playwright test --ui     # Interactive Playwright UI
```

---

## Known Limitations

- **No optimistic concurrency control.** No entity carries a version column;
  two users editing the same record concurrently is last-write-wins (the
  second save silently overwrites the first, no conflict is surfaced). Real
  gap, not yet addressed — would need a version column + conditional update
  on every mutating endpoint to fix properly.
- **No in-app "network capacity" report** (e.g. free vs. occupied switch
  ports per floor/building) — port occupancy is only visible per-panel in the
  Network Infrastructure page, not aggregated.
- **Orphaned-asset re-link is a manual field edit**, not a guided
  search-and-relink wizard — `itsm.hardware_asset_id` (or `master_ifs_id`) can
  be retargeted through the normal asset edit form, but there is no dedicated
  "search ITSM/CMDB, pick the new record" flow on the Orphaned Assets page.

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
