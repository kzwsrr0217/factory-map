# Factory Map — IT Asset Management

Full-stack TypeScript application for tracking and visualizing IT assets in factory environments. Features hierarchical location management, interactive floor plans, ITSM integration, maintenance scheduling, and alerting.

---

## Features

### Core
- **Hierarchical Asset Management** — Buildings → Floors → Work Areas → Sections → Workstations
- **Interactive Floor Plans** — drag-and-drop asset positioning, pan/zoom, minimap, grid snap, map export/print
- **Asset Connections (Wire Mode)** — model physical/logical links between devices on the floor map
- **Network Topology Graph** — force-directed graph of all asset connections
- **ITSM Integration** — sync hardware data from an external ITSM system (mock adapter included; 22 realistic records)
- **Global Search** — instant client-side prefix-indexed search across all assets (Ctrl+K)
- **3-Step CSV Import Wizard** — validate, preview, and bulk-import assets
- **Maintenance Calendar** — monthly calendar view of scheduled maintenance with CSV export
- **Maintenance Alerts** — daily cron (07:00) sends email and/or Microsoft Teams notifications for overdue/upcoming maintenance
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
- Docker Desktop
- Node.js 20+

### Start

```bash
git clone <repository-url>
cd factory-map
cp .env.example .env           # Fill in at minimum: MSSQL_PASSWORD, JWT_SECRET
docker-compose up -d           # Starts SQL Server 2022 + backend API on port 4000
cd frontend && npm install && npm start   # React dev server on port 3000
```

Open **http://localhost:3000** — you will be prompted to log in.

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
| Tests | Jest + Supertest (backend), RTL + MSW (frontend) |
| Containers | Docker Compose |

---

## Project Structure

```
factory-map/
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
│   │   ├── alert/             # AlertService — checkAndSend(), sendEmail(), sendTeams()
│   │   ├── auth/              # LdapAuthService
│   │   └── itsm/              # ITSMService + MockITSMAdapter + RealITSMAdapter + SyncService
│   ├── types/                 # api.types, asset.types, hierarchy.types, itsm.types
│   ├── utils/                 # passwordPolicy
│   └── server.ts              # Express bootstrap, Socket.io, daily cron for alerts
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
```

Backend tests use `--runInBand --forceExit` to avoid parallel DB conflicts. The `NODE_ENV=test` environment variable is set via a `setupFiles` entry before any module is imported, which prevents the server from binding a port during test runs.

---

## Documentation

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, data model, design patterns |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Installation, all env vars, user management, backup, production |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | API reference, code conventions, adding features |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | End-user walkthrough of every page and feature |
