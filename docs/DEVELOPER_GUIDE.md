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
- Integrate with an **ITSM system** (Alemba/Operaio) — strictly **read-only**: ITSM is the single source of truth and is never written to; a per-asset reconcile flow surfaces differences for the user to accept locally or fix in ITSM
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
│         NetworkInfrastructure | Reports | Settings           │
│         UserManagement | AuditLog                            │
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
│  AlertService (email + Teams, daily cron 07:00)              │
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
│          network_rooms | network_racks | patch_panels        │
│          wall_ports                                          │
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
│       │   ├── network.controller.ts      # Rooms / racks / patch panels / wall ports CRUD
│       │   ├── section.controller.ts      # Section CRUD
│       │   ├── user.controller.ts         # User management (admin only)
│       │   ├── workarea.controller.ts     # WorkArea CRUD
│       │   └── workstation.controller.ts  # Workstation CRUD
│       ├── entities/
│       │   ├── AlertConfig.entity.ts      # Single-row global alert configuration
│       │   ├── AlertLog.entity.ts         # Append-only alert send history
│       │   ├── ScheduledAlert.entity.ts   # User-created one-off timed alerts
│       │   ├── Asset.entity.ts            # Main asset with toApiResponse(); includes wall_port_id FK
│       │   ├── AssetConnection.entity.ts  # Asset-to-asset connections
│       │   ├── AssetSoftware.entity.ts    # Software installed on an asset
│       │   ├── AuditLog.entity.ts         # Immutable audit trail
│       │   ├── Building.entity.ts         # Top-level location
│       │   ├── Floor.entity.ts            # Floor within a building
│       │   ├── NetworkRack.entity.ts      # Equipment rack within a network room
│       │   ├── NetworkRoom.entity.ts      # IDF / MDF room within a building
│       │   ├── PatchPanel.entity.ts       # Patch panel within a rack (cable_type: copper|fiber|mixed)
│       │   ├── Section.entity.ts          # Section within a work area
│       │   ├── User.entity.ts             # App user with bcrypt password
│       │   ├── WallPort.entity.ts         # Physical wall port (face plate) on a floor
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
│       │   ├── network.routes.ts          # /api/network — rooms, racks, patch panels, wall ports
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
│       │       ├── ITSMService.ts         # Singleton; picks Mock/Real/Snapshot adapter from config
│       │       ├── MockITSMAdapter.ts     # In-memory mock with 22 realistic Hungarian assets
│       │       ├── RealITSMAdapter.ts     # Alemba/Operaio View API client (read-only, COLUMN_MAP-driven; not wired up — see docs)
│       │       ├── SnapshotITSMAdapter.ts # Reads itsm_hardware_snapshot only — zero live ITSM calls (current working path)
│       │       ├── ReconcileService.ts    # Per-asset diff vs ITSM + acceptFields/ignore/unlink/summary + findUnlinkedMmhAssets
│       │       ├── statusMapping.ts       # ITSM ⇄ local status map + normalizeMac()
│       │       └── SyncService.ts         # runSyncAll() — ITSM → DB bulk import
│       ├── types/
│       │   ├── api.types.ts
│       │   ├── asset.types.ts             # IAsset and all sub-interfaces
│       │   ├── hierarchy.types.ts         # IBuilding, IFloor, IWorkArea, ISection, IWorkstation
│       │   └── itsm.types.ts              # IITSMHardware, IITSMSyncResult, etc.
│       ├── utils/
│       │   ├── asyncHandler.ts            # Wraps async controllers; forwards rejections to next(error)
│       │   ├── passwordPolicy.ts          # validatePassword + constants
│       │   └── validate.ts               # Zod v3 schemas + validate() middleware factory
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
│       │   ├── useMaintenanceCounts.ts    # Overdue / due-soon counts for Dashboard
│       │   ├── usePersonSuggestions.ts    # Extracts person list from loaded assets
│       │   ├── useSocket.ts              # Shared socket singleton + typed event binding
│       │   └── queries/                   # React Query hooks: useAlerts, useAssets, useAuditLog,
│       │                                  #   useBuildings, useFloors, useNetwork, useUsers, useWorkareas
│       ├── pages/                         # One file per route
│       ├── components/                    # Reusable and feature components
│       ├── services/                      # Thin wrappers over axios api instance
│       └── utils/
│           ├── assetTemplates.ts          # CSV import templates
│           ├── assetTypes.ts              # ASSET_TYPE_MAP with icons and colors
│           ├── searchIndex.ts             # Inverted prefix index for instant search
│           └── settings.ts               # App settings with localStorage persistence
│
├── e2e/                                   # Playwright end-to-end tests (12 spec files)
│   ├── auth.spec.ts                       # Login, logout, protected routes
│   ├── buildings.spec.ts                  # Building CRUD
│   ├── assets.spec.ts                     # Asset CRUD
│   ├── asset-detail.spec.ts               # Single-asset page
│   ├── map.spec.ts                        # Floor map / SVG rendering + layer controls
│   ├── dashboard.spec.ts                  # Dashboard stats + sidebar nav
│   ├── alerts.spec.ts                     # Alert config + scheduled alerts
│   ├── audit.spec.ts                      # Audit log filters + pagination
│   ├── maintenance.spec.ts                # Maintenance calendar
│   ├── network.spec.ts                    # Network infrastructure rooms/racks
│   ├── reports.spec.ts                    # Asset reports tabs
│   ├── settings.spec.ts                   # User settings + password change
│   ├── global-setup.ts                    # Playwright globalSetup (one-time login)
│   └── helpers.ts                         # Shared login helpers + token cache
├── playwright.config.ts                   # Playwright config (baseURL, workers, retries, storageState)
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
| Physical port | `wall_port_id` (FK → `wall_ports.id`) | Physical network drop the asset plugs into; eager-joined as `wall_port` (→ patch panel → rack → room) |
| Person | `person_id`, `person_itsm_id`, `person_full_name` | The responsible IT person |
| Org | `org_itsm_id`, `org_display_name` | Department/team from ITSM |
| Catalog | `catalog_itsm_id`, `catalog_display_name` | Hardware catalog item from ITSM |
| ITSM | `itsm_guid`, `hardware_asset_id`, `asset_class`, `source_of_truth`, `is_managed`, `last_synced`, `sync_status`, `itsm_snapshot` | `source_of_truth` = "local" or "itsm" |
| Reconcile | `reconcile_ignored` (JSON), `reconcile_last_at`, `reconcile_last_status`, `reconcile_diff_count` | Stored result of the last per-asset ITSM check + persisted per-field ignores |
| Location | `loc_x`, `loc_y`, `loc_rotation`, `loc_icon_type`, `loc_description`, `loc_history` (JSON) | Canvas coordinates on floor plan |
| Custom | `environment`, `notes`, `tags` (JSON), `object_id`, `serial_object`, `remote_access_tool`, `remote_access_version`, `backup_tool`, `backup_status`, `winupdate_date`, `fortiedr_active` | |
| Work items | `work_items` (simple-json) | `[{id, description, done, status, priority, due_date, assigned_to, alert_sent, created_at}]` — `id` auto-generated (UUID) if omitted |
| Maintenance | `maint_last_date`, `maint_next_date`, `maint_interval_days`, `maint_notes` | |

