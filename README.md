# Factory Map — IT Asset Management

Full-stack TypeScript application for tracking and visualizing IT assets in factory environments. Features hierarchical location management, interactive floor plans, ITSM integration, maintenance scheduling, and alerting.

---

## Features

### Core
- **Hierarchical Asset Management** — Buildings → Floors → Work Areas → Sections → Workstations
- **Interactive Floor Plans** — drag-and-drop asset positioning; cursor-anchored wheel zoom, touch pan/pinch, fit-to-content, keyboard navigation; constant-size pins with label decluttering; minimap, grid snap, shareable deep-link URLs, map export/print
- **Asset Connections (Wire Mode)** — model physical/logical links between devices on the floor map
- **Network Topology Graph** — force-directed graph of all asset connections
- **ITSM Integration (read-only)** — Alemba/Operaio View API adapter + mock adapter (22 realistic records); the app **never writes to ITSM**
- **ITSM Reconcile** — per-asset, on-demand comparison against the ITSM source of truth; per-field **Accept** (copy ITSM value into the app) / **Ignore** (persisted) / **Remove link**, drift summary, full audit trail
- **Global Search** — instant client-side prefix-indexed search across all assets (Ctrl+K)
- **3-Step CSV Import Wizard** — validate, preview, and bulk-import assets
- **Maintenance Calendar** — monthly calendar view of scheduled maintenance with CSV export
- **Maintenance Alerts** — daily cron (07:00) sends email and/or Microsoft Teams notifications for overdue/upcoming maintenance
- **Scheduled One-Off Alerts** — create named reminders for any future date/time, delivered via email and/or Teams; hourly cron fires them at the right moment
- **Work Item Alerts** — send an immediate targeted notification for any single asset work item (PATCH overdue/upcoming task); items automatically receive a UUID for reliable reference
- **Audit Log** — immutable record of all create/update/delete operations with per-field diffs
- **QR Code & Print Labels** — per-asset QR codes with deep-link URLs, printable labels
- **Enhanced Export** — 19-column UTF-8 CSV and JSON export of asset lists; bulk export for selections

### Technical
- **JWT Authentication** — local login + optional LDAP/Active Directory
- **RBAC** — three roles: `viewer`, `operator`, `admin`
- **Swagger/OpenAPI** — browsable, interactive API docs at `/api/docs`
- **Automated Tests** — Jest + Supertest (backend), React Testing Library + MSW (frontend)
- **Real-time Updates** — Socket.io pushes `asset:created/updated/deleted` events to all connected tabs
- **Dark Mode** — toggleable light/dark theme persisted to localStorage
- **Keyboard Shortcuts** — Ctrl+K (search), Ctrl+N (new asset), ? (shortcuts reference)

---

## Quick Start

### Prerequisites
- Docker Desktop **or Podman** (5.x with a running machine)
- Node.js 20+

### Start

```bash
git clone <repository-url>
cd factory-map
cp .env.example .env           # Fill in at minimum: MSSQL_PASSWORD, JWT_SECRET
docker-compose up -d           # Docker — SQL Server 2022 + backend (4000) + frontend (5174)
# or with Podman:
podman compose up -d --build
```

To load demo data (after the stack is up):

```bash
docker exec factory-map-backend npm run seed        # buildings, floors, assets, users
docker exec factory-map-backend npm run seed:itsm   # ITSM-linked assets for the Reconcile demo
# (use `podman exec` with Podman)
```

Open **http://localhost:5174** — you will be prompted to log in.

### Verify backend

```bash
curl http://localhost:4000/health
# → {"status":"OK","timestamp":"...","environment":"development","itsm_mode":"mock"}
```

### API documentation (Swagger)

