# Factory Map — Developer Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
7. [Frontend Architecture](#frontend-architecture)
8. [Authentication & Authorization](#authentication--authorization)
9. [ITSM Integration](#itsm-integration)
10. [Real-Time Updates (Socket.io)](#real-time-updates)
11. [Local Development Setup](#local-development-setup)
12. [Code Conventions](#code-conventions)
13. [Adding New Features](#adding-new-features)

---

## Overview

Factory Map is a full-stack IT asset management application designed for industrial environments. It allows IT teams to:

- Maintain a **spatial map** of all IT hardware across buildings and floors
- Track **asset details** (hardware specs, network info, OS, remote access tools, backup status)
- Manage **work items** per asset (a per-asset todo/checklist for IT tasks)
- Record **asset connections** (physical or logical links between devices, including patch panel routing)
- Integrate with an **ITSM system** (IFS/other) for bidirectional hardware data sync
- Keep a full **audit log** of all create/update/delete operations
- Search assets **globally** with instant prefix-aware indexing

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                   │
│                                                              │
│  AuthContext → JWT in localStorage → axios interceptor       │
│  ThemeContext (light/dark)                                   │
│  ToastContext (notifications)                                │
│                                                              │
│  Pages: Dashboard | Buildings | FloorDetails | MapView       │
│         Maintenance | Alerts | Network | UnplacedAssets      │
│         Reports | Settings | UserManagement | AuditLog       │
│                                                              │
│  Socket.io client → live asset:created/updated/deleted       │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP + WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               Node/Express Backend (port 4000)               │
│                                                              │
│  Middleware: helmet | cors | morgan | rateLimit              │
│  JWT authenticate middleware (all /api/* except /auth)       │
│  auditLog middleware (wraps POST/PATCH/DELETE)               │
│                                                              │
│  Routes → Controllers → TypeORM Repositories                 │
│                                                              │
│  ITSMService (adapter pattern: Mock | Real)                  │
│  LdapAuthService (optional Active Directory login)           │
│                                                              │
│  Socket.io server → emits asset:created/updated/deleted      │
└────────────────────────┬─────────────────────────────────────┘
                         │ TDS protocol (TCP 1433)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               Microsoft SQL Server (Docker)                  │
│               Database: factorymap                           │
│                                                              │
│  Tables: buildings | floors | work_areas | sections          │
│          workstations | assets | asset_software              │
│          asset_connections | users | audit_logs              │
│          alert_config | alert_logs | scheduled_alerts        │
└─────────────────────────────────────────────────────────────┘
```

### Data flow (example: user edits an asset)
1. Frontend `assetService.updateAsset(id, payload)` → `PATCH /api/assets/:id`
2. `authenticate` middleware verifies JWT, attaches `req.user`
3. `captureAuditBefore(Asset)` middleware snapshots the pre-update state
4. `auditLog('asset')` middleware wraps `res.json` to capture the response
5. `updateAsset` controller applies changes, saves, emits `asset:updated` via Socket.io
6. On `res.finish`, `auditLog` writes an `AuditLog` row with diff
7. All connected browser tabs receive the Socket.io event and update their local state

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + TypeScript | Create React App |
| Frontend routing | React Router v6 | Nested routes under MainLayout |
| Frontend HTTP | axios | JWT interceptor, auto-refresh |
| Frontend styles | CSS Modules | Co-located in `src/styles/` |
| Frontend real-time | socket.io-client | Shared singleton socket |
| Backend | Node.js + Express + TypeScript | ts-node in dev, compiled in prod |
| ORM | TypeORM 0.3.x | SQL Server driver |
| Database | Microsoft SQL Server 2022 | Dockerised for dev |
| Auth | JWT (jsonwebtoken) + bcryptjs | Optional LDAP via ldapjs |
| Security | helmet, express-rate-limit | Rate limit on /auth/login |
| Real-time | socket.io | Mounted on same HTTP server |
| Dev server | nodemon | Watches backend/src |
| Container | Docker Compose | Backend + MSSQL services |

---

## Project Structure

```
factory-map/
├── backend/
│   └── src/
│       ├── config/
│       │   ├── config.ts          # All env-var driven config (DB, JWT, LDAP, ITSM, SMTP)
│       │   ├── database.ts        # TypeORM DataSource + connectDatabase()
│       │   └── swagger.ts         # swagger-jsdoc spec definition
│       ├── controllers/
│       │   ├── alert.controller.ts        # Alert config CRUD + test trigger + logs
│       │   ├── asset.controller.ts        # Full CRUD + connections + ITSM sync
│       │   ├── auth.controller.ts         # Login, logout, token refresh, LDAP
│       │   ├── building.controller.ts     # Building CRUD
│       │   ├── floor.controller.ts        # Floor CRUD + floor plan upload
│       │   ├── itsm.controller.ts         # ITSM search, sync, accept-snapshot
│       │   ├── section.controller.ts      # Section CRUD
│       │   ├── user.controller.ts         # User management (admin only)
│       │   ├── workarea.controller.ts     # WorkArea CRUD
│       │   └── workstation.controller.ts  # Workstation CRUD
│       ├── entities/
│       │   ├── AlertConfig.entity.ts      # Single-row global alert configuration
│       │   ├── AlertLog.entity.ts         # Append-only alert send history
│       │   ├── ScheduledAlert.entity.ts   # User-created one-off timed alerts
│       │   ├── Asset.entity.ts            # Main asset with toApiResponse()
│       │   ├── AssetConnection.entity.ts  # Asset-to-asset connections
│       │   ├── AssetSoftware.entity.ts    # Software installed on an asset
│       │   ├── AuditLog.entity.ts         # Immutable audit trail
│       │   ├── Building.entity.ts         # Top-level location
│       │   ├── Floor.entity.ts            # Floor within a building
│       │   ├── Section.entity.ts          # Section within a work area
│       │   ├── User.entity.ts             # App user with bcrypt password
│       │   ├── WorkArea.entity.ts         # Zone on a floor
│       │   └── Workstation.entity.ts      # Individual workstation slot
│       ├── middleware/
│       │   ├── audit.middleware.ts        # captureAuditBefore + auditLog factories
│       │   └── auth.middleware.ts         # authenticate + requireAdmin
│       ├── routes/
│       │   ├── index.ts                   # Mounts all sub-routers; applies authenticate
│       │   ├── alert.routes.ts
│       │   ├── asset.routes.ts
│       │   ├── audit.routes.ts
│       │   ├── auth.routes.ts
│       │   ├── buildings.routes.ts
│       │   ├── floors.routes.ts
│       │   ├── itsm.routes.ts
│       │   ├── sections.routes.ts
│       │   ├── user.routes.ts
│       │   ├── workareas.routes.ts
│       │   └── workstations.routes.ts
│       ├── services/
│       │   ├── alert/
│       │   │   └── AlertService.ts        # checkAndSend(), checkScheduledAlerts(), notifyWorkItem(), sendEmail(), sendTeams()
│       │   ├── auth/
│       │   │   └── LdapAuthService.ts     # LDAP bind + search, auto-provision user
│       │   └── itsm/
│       │       ├── IITSMAdapter.ts        # Interface (contract) all adapters must satisfy
│       │       ├── ITSMService.ts         # Singleton; picks Mock or Real adapter from config
│       │       ├── MockITSMAdapter.ts     # In-memory mock with 22 realistic Hungarian assets
│       │       ├── RealITSMAdapter.ts     # Stub — fill in when real ITSM API is ready
│       │       └── SyncService.ts         # runSyncAll() — ITSM → DB reconciliation
│       ├── types/
│       │   ├── api.types.ts
│       │   ├── asset.types.ts             # IAsset and all sub-interfaces
│       │   ├── hierarchy.types.ts         # IBuilding, IFloor, IWorkArea, ISection, IWorkstation
│       │   └── itsm.types.ts              # IITSMHardware, IITSMSyncResult, etc.
│       ├── utils/
│       │   └── passwordPolicy.ts          # validatePassword + constants
│       └── server.ts                      # Express bootstrap, Socket.io, daily cron (07:00) + hourly cron (scheduled alerts)
│
├── frontend/
│   └── src/
│       ├── App.tsx                        # Route tree, provider hierarchy
│       ├── contexts/
│       │   ├── AuthContext.tsx            # JWT storage, auto-refresh, role helpers
│       │   ├── ThemeContext.tsx           # Light/dark toggle, persisted to localStorage
│       │   └── ToastContext.tsx           # App-wide notification toasts
│       ├── hooks/
│       │   ├── useAssetLookups.ts         # Fetches distinct field values for autocomplete
│       │   ├── useAssets.ts               # Asset list with optional floor filter
│       │   ├── useHierarchy.ts            # Buildings + floors with reload trigger
│       │   ├── usePersonSuggestions.ts    # Extracts person list from loaded assets
│       │   └── useSocket.ts              # Shared socket singleton + typed event binding
│       ├── pages/                         # One file per route
│       ├── components/                    # Reusable and feature components
│       ├── services/                      # Thin wrappers over axios api instance
│       └── utils/
│           ├── assetTemplates.ts          # CSV import templates
│           ├── assetTypes.ts              # ASSET_TYPE_MAP with icons and colors
│           ├── searchIndex.ts             # Inverted prefix index for instant search
│           └── settings.ts               # App settings with localStorage persistence
│
├── docs/                                  # Documentation (this directory)
├── uploads/                               # Import scripts (Python)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Database Schema

### Entity Hierarchy

```
Building (1)
  └── Floor (N)
        └── WorkArea (N)
              └── Section (N)
                    └── Workstation (N)

Asset (N) — has FK columns pointing at any level of the hierarchy
  ├── AssetSoftware (N) — CASCADE DELETE
  ├── AssetConnection (N) — CASCADE DELETE
  └── AuditLog entries (via document_id, no FK)
```

### Asset entity — key column groups

| Group | Columns | Notes |
|-------|---------|-------|
| Lifecycle | `predecessor_id`, `successor_id` | Replacement chain; cycle-checked on update |
| Hierarchy | `building_id`, `floor_id`, `workarea_id`, `section_id`, `workstation_id` | String IDs, no TypeORM relation (avoids N+1) |
| Basic info | `display_name`, `asset_tag`, `serial_number`, `model`, `manufacturer`, `status`, `asset_type`, `os_type`, `os_version`, `mac_address` | |
| Technical | `cpu`, `ram`, `storage`, `gpu` | |
| Network | `ip_address`, `hostname`, `vlan`, `switch_port`, `dhcp_static` | `dhcp_static` = "dhcp" / "static" / "unknown" |
| Person | `person_id`, `person_itsm_id`, `person_full_name` | The responsible IT person |
| Org | `org_itsm_id`, `org_display_name` | Department/team from ITSM |
| Catalog | `catalog_itsm_id`, `catalog_display_name` | Hardware catalog item from ITSM |
| ITSM | `itsm_guid`, `hardware_asset_id`, `asset_class`, `source_of_truth`, `is_managed`, `last_synced`, `sync_status`, `itsm_snapshot` | `source_of_truth` = "local" or "itsm" |
| Location | `loc_x`, `loc_y`, `loc_rotation`, `loc_icon_type`, `loc_description`, `loc_history` (JSON) | Canvas coordinates on floor plan |
| Custom | `environment`, `notes`, `tags` (JSON), `object_id`, `serial_object`, `remote_access_tool`, `remote_access_version`, `backup_tool`, `backup_status`, `winupdate_date`, `fortiedr_active` | |
| Work items | `work_items` (simple-json) | `[{id, description, done, status, priority, due_date, assigned_to, alert_sent, created_at}]` — `id` auto-generated (UUID) if omitted |
| Maintenance | `maint_last_date`, `maint_next_date`, `maint_interval_days`, `maint_notes` | |

### toApiResponse() pattern
All entities expose a `toApiResponse()` method that maps the flat SQL columns to the nested JSON shape expected by the frontend. **Never read raw SQL column names in the frontend** — always use the API shape.

---

## API Reference

All routes require a valid `Authorization: Bearer <JWT>` header except `/api/auth/*`.

### Authentication `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/capabilities` | Returns which auth providers are enabled (local, ldap, azure) |
| POST | `/login` | Local login; returns token + user. Rate-limited: 20 req/15 min |
| POST | `/login/ldap` | LDAP login |
| POST | `/logout` | Invalidates session (audit log entry) |
| GET | `/me` | Current user profile |
| PATCH | `/password` | Change own password |
| POST | `/refresh` | Issue a new token (called automatically by frontend) |
| PATCH | `/profile` | Update own email |

### Buildings `/api/buildings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all buildings (sorted by name) |
| GET | `/:id` | Single building |
| POST | `/` | Create building |
| PATCH | `/:id` | Update name/address/metadata |
| DELETE | `/:id` | Delete (blocked if assets exist; cascades floors) |

### Floors `/api/floors`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/` | `building_id?` | List floors, optionally filtered |
| GET | `/:id` | — | Single floor |
| POST | `/` | — | Create floor |
| PATCH | `/:id` | — | Update; validates unique floor_number per building |
| DELETE | `/:id` | — | Delete (blocked if assets exist) |

### Work Areas `/api/workareas`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/` | `floor_id?` | List work areas |
| GET | `/:id` | — | Single work area |
| POST | `/` | — | Create (requires floor_id, name, optional coordinates+dimensions) |
| PATCH | `/:id` | — | Update |
| DELETE | `/:id` | — | Delete (cascades sections and workstations) |

### Sections `/api/sections`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/` | `workarea_id?` | List sections |
| GET | `/:id` | — | Single section |
| POST | `/` | — | Create |
| PATCH | `/:id` | — | Update |
| DELETE | `/:id` | — | Delete (cascades workstations) |

### Workstations `/api/workstations`

Similar CRUD, filtered by `section_id`.

### Assets `/api/assets`

| Method | Path | Query params | Notes |
|--------|------|-------------|-------|
| GET | `/` | `floor_id, building_id, workarea_id, section_id, status, type, is_placed, q, page, limit` | Full-text search on display_name, serial, asset_tag, manufacturer, model, IP, hostname, person |
| GET | `/lookups` | — | Distinct values for all autocomplete fields |
| GET | `/:id` | — | Single asset with software + connections |
| POST | `/` | — | Create; emits `asset:created` |
| POST | `/bulk` | — | Bulk create (max 500); returns 207 multi-status |
| PATCH | `/:id` | — | Update; cycle-checks predecessor/successor; tracks loc history |
| DELETE | `/:id` | — | Delete; emits `asset:deleted` |
| POST | `/:id/sync` | — | Mock ITSM sync (updates status + software) |
| POST | `/:id/connections` | — | Add connection (prevents duplicates) |
| PATCH | `/:id/connections/:connId` | — | Update connection |
| DELETE | `/:id/connections/:connId` | — | Remove connection (also removes reverse) |
| POST | `/:id/work-items/:taskId/notify` | — | Send immediate alert for one work item; sets `alert_sent=true` |

**Pagination**: when `page` and `limit` are provided, response includes `{ data, total, page, limit, pages }`. Without them, all matching assets are returned.

**Response envelope**: all endpoints return `{ success: boolean, data: ... }` (or `{ success: false, error: string }` on failure).

### ITSM `/api/itsm`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/hardware/search?q=` | Search ITSM for hardware by name/serial/tag |
| GET | `/hardware/:id` | Fetch single ITSM hardware record |
| POST | `/sync/:hardwareId` | Sync one ITSM hardware record |
| POST | `/sync/all` | Sync all hardware from ITSM (creates/updates/snapshots) |
| PATCH | `/assets/:id/accept-snapshot` | Promote pending ITSM snapshot → live asset data |

### Alerts `/api/alerts`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config` | any | Current AlertConfig |
| PUT | `/config` | admin | Update AlertConfig (email, Teams, thresholds) |
| GET | `/logs` | any | Paginated AlertLog (last 50, desc) |
| POST | `/test` | admin | Run `checkAndSend()` immediately |
| GET | `/scheduled` | any | List scheduled one-off alerts |
| POST | `/scheduled` | admin | Create a scheduled alert (title, scheduled_for, channels, asset_filter?) |
| DELETE | `/scheduled/:id` | admin | Delete a scheduled alert |

### Users `/api/users` (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all users |
| POST | `/` | Create local user |
| PATCH | `/:id/role` | Change role (admin \| operator \| viewer) |
| PATCH | `/:id/password` | Admin-reset password |
| PATCH | `/:id/deactivate` | Disable account |
| PATCH | `/:id/activate` | Re-enable account |
| PATCH | `/:id/email` | Update email |

### Audit `/api/audit`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/` | `username, action, entity_type, document_id, from, to, limit, offset` | Paginated audit log |

---

## Frontend Architecture

### Context Providers (in `App.tsx` order)

```
ErrorBoundary          — catches React render errors, shows fallback UI
ThemeProvider          — light/dark theme, persisted to localStorage
  AuthProvider         — JWT, user, login/logout, auto-refresh timer
    ToastProvider      — global toast notifications
      Router           — React Router v6
        ProtectedRoute — redirects to /login if not authenticated
          MainLayout   — sidebar + header wrapper
            (pages)
```

### Authentication flow
1. User submits login form → `AuthContext.login()` → `POST /api/auth/login`
2. Token + user stored in `localStorage` under keys `authToken` / `authUser`
3. `api.ts` axios interceptor reads `authToken` on every request and attaches the Bearer header
4. If token expires within 5 minutes, the interceptor proactively calls `POST /api/auth/refresh` (deduplicated with a `refreshPromise` to prevent concurrent refreshes)
5. `AuthContext` also schedules a timer at 75% of token lifetime to refresh proactively
6. On 401 response → clear localStorage → redirect to `/login`

### Role system

| Role | Capabilities |
|------|-------------|
| `viewer` | Read only — can browse, search, view details |
| `operator` | viewer + create/edit assets, manage connections, upload floor plans |
| `admin` | operator + user management, delete buildings/floors, system settings |

Use `useAuth()` and check `isAdmin` / `isOperator` to gate UI actions.

### Custom Hooks

| Hook | Purpose |
|------|---------|
| `useAssets({ floorId? })` | Load assets, optional floor filter, reload trigger |
| `useHierarchy({ buildingId? })` | Load buildings + floors together |
| `useAssetLookups()` | Fetch + cache distinct field values for `<datalist>` autocomplete |
| `usePersonSuggestions()` | Extract person list from loaded assets |
| `useSocket(event, handler)` | Bind to a Socket.io event with a stable handler reference |

### Service pattern
All API calls go through service objects (plain objects, not classes) in `src/services/`:

```typescript
// Example
const asset = await assetService.updateAsset(id, payload);
```

### Global Search
`GlobalSearch.tsx` (Ctrl+K) builds an inverted prefix token index (`searchIndex.ts`) over all loaded assets client-side. This makes search instant after the initial load — no round-trip to the server.

### Keyboard Shortcuts

| Shortcut | Action | Source |
|----------|--------|--------|
| `Ctrl+K` | Open Global Search | `Header.tsx` keydown listener |
| `Ctrl+N` | New asset | Dispatches `CustomEvent('app:new-asset')` → `Dashboard.tsx` listener |
| `?` | Open keyboard shortcuts help | `Header.tsx` (blocked when focus in input) |
| `Esc` | Close any modal/overlay | Each modal component |
| `E` | Toggle edit mode (floor map) | `FloorMap.tsx` |
| `W` | Toggle wire/connection mode (floor map) | `FloorMap.tsx` |

### Asset QR Codes (`AssetDetails.tsx`)

QR codes are generated client-side with the `qrcode` npm package. The payload is a multi-line structured text (not just a URL) so the data is human-readable when the phone's default scanner app shows a preview:

```
FACTORY MAP ASSET
Name: Dell OptiPlex 7090
S/N: DELL-SN-001
Tag: ASSET-2024-001
Model: Dell OptiPlex 7090
Status: active
IP: 192.168.1.101
Owner: Kovács János
URL: http://factorymap.yourcompany.com/assets/abc-123
```

**URL resolution order** (highest priority first):
1. `process.env.REACT_APP_PUBLIC_BASE_URL` — set this in `.env` for production
2. `window.location.origin` — correct when the app is opened from a network IP/hostname

**Error correction**: `errorCorrectionLevel: 'M'` (~15% recovery) balances payload size with scan reliability.

**Print Label**: `handlePrintLabel()` opens a browser print window. The QR code image (`qrDataUrl` data-URL) is embedded as an `<img>` in the top-right corner of the label alongside the asset metadata rows.

To change which fields appear in the QR code, edit `buildQrPayload()` in `AssetDetails.tsx`.

### Swagger / OpenAPI

Interactive API docs are served at **`GET /api/docs`** (Swagger UI) and **`GET /api/docs.json`** (raw spec). The spec is assembled from `@swagger` JSDoc annotations in `backend/src/routes/*.ts` and `backend/src/controllers/*.ts` by `swagger-jsdoc`. Bearer auth is declared globally in `backend/src/config/swagger.ts` so the UI can send authenticated requests.

---

## Testing

### Backend

```bash
# Run all suites (inside Docker)
docker exec factory-map-backend npm test

# Locally
cd backend && npm test
```

**Script**: `jest --runInBand --forceExit --passWithNoTests`

- `--runInBand` — runs suites sequentially to avoid parallel DB state conflicts (shared MSSQL instance, admin token cache)
- `--forceExit` — closes the TypeORM connection pool that keeps the event loop alive
- `NODE_ENV=test` is set via `setupFiles: ["<rootDir>/src/__tests__/helpers/jestEnv.ts"]` — this runs **before** any module import, preventing `server.ts` from calling `startServer()` and binding the port

Test suites:
- `src/__tests__/auth.test.ts` — register, login, invalid credentials, token refresh
- `src/__tests__/assets.test.ts` — CRUD, bulk-create, connections
- `src/__tests__/buildings.test.ts` — CRUD, cascade checks
- `src/__tests__/itsm.test.ts` — hardware search, sync (mock mode)

### Frontend

```bash
cd frontend && npm test -- --watchAll=false
```

MSW (`src/mocks/server.ts` + `src/mocks/handlers.ts`) intercepts all `/api/*` requests so tests run without a live backend.

Test files:
- `src/__tests__/GlobalSearch.test.tsx` — search index, debounce, result click
- `src/__tests__/AssetFormModal.test.tsx` — required-field validation, tab switching
- `src/__tests__/Login.test.tsx` — form render, submit dispatches auth

---

## Authentication & Authorization

### Password policy
- Minimum 8 characters
- Must include: uppercase, lowercase, digit, special character
- Expires after **90 days** (enforced as a warning on login, not a hard block)
- Account locked after **5 failed attempts** for **30 minutes**

### JWT
- Signed with `JWT_SECRET` (env var)
- Lifetime: 8 hours
- Auto-refreshed by both the axios interceptor and the `AuthContext` timer

### LDAP (optional)
Set `LDAP_ENABLED=true` and configure `LDAP_*` env vars. On first LDAP login, the user is auto-provisioned in the `users` table with role = `LDAP_DEFAULT_ROLE` (default: `viewer`). Subsequent logins update the LDAP DN and email.

---

## ITSM Integration

The ITSM layer uses an **adapter pattern** — `ITSMService` is a singleton that delegates to either `MockITSMAdapter` or `RealITSMAdapter` based on `ITSM_MODE`.

### Mock mode (default)
`MockITSMAdapter` contains 22 realistic Hungarian factory hardware records in-memory. Useful for development and testing without an ITSM system.

### Real mode
`RealITSMAdapter` is a stub with placeholder methods. To implement:
1. Set `ITSM_MODE=real`, `ITSM_REAL_API_URL`, and `ITSM_API_KEY`
2. Implement each method in `RealITSMAdapter.ts` calling `this._request()`

### Sync strategy (`SyncService.runSyncAll`)
For each hardware record from ITSM:
- If no local asset with that `itsm_guid` → **create** a new asset
- If existing asset with `source_of_truth = 'itsm'` → **overwrite** all ITSM fields
- If existing asset with `source_of_truth = 'local'` → store as `itsm_snapshot` (pending review — user must click "Accept" to apply)

---

## Real-Time Updates

Socket.io is mounted on the same HTTP server as Express. When assets change:

```typescript
// backend/src/controllers/asset.controller.ts
io.emit('asset:created', asset.toApiResponse());
io.emit('asset:updated', asset.toApiResponse());
io.emit('asset:deleted', { _id: req.params.id });
```

Frontend components use `useSocket()` to subscribe:

```typescript
useSocket('asset:updated', (updated) => {
  setAssets(prev => prev.map(a => a._id === updated._id ? updated : a));
});
```

The socket is a **module-level singleton** (`useSocket.ts`) — all components share one connection.

---

## Local Development Setup

### Prerequisites
- Docker Desktop
- Node.js 20+
- Python 3.x (for seed/import scripts only)

### Start everything

```bash
# From project root
docker-compose up -d        # Starts MSSQL + backend (port 4000) + frontend (port 5174)
# Or start frontend locally:
cd frontend && npm start    # React dev server on port 5174
```

The backend uses `nodemon` with `ts-node` — it restarts on any `.ts` file change. TypeORM `synchronize: true` auto-creates/alters tables on startup (only in non-production).

### Seed test data
```bash
python uploads/seed_test_data.py
```
Creates 2 buildings, 4 floors, 5 work areas, 4 sections, 14 assets with realistic data.

### Import IPC data from Excel
```bash
python uploads/import_ipc.py
```

### Useful commands

```bash
# Backend TypeScript check
cd backend && npx tsc --noEmit

# Frontend TypeScript check
cd frontend && npx tsc --noEmit

# Check for vulnerabilities
cd backend && npm audit
cd frontend && npm audit
```

---

## Code Conventions

### Backend
- **TypeScript strict mode** — no `any` except in explicit escape hatches
- **Controller pattern**: each file exports named async functions, no classes
- **Repository pattern**: `AppDataSource.getRepository(Entity)` called inside each function (not as a module variable) to avoid stale connections
- **Response envelope**: always `{ success: boolean, data: ... }` or `{ success: false, error: string }`
- **Error handling**: pass to `next(error)` for the global handler; never swallow errors silently except in audit log writes

### Frontend
- **CSS Modules** — all styles in `src/styles/components/` or `src/styles/pages/`
- **No inline styles** except for dynamic values (coordinates, generated colors)
- **Service objects** — plain objects with async methods, not classes
- **Context pattern** — global state lives in `src/contexts/`, never in top-level singletons
- **`useAssetLookups`** — use this hook for any autocomplete field; never fetch lookups per-field

### Both
- **Flat SQL columns + `toApiResponse()`** — entities store flat columns, the method reconstructs the nested JSON. Add new fields to both the entity column AND `toApiResponse()`.
- **No magic strings** — asset types in `ASSET_TYPE_MAP`, connection types in the union type in `asset.service.ts`

---

## Adding New Features

### Adding a new asset field

1. **Entity** (`backend/src/entities/Asset.entity.ts`):
   - Add `@Column(...)` with appropriate type
   - Add the field to `toApiResponse()` in the correct nested section

2. **Controller** (`backend/src/controllers/asset.controller.ts`):
   - Add mapping in `applyBodyToAsset()` inside the correct section block
   - If it needs autocomplete, add to `LOOKUP_COLUMNS`

3. **Frontend type** (`frontend/src/services/asset.service.ts`):
   - Add to the `Asset` interface in the correct nested section

4. **Form** (`frontend/src/components/asset/AssetFormModal.tsx`):
   - Add to `formData` state and both initialization paths (edit + reset)
   - Add `Input` component in the relevant section
   - If it has autocomplete, add `list="lookup-xxx"` and a `<datalist>`
   - Include in the payload builder at the bottom

5. **Details view** (`frontend/src/components/asset/AssetDetailsModal.tsx`):
   - Display the new field in the relevant section

### Adding a new page / route

1. Create `frontend/src/pages/MyPage.tsx`
2. Create `frontend/src/styles/pages/MyPage.module.css`
3. Add `<Route path="/my-path" element={<MyPage />} />` in `App.tsx`
4. Add a link in `frontend/src/components/layout/Sidebar.tsx`

### Adding a new API endpoint

1. Add the handler function to the relevant controller file
2. Register it in the router file
3. Apply `auditLog(...)` middleware if it mutates data

### Implementing the Real ITSM adapter

1. Set env vars: `ITSM_MODE=real`, `ITSM_REAL_API_URL=...`, `ITSM_API_KEY=...`
2. In `RealITSMAdapter.ts`, implement each method using `this._request(endpoint)`
3. Map the ITSM response fields to the `IITSMHardware` interface

### Adding Swagger annotations to a new route

Add a JSDoc `@swagger` comment directly above or inside the route file:

```typescript
/**
 * @swagger
 * /api/my-resource:
 *   get:
 *     summary: List all my-resources
 *     tags: [MyResource]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', myController.list);
```

The spec is picked up automatically — no registration step required.

### Configuring maintenance alert thresholds

1. Log in as admin and navigate to **Alerts** (`/alerts`)
2. Set **Days before alert** (default 7) — assets within this window trigger a notification
3. Enable **Email** or **Teams** and configure recipients/webhook
4. Click **Test Now** to verify delivery before the daily cron fires
5. Check **Alert History** at the bottom of the page for send status and error messages

The daily cron fires at **07:00 local server time** (configurable in `server.ts` — change the cron expression passed to `cron.schedule()`).

### Adding a new scheduled job

In `backend/src/server.ts`, after `connectDatabase()`:

```typescript
import cron from 'node-cron';
import { MyService } from './services/MyService';

// Runs every day at 06:00
cron.schedule('0 6 * * *', () => MyService.run());
```

Guard the call with `if (process.env.NODE_ENV !== 'test')` to prevent the cron from registering during test runs.