### Network infrastructure entities

```
NetworkRoom (IDF / MDF)
  └── NetworkRack (N)
        └── PatchPanel (N)

WallPort — FK to Floor (for position) and FK to PatchPanel (optional; the cable path)
Asset.wall_port_id → WallPort  (the physical jack the device is plugged into)
```

| Entity | Table | Key columns |
|--------|-------|-------------|
| `NetworkRoom` | `network_rooms` | `name`, `type` (idf\|mdf), `building_id`, `floor_id?`, `redundant_pair_id?` |
| `NetworkRack` | `network_racks` | `name`, `network_room_id`, `u_count` (default 42) |
| `PatchPanel` | `patch_panels` | `name`, `rack_id`, `u_position?`, `port_count` (default 24), `cable_type` (copper\|fiber\|mixed) |
| `WallPort` | `wall_ports` | `label` (e.g. A-04), `floor_id`, `pos_x?`, `pos_y?`, `patch_panel_id?`, `patch_port?`, `switch_asset_id?`, `switch_port?` |

**Delete guards**: `deleteRack`/`deleteRoom` (`network.controller.ts`) 400 if
any `Asset.rack_id` still points into the rack (or, for a room, into any of
its racks) — same asset-count-guard pattern as `deleteWorkArea`/
`deleteSection`/`deleteFloor`. `deleteFloor`/`deleteBuilding` also 400 if a
`NetworkRoom` still references them; `deleteBuilding` additionally re-checks
`WallPort` count itself, because its own cascade deletes floors directly via
the repository, bypassing `deleteFloor`'s guards.

**Collision guard**: `findWallPortCollision` (`network.controller.ts`)
rejects (409) a `WallPort` create/update that would share a
(`patch_panel_id`, `patch_port`) or (`switch_asset_id`, `switch_port`) pair
with another wall port — same principle as `findRackCollision` on `Asset`.

**Replace endpoints**: `POST /network/racks/:id/replace` and
`POST /network/patch-panels/:id/replace` (body: `{ replacement_id }`) move
everything the old rack/panel held onto the replacement (patch panels +
mounted assets, or wired wall ports, keeping U-positions/port numbers),
409 on a collision, then delete the emptied-out old row. See
`replaceRack`/`replacePatchPanel` in `network.controller.ts`.

### toApiResponse() pattern
All entities expose a `toApiResponse()` method that maps the flat SQL columns to the nested JSON shape expected by the frontend. **Never read raw SQL column names in the frontend** — always use the API shape.

---

## API Reference

All routes require a valid `Authorization: Bearer <JWT>` header except `/api/auth/*`.

