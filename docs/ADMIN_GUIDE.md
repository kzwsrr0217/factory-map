# Factory Map — Administrator Guide

## Table of Contents
1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Environment Variables](#environment-variables)
4. [First-Time Setup](#first-time-setup)
5. [User Management](#user-management)
6. [LDAP / Active Directory Integration](#ldap--active-directory-integration)
7. [ITSM Integration](#itsm-integration)
8. [Database Management](#database-management)
9. [Security Considerations](#security-considerations)
10. [Backup & Restore](#backup--restore)
11. [Monitoring & Logs](#monitoring--logs)
12. [Troubleshooting](#troubleshooting)
13. [Production Deployment](#production-deployment)

---

## System Requirements

### Minimum server requirements
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB |
| OS | Windows Server 2019 / Ubuntu 20.04 | Windows Server 2022 / Ubuntu 22.04 |

### Software requirements
- **Docker Desktop** (Windows/Mac) or **Docker Engine + Compose** (Linux)
- **Node.js 20+** (only if running without Docker)
- **Python 3.x** (only for data import scripts)

### Network requirements
- Port **5174** — React frontend (or configured port)
- Port **4000** — Node.js backend API
- Port **1433** — SQL Server (internal; do not expose to internet)
- Outbound access to ITSM API URL (if using real ITSM mode)
- Outbound access to LDAP server port (389 or 636) if using LDAP

---

## Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd factory-map
```

### 2. Configure environment variables
```bash
cp .env.example .env
# Edit .env with your settings (see Environment Variables section)
```

### 3. Start with Docker Compose
```bash
docker-compose up -d
```

This starts:
- `factory-map-mssql` — SQL Server 2022 on port 1433
- `factory-map-backend` — Node.js API on port 4000
- `factory-map-frontend` — React dev server on port 5174 (when using Docker)

### 4. Start the frontend (development — without Docker)
```bash
cd frontend
npm install
npm start
```

The frontend runs on `http://localhost:5174`.

### 5. Verify installation
```bash
curl http://localhost:4000/health
# Expected: {"status":"OK","timestamp":"...","environment":"development","itsm_mode":"mock"}
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. **Never commit `.env` to version control.**

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `MSSQL_HOST` | `localhost` | SQL Server hostname or IP |
| `MSSQL_PORT` | `1433` | SQL Server port |
| `MSSQL_USER` | `sa` | SQL Server username |
| `MSSQL_PASSWORD` | — | SQL Server password (**required**) |
| `MSSQL_DATABASE` | `factorymap` | Database name |
| `MSSQL_ENCRYPT` | `false` | Encrypt connection (set `true` in production) |
| `MSSQL_TRUST_CERT` | `true` | Trust self-signed cert (set `false` in production with valid cert) |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` / `BACKEND_PORT` | `4000` | Backend listen port |
| `JWT_SECRET` | — | **Required in production.** Long random string (min 32 chars). Use `openssl rand -hex 32` |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `http://localhost:4000/api` | Backend API base URL seen by the browser |
| `REACT_APP_PUBLIC_BASE_URL` | _(empty)_ | Public hostname used in asset QR codes (see below) |

#### `REACT_APP_PUBLIC_BASE_URL` — QR Code URLs

Asset QR codes embed a deep-link URL so scanning them navigates directly to that asset in the app. By default the URL is built from `window.location.origin`, which is the hostname the user has open in their browser. This works correctly when the app is accessed via the server's real IP or hostname from a phone on the same network.

If your deployment uses a fixed public hostname, set this variable so QR codes always contain the correct URL regardless of which machine they were printed from:

```
REACT_APP_PUBLIC_BASE_URL=http://factorymap.yourcompany.com
```

Leave it empty for local/development use — `window.location.origin` will pick up the correct IP automatically.

### ITSM Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `ITSM_MODE` | `mock` | `mock` (in-memory fake data) or `real` (calls real ITSM API) |
| `ITSM_REAL_API_URL` | — | Base URL of the ITSM REST API (required when `ITSM_MODE=real`) |
| `ITSM_API_KEY` | — | API key for ITSM authentication |
| `ITSM_WEB_URL` | — | Web UI base URL (used to construct ticket links) |
| `ITSM_SYNC_INTERVAL` | `300000` | Auto-sync interval in ms (currently not auto-triggered; manual only) |

### Maintenance Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname (e.g., `smtp.office365.com`) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` for port 465 (TLS), `false` for STARTTLS |
| `SMTP_USER` | — | SMTP username / email address |
| `SMTP_PASS` | — | SMTP password or app password |
| `SMTP_FROM` | `factory-map@company.local` | Sender address shown to recipients |
| `TEAMS_WEBHOOK_URL` | — | Microsoft Teams incoming webhook URL |

All SMTP/Teams variables are optional — alerts are silently skipped for unconfigured channels. Configure alert thresholds and recipients in the **Alerts** page (`/alerts`) in the application UI.

### LDAP / Active Directory (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `LDAP_ENABLED` | `false` | Set `true` to enable LDAP authentication |
| `LDAP_URL` | `ldap://localhost:389` | LDAP server URL (use `ldaps://` for TLS) |
| `LDAP_BIND_DN` | — | Service account DN for searching (e.g., `CN=svc-factorymap,OU=Service Accounts,DC=corp,DC=local`) |
| `LDAP_BIND_PASSWORD` | — | Service account password |
| `LDAP_SEARCH_BASE` | — | Where to search for users (e.g., `OU=Users,DC=corp,DC=local`) |
| `LDAP_SEARCH_FILTER` | `(sAMAccountName={{username}})` | Filter template; `{{username}}` is replaced with the login username |
| `LDAP_USERNAME_ATTR` | `sAMAccountName` | Attribute containing the username |
| `LDAP_TLS_ENABLED` | `false` | Enable TLS for the LDAP connection |
| `LDAP_DEFAULT_ROLE` | `viewer` | Role assigned to newly provisioned LDAP users |

---

## First-Time Setup

### Default admin account
On first startup, TypeORM's `synchronize` option creates all tables. There is no default admin user — you must create one manually.

**Option 1: Via the REST API**
```bash
# First, create a temporary admin directly in the database
docker exec -it factory-map-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "YourPassword" -d factorymap \
  -Q "INSERT INTO users (id, username, password, role, active, auth_provider, failed_login_attempts, created_at, updated_at) VALUES (NEWID(), 'admin', '\$2b\$12\$...bcrypt-hash...', 'admin', 1, 'local', 0, GETDATE(), GETDATE())"
```

**Option 2: Use the TypeScript seed script (development only)**
```bash
# Run inside the backend container — creates admin/Admin@1234 plus ~118 sample assets
docker exec factory-map-backend npx ts-node src/scripts/seed-mssql.ts
# Change the admin password immediately after
```

**Option 3: Add bootstrap endpoint** (recommended for production — see Adding New Features in Developer Guide)

### Change default passwords immediately
After first login, navigate to **Settings → Change Password** and set a strong password that meets the policy:
- At least 8 characters
- Uppercase + lowercase + digit + special character

---

## User Management

### Roles

| Role | Permissions |
|------|-------------|
| `viewer` | Read-only: browse all buildings, floors, assets, reports, audit log |
| `operator` | viewer + create/edit assets, manage connections, upload floor plans, add/edit hierarchy (buildings, floors, work areas, sections) |
| `admin` | operator + user management, delete buildings/floors, system settings |

### Creating a user (via UI)
1. Log in as admin
2. Navigate to **Settings → User Management**
3. Click **Create User**
4. Fill in username, password, role, and optional email
5. Click **Save**

### Creating a user (via API)
```bash
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"username":"jsmith","password":"SecurePass1!","role":"operator","email":"jsmith@company.com"}'
```

### Account lockout
After **5 failed login attempts**, an account is locked for **30 minutes**. Admins can unlock immediately via the User Management page (deactivate → activate).

### Password expiry
Passwords expire after **90 days**. Users see a warning on login. The app does not force a password change — it is the admin's responsibility to enforce this policy.

---

## LDAP / Active Directory Integration

### Setup
1. Set `LDAP_ENABLED=true` in `.env`
2. Configure all `LDAP_*` variables
3. Restart the backend: `docker-compose restart factory-map-backend`

### How it works
1. User clicks "Sign in with Active Directory" on the login page
2. Backend binds to LDAP with the service account
3. Searches for the user using `LDAP_SEARCH_FILTER`
4. If found, binds with the user's credentials to verify the password
5. User is auto-provisioned in the database (role = `LDAP_DEFAULT_ROLE`) on first login
6. On subsequent logins, the user record is updated (LDAP DN, email, last_login)

### Example configuration for Active Directory
```env
LDAP_ENABLED=true
LDAP_URL=ldap://dc01.corp.local:389
LDAP_BIND_DN=CN=svc-factorymap,OU=Service Accounts,DC=corp,DC=local
LDAP_BIND_PASSWORD=ServiceAccountPass1!
LDAP_SEARCH_BASE=DC=corp,DC=local
LDAP_SEARCH_FILTER=(sAMAccountName={{username}})
LDAP_USERNAME_ATTR=sAMAccountName
LDAP_DEFAULT_ROLE=viewer
```

### Assigning roles to LDAP users
LDAP users start with `LDAP_DEFAULT_ROLE`. An admin must manually upgrade their role via the User Management page.

---

## Maintenance Alerts

The backend sends email and/or Microsoft Teams notifications on two schedules:
- **Daily at 07:00** — checks all assets for overdue or upcoming maintenance
- **Hourly (top of the hour)** — fires any user-created **scheduled one-off alerts** whose time has passed

### Setup
1. Configure `SMTP_*` and/or `TEAMS_WEBHOOK_URL` in `.env`
2. Restart the backend: `docker-compose restart factory-map-backend`
3. Log in as admin and navigate to **Alerts** (`/alerts`)
4. Set the **Days before alert** threshold (default: 7)
5. Enable Email and/or Teams, enter recipients/webhook
6. Click **Test Now** to verify delivery

### Scheduled one-off alerts
In addition to the daily maintenance check, admins can schedule one-time alerts for any future date and time. These are stored in the `scheduled_alerts` table and fired by the hourly cron.

```bash
# Create a scheduled alert (API)
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Quarterly review","scheduled_for":"2026-06-01T09:00:00Z","channels":"email"}' \
  http://localhost:4000/api/alerts/scheduled

# List scheduled alerts
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/alerts/scheduled

# Delete a scheduled alert
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:4000/api/alerts/scheduled/<id>
```

### Alert history
The **Alert History** section on the Alerts page shows the last 50 alert sends with status (success/failure), channel, and error message if applicable.

### API access
```bash
# Get current config
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/alerts/config

# Trigger immediate check (admin only)
curl -X POST -H "Authorization: Bearer <token>" http://localhost:4000/api/alerts/test

# Recent alert log
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/alerts/logs
```

---

## API Documentation (Swagger)

Interactive API documentation is available at:
```
http://localhost:4000/api/docs
```
All endpoints are listed and can be tested directly from the browser. Click **Authorize** and enter your JWT token to make authenticated requests. The raw OpenAPI spec is at `http://localhost:4000/api/docs.json`.

---

## ITSM Integration

### Mock mode (default)
In `ITSM_MODE=mock`, the backend uses an in-memory dataset of 22 realistic hardware records. Use this for development and testing.

### Real mode
1. Set `ITSM_MODE=real`, `ITSM_REAL_API_URL`, and `ITSM_API_KEY`
2. The developer must implement the real adapter (see Developer Guide → Implementing the Real ITSM adapter)

### Manual sync
Navigate to **Reports** → click **Sync All from ITSM**. The sync runs synchronously and reports counts of created/updated/snapshotted/skipped assets.

### Sync behavior
| Scenario | Action |
|----------|--------|
| Hardware in ITSM but not in Factory Map | Creates new asset (source_of_truth = 'itsm') |
| Existing asset managed by ITSM (`source_of_truth = 'itsm'`) | Overwrites ITSM fields if modified |
| Existing asset managed locally (`source_of_truth = 'local'`) | Stores snapshot for review; operator must manually accept |
| ITSM hardware unchanged since last sync | Skipped |

---

## Database Management

### Schema management
TypeORM `synchronize: true` is enabled in non-production environments. It **automatically creates and alters tables** on each startup to match the entity definitions. **Do not use `synchronize: true` in production** — use TypeORM migrations instead.

### Viewing the database
Using sqlcmd inside the Docker container:
```bash
docker exec -it factory-map-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "YourPassword" -d factorymap
```

### Common SQL operations
```sql
-- List all tables
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE';

-- Count assets
SELECT COUNT(*) FROM assets;

-- Find assets with open work items
SELECT display_name, work_items FROM assets WHERE work_items IS NOT NULL;

-- List users
SELECT username, role, active, last_login FROM users;

-- Clear all assets (preserve users)
SET QUOTED_IDENTIFIER ON;
DELETE FROM asset_connections;
DELETE FROM asset_software;
DELETE FROM assets;
```

### Clearing test data
```bash
# Re-seed after clearing (runs inside the backend container)
docker exec factory-map-backend npx ts-node src/scripts/seed-mssql.ts
```

---

## Security Considerations

### Production checklist
- [ ] Set a strong `JWT_SECRET` (at least 32 random characters): `openssl rand -hex 32`
- [ ] Set a strong `MSSQL_PASSWORD`
- [ ] Set `NODE_ENV=production`
- [ ] Set `MSSQL_ENCRYPT=true` and use a valid TLS certificate
- [ ] Set `MSSQL_TRUST_CERT=false` (use a proper CA-signed cert)
- [ ] Update the CORS `origin` whitelist in `backend/src/server.ts` to your production domain
- [ ] Do not expose port 1433 (SQL Server) outside the Docker network
- [ ] Use a reverse proxy (nginx/IIS/Traefik) with HTTPS in front of port 4000
- [ ] Enable firewall rules to restrict access to admin ports
- [ ] Review user accounts and ensure all default passwords are changed

### Helmet security headers
The backend uses `helmet` middleware which sets these headers automatically:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (in production)
- `Content-Security-Policy`

### Rate limiting
Login attempts are rate-limited to **20 requests per 15 minutes** per IP. This prevents brute-force password attacks.

### Audit trail
All create, update, and delete operations on assets are recorded in `audit_logs` with the user ID, username, timestamp, IP address, and a diff. Audit logs are append-only and cannot be deleted through the application.

---

## Backup & Restore

### Database backup (SQL Server)
```bash
# Create backup inside the container
docker exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "YourPassword" \
  -Q "BACKUP DATABASE factorymap TO DISK = '/var/opt/mssql/data/factorymap.bak' WITH INIT"

# Copy backup to host
docker cp factory-map-mssql:/var/opt/mssql/data/factorymap.bak ./backups/factorymap_$(date +%Y%m%d).bak
```

### Database restore
```bash
docker cp ./backups/factorymap_backup.bak factory-map-mssql:/var/opt/mssql/data/

docker exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "YourPassword" \
  -Q "RESTORE DATABASE factorymap FROM DISK = '/var/opt/mssql/data/factorymap_backup.bak' WITH REPLACE"
```

### What to back up
- SQL Server database (all application data)
- `.env` file (configuration)
- Any uploaded floor plan files (currently stored as base64 in the database, so the DB backup covers them)

### Backup schedule recommendations
| Data | Frequency |
|------|-----------|
| Database | Daily (automated, e.g., Task Scheduler or cron) |
| Config (.env) | On each change |
| Docker volumes | Weekly |

---

## Monitoring & Logs

### Health check endpoint
```bash
GET http://localhost:4000/health
```
Returns `{"status":"OK","timestamp":"..."}`. Use this for uptime monitoring (e.g., UptimeRobot, Nagios, Zabbix).

### Application logs
In development (`NODE_ENV=development`), HTTP requests are logged by Morgan to stdout:
```
GET /api/assets 200 45ms
```

View live backend logs:
```bash
docker-compose logs -f factory-map-backend
```

### Audit log (application)
The audit log is accessible in the UI at **Audit Log** page (admin/operator role required). It records all asset changes with user, timestamp, and diff.

You can also query it directly:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/audit?entity_type=asset&limit=50"
```

---

## Troubleshooting

### Backend won't start
**Symptom**: `docker-compose logs factory-map-backend` shows "SQL Server connection error"

**Cause**: SQL Server is still initializing (takes 30–60 seconds on first start)

**Fix**: Wait and retry, or increase the restart delay:
```bash
docker-compose restart factory-map-backend
```

### "Too many login attempts" error
**Cause**: Rate limiter triggered (20 attempts / 15 minutes per IP)

**Fix**: Wait 15 minutes, or if the server is behind a proxy, ensure `X-Forwarded-For` headers are set correctly.

### Account locked
**Cause**: 5 consecutive failed login attempts

**Fix**: Admin deactivates the user and re-activates them in User Management, which resets the lockout counter.

### ITSM sync shows "Real ITSM adapter not yet implemented"
**Cause**: `ITSM_MODE=real` is set but the real adapter is not implemented

**Fix**: Either set `ITSM_MODE=mock`, or implement `RealITSMAdapter.ts` (see Developer Guide).

### Frontend shows "Network Error" or assets don't load
**Cause**: Backend is down, or `REACT_APP_API_URL` environment variable is wrong

**Fix**:
1. Check backend is running: `docker-compose ps`
2. Check `frontend/.env` or `frontend/src/services/api.ts` for the API URL
3. Verify port 4000 is accessible from the frontend host

### TypeORM "Cannot find column" or schema errors
**Cause**: Entity was modified but TypeORM `synchronize` didn't apply the change

**Fix**: Restart the backend — TypeORM will re-sync:
```bash
docker-compose restart factory-map-backend
```
If the column was removed, TypeORM does **not** drop it automatically. Drop the column manually in SQL Server.

### nodemon stopped watching (backend not reloading)
**Cause**: A crash caused nodemon to enter "waiting for changes" state

**Fix**:
```bash
docker-compose restart factory-map-backend
```

### Floor plan upload fails
**Cause**: Image too large (limit is 20 MB base64-encoded)

**Fix**: Compress the image before upload. SVG files are preferred as they are usually smaller.

---

## Production Deployment

### Docker Compose (single server)
Update `docker-compose.yml` for production:
1. Set `NODE_ENV=production`
2. Remove the `synchronize: true` behavior (add TypeORM migrations)
3. Set resource limits (`cpus`, `mem_limit`)
4. Use a named volume for the SQL Server data directory

### Reverse proxy (nginx example)
```nginx
server {
    listen 443 ssl;
    server_name factorymap.company.local;

    ssl_certificate /etc/ssl/factorymap.crt;
    ssl_certificate_key /etc/ssl/factorymap.key;

    # Frontend
    location / {
        proxy_pass http://localhost:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Backend API + WebSocket
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /socket.io {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Serving the React build
In production, build the React app and serve it as static files:
```bash
cd frontend && npm run build
# Serve the build/ directory with nginx or express-static
```