```
http://localhost:4000/api/docs
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (Create React App) |
| Routing | React Router v6 |
| Styles | CSS Modules |
| HTTP client | axios (JWT interceptor + proactive token refresh) |
| Real-time | socket.io-client |
| Backend | Node.js + Express + TypeScript |
| ORM | TypeORM 0.3.x |
| Database | Microsoft SQL Server 2022 (Dockerised) |
| Auth | jsonwebtoken + bcryptjs; optional LDAP via ldapjs |
| Security | helmet, express-rate-limit |
| API docs | swagger-jsdoc + swagger-ui-express |
| Alerts | nodemailer (email) + fetch (Teams webhook) + node-cron |
| Tests | Jest + Supertest (backend), RTL + MSW (frontend), Playwright (E2E) |
| Containers | Docker Compose |

---

## Project Structure

```
factory-map/
├── e2e/                           # Playwright end-to-end tests
│   ├── auth.spec.ts               # Login, logout, protected routes
│   ├── buildings.spec.ts          # Building CRUD
│   ├── assets.spec.ts             # Asset CRUD
│   ├── map.spec.ts                # Floor map / SVG rendering
│   ├── dashboard.spec.ts          # Dashboard stats + sidebar
│   ├── alerts.spec.ts             # Alert config + scheduled alerts
│   └── helpers.ts                 # Shared login helpers + token cache
├── playwright.config.ts           # Playwright config (baseURL, workers, retries, storageState)
├── backend/src/
│   ├── config/
│   │   ├── config.ts          # All env-var driven configuration
│   │   ├── database.ts        # TypeORM DataSource + connectDatabase()
│   │   └── swagger.ts         # swagger-jsdoc spec definition
│   ├── controllers/           # asset, auth, building, floor, alert, itsm, section, user, …
│   ├── entities/              # TypeORM entities
│   │   ├── Asset.entity.ts
│   │   ├── AssetConnection.entity.ts
│   │   ├── AssetSoftware.entity.ts
│   │   ├── AlertConfig.entity.ts
│   │   ├── AlertLog.entity.ts
│   │   ├── ScheduledAlert.entity.ts
│   │   ├── AuditLog.entity.ts
│   │   ├── Building.entity.ts
│   │   ├── Floor.entity.ts
│   │   ├── Section.entity.ts
│   │   ├── User.entity.ts
│   │   ├── WorkArea.entity.ts
│   │   └── Workstation.entity.ts
│   ├── middleware/            # authenticate, requireAdmin, auditLog, captureAuditBefore
│   ├── routes/                # index.ts mounts all routers (all /api/* require JWT)
│   ├── services/
│   │   ├── alert/             # AlertService — checkAndSend(), checkScheduledAlerts(), sendEmail(), sendTeams()
│   │   ├── auth/              # LdapAuthService
│   │   └── itsm/              # ITSMService + Mock/Real adapters + SyncService
│   │       ├── RealITSMAdapter.ts   # Alemba/Operaio View API client (read-only)
│   │       ├── ReconcileService.ts  # Per-asset diff vs ITSM + accept/ignore/unlink
│   │       └── statusMapping.ts     # ITSM ⇄ local status map + MAC normalisation
│   ├── types/                 # api.types, asset.types, hierarchy.types, itsm.types
│   ├── utils/                 # passwordPolicy
│   └── server.ts              # Express bootstrap, Socket.io, daily cron (07:00) + hourly cron for scheduled alerts
│
├── frontend/src/
│   ├── components/
│   │   ├── asset/             # AssetDetailsModal, AssetFormModal, ImportModal, AddConnectionModal
│   │   ├── common/            # Button, Card, Badge, Modal, ConfirmDialog, ErrorBoundary, …
│   │   ├── layout/            # Header, Sidebar, MainLayout
│   │   ├── map/               # FloorMap (SVG canvas with drag, zoom, wire mode, popover)
│   │   └── search/            # GlobalSearch (Ctrl+K overlay)
│   ├── contexts/              # AuthContext, ThemeContext, ToastContext
│   ├── hooks/                 # useAssets, useHierarchy, useAssetLookups, useSocket, …
│   ├── pages/
│   │   ├── Dashboard.tsx      # Stats, asset list, bulk actions, export
│   │   ├── Buildings.tsx      # Building list + CRUD
│   │   ├── BuildingDetails.tsx
│   │   ├── FloorDetails.tsx
│   │   ├── AssetDetails.tsx   # Full-page asset view with QR code + print label
│   │   ├── MapView.tsx        # Floor plan selector
│   │   ├── UnplacedAssets.tsx # Assets not yet positioned on any floor
│   │   ├── NetworkGraph.tsx   # Force-directed connection graph
│   │   ├── Maintenance.tsx    # Monthly maintenance calendar
│   │   ├── ItsmReconcile.tsx  # Read-only ITSM reconcile — per-field accept/ignore
│   │   ├── Alerts.tsx         # Alert config (email, Teams) + alert history
│   │   ├── Reports.tsx        # Statistics + ITSM sync
│   │   ├── AuditLog.tsx       # Paginated audit trail
│   │   ├── Settings.tsx       # Personal preferences + map settings
│   │   ├── UserManagement.tsx # Admin user CRUD
│   │   └── Login.tsx
│   ├── services/              # assetService, hierarchyService, alertService, api (axios)
│   └── styles/                # CSS Modules — components/ and pages/ subdirectories
│
├── docs/
│   ├── ADMIN_GUIDE.md
│   ├── DEVELOPER_GUIDE.md
│   └── USER_GUIDE.md
├── uploads/                   # Python import/seed scripts
├── ARCHITECTURE.md
├── docker-compose.yml
└── .env.example
```

---

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Description |
|----------|-------------|
| `MSSQL_PASSWORD` | SQL Server SA password (**required**) |
| `MSSQL_DATABASE` | Database name (default: `factorymap`) |
| `JWT_SECRET` | Token signing secret — `openssl rand -hex 32` |
| `NODE_ENV` | `development` or `production` |
| `ITSM_MODE` | `mock` (default) or `real` |
| `ITSM_REAL_API_URL` / `ITSM_API_KEY` | Base URL + bearer token of the Alemba/Operaio ITSM (real mode) |
| `ITSM_VIEW_ID` | GUID of the ITSM "Hardware Assets" view (`GET /api/ViewAPI/GetViewData/{id}`) |
| `ITSM_WEB_URL` | ITSM web UI base URL — used to build record deep-links |
| `ITSM_COLUMN_MAP` | Optional JSON override mapping canonical fields → view column captions |
| `SMTP_HOST` | SMTP server for maintenance alert emails |
| `SMTP_PORT` | SMTP port (default: `587`) |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials |
| `SMTP_FROM` | Sender address (default: `factory-map@company.local`) |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams incoming webhook URL |
| `LDAP_ENABLED` | `true` to enable Active Directory login |
| `REACT_APP_API_URL` | Frontend API base URL (default: `http://localhost:4000/api`) |

See [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) for the complete variable reference.

---

## Running Tests

```bash
# Backend — runs all suites sequentially against the Docker MSSQL instance
docker exec factory-map-backend npm test

# Frontend
cd frontend && npm test -- --watchAll=false

# E2E (Playwright) — requires the full stack to be running on localhost
npx playwright test
```

Backend tests use `--runInBand --forceExit` to avoid parallel DB conflicts. The `NODE_ENV=test` environment variable is set via a `setupFiles` entry before any module is imported, which prevents the server from binding a port during test runs.

E2E tests run against the live app (`http://localhost:5174` frontend + `http://localhost:4000` backend). `playwright.config.ts` sets `workers: 1` and `retries: 1`; a `globalSetup` script logs in once and saves the session cookie so individual tests do not need to repeat the login flow.

---

## Documentation

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, data model, design patterns |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Installation, all env vars, user management, backup, production |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | API reference, code conventions, adding features |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | End-user walkthrough of every page and feature |