### Authentication `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/capabilities` | Returns which auth providers are enabled (local, ldap, azure) |
| POST | `/login` | Local login; returns token + user. Rate-limited: 20 req/15 min (production); 200 req/15 min (development) |
| POST | `/login/ldap` | LDAP login. Rate-limited: same limiter as `/login` |
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
| GET | `/` | `floor_id, building_id, workarea_id, section_id, status, type, is_placed, q, page, limit, include_connections, include_master, orphaned` | Full-text search on display_name, serial, asset_tag, manufacturer, model, IP, hostname, person. `orphaned=true` filters to assets with a `master_ifs_id` that no longer resolves to a `MasterAsset` row |
| GET | `/lookups` | — | Distinct values for all autocomplete fields |
| GET | `/maintenance-counts` | — | `{ overdue, due_soon }` — excludes replaced assets (`successor_id` set) |
| GET | `/:id` | — | Single asset with software + connections; always resolves `master` (`null` if orphaned) |
| POST | `/` | — | Create; emits `asset:created`; 422 on hierarchy mismatch or a future `maintenance.last_date`; 409 on rack U-position collision |
| POST | `/bulk` | — | Bulk create (max 500); returns 207 multi-status. Unset hierarchy fields must be `null`/omitted, not `''` — an empty string fails the UUID validation for the whole batch |
| PATCH | `/:id` | — | Update; cycle-checks predecessor/successor; tracks loc history; same 422/409 validation as create |
| DELETE | `/:id` | — | Delete; emits `asset:deleted`; clears dangling `AssetConnection`/`predecessor_id`/`successor_id`/`WallPort.switch_asset_id` references |
| POST | `/:id/replace` | — | `{ replacement_id }` — physical swap: the replacement inherits position, hierarchy, wall-port assignment, and every connection (including wall ports wired to it if the old asset was a switch); the old asset is cleared to unplaced and kept via `predecessor_id`/`successor_id` |
| POST | `/:id/sync` | — | Mock ITSM sync (updates status + software) |
| POST | `/:id/connections` | — | Add connection; 422 on self-connection; prevents exact duplicates (same target + type + label) |
| PATCH | `/:id/connections/:connId` | — | Update connection (by connection `id`, not target asset — supports multiple distinct connections to the same pair) |
| DELETE | `/:id/connections/:connId` | — | Remove connection (also removes reverse, if bidirectional) |
| POST | `/:id/work-items/:taskId/notify` | — | Send immediate alert for one work item; sets `alert_sent=true` |

**Pagination**: when `page` and `limit` are provided, the response includes `{ data, meta: { page, limit, total, totalPages } }`. Without them, the response includes `{ data, meta: { limit: 1000, truncated: boolean } }` — up to 1000 assets are returned and `meta.truncated` is `true` if there are more. Explicit `limit` is capped at 500.

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

### Network Infrastructure `/api/network`

All write operations require operator or admin role.

#### Rooms

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/rooms` | `building_id?`, `floor_id?`, `type?` | List rooms (nested with racks) |
| GET | `/rooms/:id` | — | Single room with full rack/panel tree |
| POST | `/rooms` | — | Create room (`name`, `building_id` required; `type` = idf\|mdf) |
| PATCH | `/rooms/:id` | — | Update |
| DELETE | `/rooms/:id` | — | Delete (cascades racks → patch panels → wall port links); 400 if any asset is still mounted in one of its racks |

#### Racks

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/racks` | `network_room_id?` | List racks |
| GET | `/racks/:id` | — | Single rack |
| POST | `/racks` | — | Create (`name`, `network_room_id`, `u_count?`) |
| PATCH | `/racks/:id` | — | Update |
| DELETE | `/racks/:id` | — | Delete (cascades patch panels); 400 if any asset is still mounted (`rack_id`) |
| POST | `/racks/:id/replace` | — | `{ replacement_id }` — move patch panels + mounted assets to the replacement rack, keeping U-positions; 409 on collision; deletes the emptied-out old rack |

#### Patch Panels

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/patch-panels` | `rack_id?` | List patch panels |
| GET | `/patch-panels/:id` | — | Single patch panel |
| POST | `/patch-panels` | — | Create (`name`, `rack_id`, `cable_type?` = copper\|fiber\|mixed) |
| PATCH | `/patch-panels/:id` | — | Update |
| DELETE | `/patch-panels/:id` | — | Delete (wall ports referencing it are set to `patch_panel_id: null`) |
| POST | `/patch-panels/:id/replace` | — | `{ replacement_id }` — move wired wall ports to the replacement panel, keeping port numbers; 409 on collision; deletes the emptied-out old panel |

#### Wall Ports

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/wall-ports` | `floor_id?`, `patch_panel_id?` | List wall ports with resolved path info |
| GET | `/wall-ports/:id` | — | Single wall port with full path |
| POST | `/wall-ports` | — | Create (`label`, `floor_id` required; `pos_x/y`, `patch_panel_id`, `patch_port`, `switch_asset_id`, `switch_port` optional); 409 if the `(patch_panel_id, patch_port)` or `(switch_asset_id, switch_port)` pair is already assigned to another wall port |
| PATCH | `/wall-ports/:id` | — | Update (reposition or re-cable); same 409 collision check as create, excluding itself |
| DELETE | `/wall-ports/:id` | — | Delete |

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

Use `useAuth()` and check `isAdmin` / `isOperator` to gate UI actions — but
this is a UX nicety only. The actual boundary is server-side
(`requireOperator`/`requireAdmin` middleware on every mutating route);
verified live that a `viewer` token gets `403` directly from the API on
every write/delete/admin endpoint, not just a hidden button, so there's no
need to duplicate that check defensively in a controller that's already
behind the middleware.

### Custom Hooks

**Direct hooks** (`src/hooks/`):

| Hook | Purpose |
|------|---------|
| `useAssets({ floorId? })` | Load assets, optional floor filter, reload trigger |
| `useHierarchy({ buildingId? })` | Load buildings + floors together |
| `useAssetLookups()` | Fetch + cache distinct field values for `<datalist>` autocomplete |
| `usePersonSuggestions()` | Extract person list from loaded assets |
| `useSocket(event, handler)` | Bind to a Socket.io event with a stable handler reference |

**React Query hooks** (`src/hooks/queries/`) — wrap `@tanstack/react-query` and return `{ data, isLoading, error, refetch }`:

| Hook | Endpoint |
|------|---------|
| `useBuildings()` | `GET /api/buildings` |
| `useFloors(buildingId?)` | `GET /api/floors?building_id=` |
| `useWorkareas(floorId?)` | `GET /api/workareas?floor_id=` |
| `useAssets(params)` | `GET /api/assets` (paginated) |
| `useAuditLog(params)` | `GET /api/audit` |
| `useAlerts()` | `GET /api/alerts/config` + `/logs` + `/scheduled` |
| `useNetwork(buildingId?)` | `GET /api/network/rooms?building_id=` + `/wall-ports` |
| `useUsers()` | `GET /api/users` |

### Service pattern
All API calls go through service objects (plain objects, not classes) in `src/services/`:

```typescript
// Example
const asset = await assetService.updateAsset(id, payload);
```

### Surfacing API errors

Every controller error response is `{ success: false, error: string }` with
a specific reason. Use `getApiErrorMessage(err, fallback)`
(`src/utils/apiError.ts`) in `catch` blocks that show a toast, instead of
`err.message` (which on an Axios error is the generic "Request failed with
status code 409" — it throws away the actual backend reason):

```typescript
} catch (err) {
  toast.error(getApiErrorMessage(err, 'Failed to delete rack'));
}
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
- `jestEnv.ts` also redirects `MSSQL_DATABASE` to a `_test`-suffixed name (e.g. `factorymap` → `factorymap_test`) so the suite never touches the dev database — it had polluted it with mock ITSM records at least once before this was added. `testApp.ts`'s `setupTests()` creates that database on first connect if it doesn't exist yet (raw `mssql` connection to `master`), then proceeds with the normal TypeORM `connectDatabase()`.

Test suites (20 suites):
- `src/__tests__/auth.test.ts` — register, login, invalid credentials, token refresh
- `src/__tests__/auth.extended.test.ts` — password policy, role changes, profile update, token expiry
- `src/__tests__/auth.lockout.test.ts` — account lockout (423), locked-account rejects correct password, pagination safety cap, Zod 400 validation
- `src/__tests__/session-revocation.test.ts` — logout invalidates token, concurrent session limits
- `src/__tests__/assets.test.ts` — CRUD, bulk-create, connections, `wall_port_id` assign/clear
- `src/__tests__/asset-connections.test.ts` — create/delete connections, bidirectional propagation, port fields
- `src/__tests__/asset-extras.test.ts` — work items, software, tags, QR code endpoint
- `src/__tests__/assets-filtering.test.ts` — filter by status, type, building, floor, search query
- `src/__tests__/buildings.test.ts` — CRUD, cascade checks
- `src/__tests__/floors.test.ts` — CRUD, building FK, floor number uniqueness
- `src/__tests__/workareas.test.ts` — CRUD, floor FK
- `src/__tests__/sections.test.ts` — CRUD, workarea FK
- `src/__tests__/workstations.test.ts` — CRUD, section FK
- `src/__tests__/network.test.ts` — rooms/racks/patch panels/wall ports CRUD; `cable_type` round-trip; asset `wall_port_id` FK assign + null-clear
- `src/__tests__/audit.test.ts` — create/update/delete writes AuditLog rows with diffs
- `src/__tests__/itsm.test.ts` — hardware search, sync (mock mode)
- `src/__tests__/users.test.ts` — admin CRUD, self-update, role guard
- `src/__tests__/rbac.test.ts` — viewer/operator/admin permission matrix for key endpoints
- `src/__tests__/alerts.test.ts` — config GET/PUT, test trigger, scheduled alerts CRUD
- `src/__tests__/error-handling.test.ts` — 404 on unknown routes, malformed JSON, missing auth

### Frontend

```bash
cd frontend && npm test -- --watchAll=false
```

MSW (`src/mocks/server.ts` + `src/mocks/handlers.ts`) intercepts all `/api/*` requests so tests run without a live backend.

Test files (14 suites):
- `src/__tests__/Login.test.tsx` — form render, submit dispatches auth
- `src/__tests__/GlobalSearch.test.tsx` — search index, debounce, result click, cache invalidation
- `src/__tests__/Dashboard.test.tsx` — stat cards, overdue/due-soon filter toggles
- `src/__tests__/AssetDetails.test.tsx` — asset name, hierarchy, overflow menu, ITSM sync
- `src/__tests__/AssetFormModal.test.tsx` — required field validation, create/update flow
- `src/__tests__/AssetReports.test.tsx` — all five tabs, header controls, topology filters
- `src/__tests__/AuditLog.test.tsx` — filter panel, empty state, pagination
- `src/__tests__/BuildingDetails.test.tsx` — building name, floor cards, error state
- `src/__tests__/Maintenance.test.tsx` — calendar, overdue panel, collapse toggle, view switch
- `src/__tests__/MapView.test.tsx` — building/floor selectors, search, deploy button
- `src/__tests__/NetworkInfrastructure.test.tsx` — building selector, room list, Add Room
- `src/__tests__/Settings.test.tsx` — appearance, password validation, sessions
- `src/__tests__/Alerts.test.tsx` — config form, test trigger, scheduled alerts
- `src/__tests__/UserManagement.test.tsx` — user list, create form, role options

### E2E (Playwright)

```bash
# Requires the full stack running (frontend :5174, backend :4000)
npx playwright test                 # Headless, CI mode
npx playwright test --ui            # Interactive Playwright UI
npx playwright test --headed        # Show browser window
npx playwright test e2e/auth.spec.ts  # Single suite
```

**Config** (`playwright.config.ts`):
- `baseURL: http://localhost:5174`
- `workers: 1` — serialized to avoid DB/rate-limit conflicts between suites
- `retries: 1` — one retry on flaky network timing
- `storageState: e2e/.auth/user.json` — injected by `globalSetup`; auth tests override with an empty state

**Session bootstrap** (`e2e/global-setup.ts`): logs in once via the API, stores the session in `e2e/.auth/user.json` so every test file starts already authenticated. Only `auth.spec.ts` clears the state to test the actual login form.

**Suites** (12 spec files):
- `auth.spec.ts` — login page renders, wrong password, correct credentials, protected-route redirect, logout
- `buildings.spec.ts` — list renders, seed buildings present, create dialog, full create/cleanup
- `assets.spec.ts` — list renders, create asset, card navigates to detail page
- `asset-detail.spec.ts` — asset detail page, tab navigation, overflow menu
- `map.spec.ts` — floor selector, SVG map container (`[class*="mapContainer"]`), layer controls, wall-ports toggle
- `dashboard.spec.ts` — stat cards, sidebar links, global search overlay
- `alerts.spec.ts` — config form, Teams section, scheduled alerts section, alert history table
- `audit.spec.ts` — audit log filters, pagination, entry list
- `maintenance.spec.ts` — calendar renders, overdue badge, month navigation
- `network.spec.ts` — building selector, room list, rack diagram
- `reports.spec.ts` — all tabs (Overview/Connections/Maintenance/Locations/Topology)
- `settings.spec.ts` — theme toggle, password form, sessions table

**Key patterns**:
- FloorMap renders SVG (not `<canvas>`); check for `[class*="mapContainer"]` or `[class*="controlButton"]`
- Asset cards contain an inline status `<select>`; click the icon area (`[class*="assetIcon"]`) to navigate without opening the dropdown
- Rate limits are 200/15 min in development; `helpers.ts` caches the token per worker to minimise login calls

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

The ITSM layer uses an **adapter pattern** — `ITSMService` is a singleton that delegates to `MockITSMAdapter`, `RealITSMAdapter`, or `SnapshotITSMAdapter` based on `ITSM_MODE`.

> **Hard rule: the integration is READ-ONLY.** No adapter method may issue
> anything other than a GET towards ITSM. ITSM is the single source of truth;
> conflicts are resolved either locally (accept the ITSM value) or by the user
> editing the record in ITSM itself.

### Mock mode (default)
`MockITSMAdapter` contains 22 realistic Hungarian factory hardware records in-memory. Useful for development and testing without an ITSM system. Run `npm run seed:itsm` (backend container) after the base seed — it links assets to the mock records with deliberate serial/status/MAC/name mismatches plus one missing-in-ITSM orphan, so the Reconcile flow is demonstrable.

### Real mode — Alemba / Operaio View API
`RealITSMAdapter` calls the internal View API the ITSM web UI itself uses:
`GET {ITSM_REAL_API_URL}/api/ViewAPI/GetViewData/{ITSM_VIEW_ID}` with a server-side
filter, so single-asset lookups return one row instead of the ~18k-row catalogue.
Because the view's column captions vary per tenant, mapping is driven by the
`COLUMN_MAP` table in the adapter; individual entries can be overridden at deploy
time via the `ITSM_COLUMN_MAP` env var (JSON, canonical field → caption list).
`getPerson`/`getSoftware` are not available through this view and throw;
`getTicketsByHardware` returns `[]`.

**Known gap (unresolved):** a real, currently-running reconciliation script for
this same ITSM instance (outside this repo) shows the live contract differs
from what `RealITSMAdapter` assumes — it authenticates with **Windows
Integrated/Kerberos SSO** (no bearer token), queries via **OData `$filter`**
(e.g. `contains(HardwareAssetIsAssignedToLocation/DisplayName/Value,'MMH')`),
and reads fields as nested `{Value}` / nav-property objects rather than flat
captions. The backend runs in a Podman container with no confirmed way to get
that SSO working, so `RealITSMAdapter` is not wired up to anything today — see
Snapshot mode below for the path actually in use.

### Snapshot mode — MMH-scoped, import-only (current working path)
Because `RealITSMAdapter` can't authenticate from the container, `ITSM_MODE=snapshot`
selects `SnapshotITSMAdapter`, which makes **zero network calls to ITSM** —
every method is a read against the local `itsm_hardware_snapshot` table.

Data flow:
1. `ops/itsm/Export-ItsmMmhSnapshot.ps1` runs on a domain-joined Windows machine
   (Kerberos SSO via the running user's AD session — no password needed). It
   makes **one** OData call filtered to `contains(Location,'MMH')` and writes
   `itsm-mmh-hardware.json`.
2. Copy that file into the backend container and run
   `npm run import:itsm -- <dir>` (`backend/src/scripts/import-itsm-snapshot.ts`).
   Unlike the IFS master-data import, this is a **full replace** — the table
   always reflects "MMH hardware as of the last export run", not a merged
   cache, so a device that moves off-MMH or is retired in ITSM disappears on
   the next import.
3. `SnapshotITSMAdapter` and `ReconcileService.findUnlinkedMmhAssets()` read
   from that table; the per-asset Check/Accept/Ignore/Unlink flow below works
   unchanged against it.

This also enables a reconcile direction the per-asset flow structurally can't
cover: `GET /api/itsm/reconcile/unlinked-mmh` returns MMH-scoped ITSM hardware
that no local asset links to (`hardware_asset_id`) — "ITSM has it, factorymap
doesn't" — built entirely from the local DB + the imported snapshot, no ITSM
call. `POST /api/itsm/reconcile/unlinked-mmh/create` (+ UI buttons) materialises
selected rows into real, **unplaced** local assets — ITSM has no floor-plan
geometry, so placement on the map is always a manual follow-up step.

#### Field mapping — what's queryable in this ITSM instance and what isn't
Confirmed by inspecting a raw `GetViewData` payload and the ITSM web UI
directly (not guessed):

| App field | Source | Notes |
|---|---|---|
| `serial_number`, `status`, `mac_address`, `asset_tag`, `hardware_asset_id`, `itsm_guid` | Hardware Asset's own flat fields | Straightforward. |
| `catalog_display_name`, `catalog_itsm_id` | `HardwareAssetIsBasedOnCatalogItem` nav (`DisplayName` / `$Id$`) | Free — no extra call. |
| `person_full_name`, `person_itsm_id` | `HardwareAssetIsUsedByPerson` nav | Free, **but the relationship name matters** — `HardwareAssetIsAssignedToPerson` (an earlier guess) doesn't exist and silently returns null forever. `Asset.toApiResponse()` gates the whole `assigned_person` object on `person_itsm_id || person_id`. |
| `person_id` (real `mmh####` login-style ID) | Not exposed on the Hardware Asset's nav expansion at all — resolved via a one-time join against a hand-exported `persons.csv` (ITSM web UI: Asset Management > Master Data > Persons, filtered to MMH), keyed by normalized display name, same pattern as `manufacturer`/`asset_type` above | Best-effort, same "approximation, not authoritative" tradeoff — resolved for 644/742 (87%) of assigned-person assets; the rest likely aren't in the MMH-filtered export or have a display-name mismatch, not chased further. |
| `asset_type` | Catalog Item's own `Type` field, mapped via `ITSM_TYPE_TO_ASSET_TYPE` in `import-itsm-snapshot.ts` | **Not** reachable through the Hardware Asset's nav-expansion (only Class/Id/DisplayName are exposed there) or the Catalog Items grid's per-user column settings. Requires a one-time join against a hand-exported `hardware-catalog-items.csv` (ITSM web UI: Asset Management > Hardware Asset Management > Hardware Catalog Items > Export to CSV), keyed by **display name** (the nav's GUID has no counterpart in that CSV — verified 8/618 name collisions all share the same Type, so this is safe). "Network Device" is disambiguated by keyword against the catalog item name. |
| `manufacturer` | First word of the Catalog Item's display name | **Not an authoritative field** — Manufacturer isn't exposed anywhere queryable in this ITSM instance (not on the Hardware Asset, not in the Catalog Items grid/CSV, only on each Catalog Item's own individual record form — pulling it in bulk would need an Alemba admin to widen that grid's server-side projection). This is a best-effort text heuristic. |
| `model`, `os_type`, `os_version` | — | Confirmed **not populated anywhere** in this ITSM instance: Model isn't in the Catalog Items CSV either, and the Hardware Asset's Software Assets relationship is applications only (no OS entry) — left null rather than guessed. |

The Catalog Items CSV parser has to special-case ~20 of 618 rows (mostly
Monitors) with an unescaped inch-mark quote in the display name (`Monitor
24"`) that breaks naive CSV quote-toggling — it splits on the literal `","`
delimiter instead, which handles this correctly since no field contains a
literal comma.

`ReconcileService.backfillAssetsFromSnapshot()` (`npm run backfill:itsm`)
fills these fields onto assets that were already created before a richer
snapshot import resolved them — it only ever fills a currently-empty field,
never overwrites one that already has a value (so a manual edit is safe).

### Reconcile flow (`ReconcileService`) — preferred
Per-asset, on-demand, read-only comparison. `RECONCILE_FIELDS` is the single
declarative table that drives the diff, the accept write-back and the UI — add a
row there to make a new field reconcilable. Status comparisons go through
`statusMapping.ts` (`Deployed⇄active`, …) and MACs through `normalizeMac()`.

| Endpoint (mounted at `/api/itsm`) | Role | ITSM traffic |
|---|---|---|
| `GET /reconcile/linked` | any | none (local DB) |
| `GET /reconcile/summary` | any | none (local DB) |
| `GET /reconcile/unlinked-mmh` | any | none (local DB + imported snapshot) |
| `POST /reconcile/:id/check` | operator | **1 GET** (the only ITSM read) |
| `PATCH /reconcile/:id/accept` `{fields:[]}` | operator | 1 GET (re-read at accept time), writes locally |
| `PATCH /reconcile/:id/ignore` `{field, itsm_value}` | operator | none — the value comes from the client |
| `PATCH /reconcile/:id/unignore/:field` | operator | none |
| `PATCH /reconcile/:id/unlink` | operator | none — clears the local link only |

Accept/ignore/unlink are audited (`captureAuditBefore` + `auditLog('asset')`).
Ignores are stored on the asset (`reconcile_ignored`) together with the ITSM value
they were ignored at — if ITSM later reports a different value, the diff
resurfaces automatically.

### Sync strategy (`SyncService.runSyncAll`) — bulk import
For each hardware record from ITSM:
- If no local asset with that `itsm_guid` → **create** a new asset
- If existing asset with `source_of_truth = 'itsm'` → **overwrite** the ITSM-owned fields
- If existing asset with `source_of_truth = 'local'` → store as `itsm_snapshot` (pending review — user must click "Accept" to apply)

Note: the bulk sync no longer touches `AssetSoftware` rows (an earlier version
deleted them without re-creating — software lists are only populated by the
per-asset `syncAsset` path, which resolves `installed_software`).

## Physical Inventory Survey Import

A separate, lightweight Python tool ("IT_Eszkoz_Nyilvantarto") lets IT staff
walk a building and record every device found: which ITSM Hardware Asset it
is (`azonosito_mod: "HWA"`, with the HWA number) or, for devices ITSM doesn't
track at all (mostly monitors — `azonosito_mod: "EGYEB"`, "other"), its
device type/serial number instead — plus where it physically sits and who
uses it. It exports JSON like:

```json
{ "verzio": 1, "mentve": "...", "eszkozok": [
  { "terulet": "Client Operation", "epulet": "werk 1", "emelet": "0",
    "helyszin": "hr", "work_area": "recepcio", "szemely": "", "megjegyzes": "recepcio",
    "azonosito_mod": "HWA", "hwa": "hwa26255", "eszkoz_tipus": "", "sorozatszam": "",
    "id": "...", "letrehozva": "...", "modositva": "..." }
] }
```

`import-inventory-survey.ts` (`npm run import:inventory -- <dir>`) imports
this. The tool's own 4-level hierarchy maps directly onto factorymap's
Building → Floor → WorkArea → Section: `epulet`/`emelet` → Building/Floor
(matched by name, with `emelet` also tried as `Floor.floor_number` since the
survey uses a bare number like `"0"` where the app's Floor name is
descriptive — e.g. "Ground Floor (Földszint)"), `helyszin` → **WorkArea**,
and the tool's own `work_area` field (same name as the app's `WorkArea`
entity, but one level more granular — don't confuse the two) → **Section**.

Two outcomes per row:
- **`HWA` rows** update an already-existing asset (linked via the ITSM
  snapshot pipeline above) with its real-world placement + assigned person.
  A row whose `hwa` matches no known asset is reported, not guessed at — it
  likely still needs the unlinked-MMH bulk-create step run first, or has a
  typo.
- **`EGYEB` rows** create a new **local-only** asset
  (`source_of_truth: 'local'`) — not in ITSM at all yet. factorymap never
  writes to ITSM, so someone registers these by hand in Alemba later; once
  that's done, a human links the real HWA via the existing "search ITSM
  record" UI on the asset edit form (`hardware_asset_id`/`itsm_guid` are
  editable on an existing asset, not just at creation), and the normal
  reconcile flow takes over from there. Re-running the import matches an
  existing local asset by serial number, so a refined/re-run survey doesn't
  create duplicates.

**Dry run by default — this doubles as a validation tool.** Building/Floor
must already exist; WorkArea/Section (the actual map areas) must too — this
script never invents hierarchy, it only matches by name (diacritic/case/
whitespace-insensitive) and reports what didn't match. Fix typos/nicknames
via an optional `inventory-corrections.json` in the same directory:
```json
{ "persons": { "gorog tomi": "Görög Tamás" },
  "helyszin": { "hr": "HR" },
  "work_area": { "hr iroda": "HR Iroda" } }
```
Re-run (still dry-run) until the report is clean, then add `--apply` to
commit. Person matching (`szemely`) is best-effort against names already
known from the ITSM snapshot (`itsm_hardware_snapshot.assigned_person_name`)
— informal survey names without diacritics won't all match; unmatched ones
are still kept as free-text `person_full_name`, correctable by hand later,
same tradeoff as the ITSM person-ID enrichment. `terulet` (e.g. "Client
Operation" vs "Operation Technology" — a network/VLAN-segmentation
classification, not a location) is stored verbatim on `network_domain`.

**After importing**, `reconcile-report.ts` (`npm run reconcile:report --
[--csv=<path>]`) gives the "what's different now" view the per-asset "Check
ITSM" button can't: it runs that same read-only diff check
(`ReconcileService.reconcileAsset` — zero live ITSM calls under
`ITSM_MODE=snapshot`) across every ITSM-linked asset and reports in-sync vs.
differing counts plus every field-level diff, and separately lists every
still-local-only asset (grouped by type) as the backlog of devices someone
still needs to register in Alemba.

## IFS/CMDB Master-Data Import

Separate from ITSM (Alemba) reconcile above: the **read-only IFS/CMDB master
data** (`master_assets`, `production_lines`, `work_centers`, `entity_kinds`)
is populated by `backend/src/scripts/import-master-data.ts`
(`npm run import:master -- <dir>`), which reads the **exact JSON shapes**
shopfloor_visualizer's own ingest scripts produce — so factorymap can eat the
same export:

| File | Source (his script) | → factorymap table |
|---|---|---|
| `masterData.json` | `databricks-ingest/ingest-mmag-machines.py` | `master_assets` (machine rows) |
| `OTAssetData.json` | `databricks-ingest/ingest-mmag-ot-assets.py` | `master_assets` (OT/IT rows) |
| `production_lines.json` | `ifs-ingest/get_workcenters.py` | `production_lines` |
| `workcenters.json` | `ifs-ingest/get_workcenters.py` | `work_centers` |
| `entity_kinds.json` | his `data/entity_kinds.json` | `entity_kinds` |

The two `master_assets` shapes are **merged by `ifs_id`** into one row; an OT
asset's `parent_id` becomes `ifs_machine_id`, which is how a device hangs under
its physical machine (the same Object-ID/parent join his app uses — see
`Asset.master_ifs_id` → `MasterAsset.ifs_id`, and `MasterAsset.ifs_machine_id`
→ the parent machine). The import is **idempotent** (upsert by key) and
**layout-safe** (never touches `Asset` positions/connections/hierarchy — a
dropped row just surfaces its asset on the Orphaned Assets page). All columns
beyond the original minimal set are nullable, so a partial export still
imports. Swapping in a live Databricks/IFS pull later only changes the file
reads in this one script; nothing downstream changes.

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

### Deploying to a shared VM

`docker-compose.yml` above is dev-only (dev servers, bind-mounted source, MSSQL
port published for local `sqlcmd`/GUI access). For an internal VM deployment
reachable by others on the corp VLAN, see [docs/DEPLOYMENT.md](DEPLOYMENT.md)
— it uses `docker-compose.prod.yml` (static frontend build via nginx, compiled
backend, MSSQL never published to the host) and `.env.prod.example`.

---

## Code Conventions

### Backend
- **TypeScript strict mode** — no `any` except in explicit escape hatches
- **Controller pattern**: each file exports named async functions, no classes
- **Repository pattern**: `AppDataSource.getRepository(Entity)` called inside each function (not as a module variable) to avoid stale connections
- **Response envelope**: always `{ success: boolean, data: ... }` or `{ success: false, error: string }`
- **Error handling**: pass to `next(error)` for the global handler; never swallow errors silently except in audit log writes
- **`asyncHandler`**: wrap every async controller function with `asyncHandler(fn)` from `utils/asyncHandler.ts` instead of try/catch boilerplate — rejections automatically call `next(error)`
- **Zod validation**: use the `validate(schema)` middleware from `utils/validate.ts` on every POST/PATCH route that accepts a body; schemas live in `validate.ts`, not inline in controllers

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

1. Add the handler function to the relevant controller file, wrapped with `asyncHandler`
2. Define a Zod schema in `utils/validate.ts` and apply `validate(schema)` middleware in the router for any route that accepts a body
3. Register it in the router file
4. Apply `auditLog(...)` middleware if it mutates data

### Implementing the Real ITSM adapter

1. Set env vars: `ITSM_MODE=real`, `ITSM_REAL_API_URL=...`, `ITSM_API_KEY=...`
2. In `RealITSMAdapter.ts`, implement each method using `this._request(endpoint)`
3. Map the ITSM response fields to the `IITSMHardware` interface
4. **Not usable as-is today** — see the "Known gap" note under ITSM Integration
   above. Resolving the container's ITSM authentication (service account /
   API-key support on the Alemba side, or NTLM/Kerberos from the container) is
   a prerequisite before this mode can be turned on; until then use `snapshot`
   mode (`ops/itsm/Export-ItsmMmhSnapshot.ps1` + `npm run import:itsm`).

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
