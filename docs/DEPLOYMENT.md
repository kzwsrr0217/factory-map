# Deployment — Windows Server VM (corp VLAN)

Internal rollout for a small team reachable over the corp VLAN by hostname/IP
(no TLS cert required for this scope — see "Later: HTTPS" at the bottom if
that changes). Uses `docker-compose.prod.yml`, which differs from the dev
`docker-compose.yml` in three ways:

1. **No dev servers / bind mounts** — backend runs the compiled
   `dist/server.js`, frontend is a static build served by `nginx`
   (`frontend/Dockerfile.prod`), matching how the two Dockerfiles already
   build for production.
2. **MSSQL is never published to the host.** It's only reachable from the
   backend container over the internal `factory-map-network`. Do not add a
   `ports:` entry for it — this is the one hard rule in this doc.
3. **Real secrets required.** `config.ts` refuses to start with
   `NODE_ENV=production` unless `JWT_SECRET`, `MSSQL_PASSWORD`, and
   `CORS_ORIGIN` are all set to non-default values — this is enforced, not
   just documented.

## 1. Prerequisites on the VM

- Windows Server, domain-joined, with **Podman Desktop** (or Docker Desktop)
  installed — same tool you already use locally, just on the server. Podman
  Desktop on Windows needs WSL2 enabled (`wsl --install` / the "Windows
  Subsystem for Linux" feature) since containers run in a Linux VM under the
  hood.
- Podman/Docker's own service should be set to start automatically on boot
  (Podman Desktop → Settings, or the WSL2 distro's default-start behavior) —
  otherwise a VM reboot silently takes the app down until someone logs in.
- `git` available on the VM (to clone/pull the repo), or some other way of
  getting the repo contents onto it.

## 2. Firewall / VLAN rule

Only **two ports** need to be reachable from the VLAN — pick values (defaults
`8080` and `4000`) and open exactly those in Windows Firewall:

- `FRONTEND_PORT` (default `8080`) — the app itself.
- `BACKEND_PORT` (default `4000`) — the API + Socket.io (the frontend talks
  to this directly from users' browsers, it's not proxied).

**Do not open 1433** (or any MSSQL port) to the VLAN — `docker-compose.prod.yml`
doesn't publish it at all, so there's nothing to open regardless.

```powershell
New-NetFirewallRule -DisplayName "factory-map frontend" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "factory-map backend"  -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```

## 3. First-time deploy

```bash
git clone https://github.com/kzwsrr0217/factory-map.git
cd factory-map
cp .env.prod.example .env.prod
```

Edit `.env.prod`:
- Replace every `<VM-HOST>` with the VM's actual hostname or IP on the VLAN
  (whatever people will type into their browser) — `CORS_ORIGIN` and
  `REACT_APP_API_URL` must match exactly what ends up in the address bar
  (scheme + host + port), or the browser will reject the API calls as
  cross-origin.
- Generate a real `JWT_SECRET`: `openssl rand -hex 32`.
- Pick a real `MSSQL_PASSWORD` (8+ chars, 3 of 4 of upper/lower/digit/symbol).
- Leave `ITSM_MODE=snapshot` — this deployment has no path to live Alemba
  access (see §5), same constraint as the dev environment.

Build and start:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Run migrations (schema `synchronize` is off in production by design — see
`backend/src/config/database.ts`):

```bash
docker exec factory-map-backend npm run migration:run
```

Verify:

```bash
curl http://localhost:4000/health
```

Create the first admin account — the `/api/users` endpoint that creates users
already requires an authenticated admin (`requireAdmin` middleware), so on a
brand-new database there's a deliberate bootstrap step instead of a public
registration endpoint:

```bash
docker exec -it factory-map-backend npx ts-node -e "
import { AppDataSource } from './src/config/database';
import { User } from './src/entities/User.entity';
AppDataSource.initialize().then(async () => {
  const repo = AppDataSource.getRepository(User);
  await repo.save(repo.create({
    username: 'admin',
    password: 'CHANGE_ME_ON_FIRST_LOGIN',
    role: 'admin',
    email: 'admin@factory.local',
    active: true,
  }));
  console.log('admin created');
  process.exit(0);
});
"
```

Log in as `admin`, change the password immediately, then create real accounts
for the team through the UI (User Management) — this bootstrap step is only
ever needed once per fresh database.

From there, people on the VLAN reach the app at `http://<VM-HOST>:8080`.

## 4. Backup / restore (MSSQL volume)

The data lives entirely in the `mssql_data` named volume. Simplest backup —
a SQL-level dump, portable and restorable without matching container/volume
internals:

```bash
docker exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "<MSSQL_PASSWORD>" -No -Q \
  "BACKUP DATABASE [factorymap] TO DISK = N'/var/opt/mssql/backup.bak'"
docker cp factory-map-mssql:/var/opt/mssql/backup.bak ./factorymap-$(date +%Y%m%d).bak
```

Schedule this (Windows Task Scheduler running the two commands above, or a
cron-equivalent) and copy `.bak` files off the VM — a VM-level snapshot alone
won't give you an easy point-in-time restore of just the database.

Restore is the inverse: copy the `.bak` into the container, `RESTORE DATABASE`.

## 5. ITSM snapshot import on this VM

Per the read-only/no-live-calls constraint (see `ItsmHardwareSnapshot.entity.ts`),
this VM **never talks to Alemba directly** — it has no Kerberos/SSO path to it,
same limitation as local dev. The import stays a manual step from a
domain-joined machine, only the destination changes:

1. From your own machine (as today): run `ops/itsm/Export-ItsmMmhSnapshot.ps1`
   to produce `itsm-mmh-hardware.json`, plus the hand-exported
   `hardware-catalog-items.csv` and `persons.csv`.
2. Copy those three files onto the VM (network share, RDP clipboard/file
   copy, or `scp` if SSH is set up) — e.g. into `C:\temp\itsm-export\` on the
   VM.
3. Copy them into the running backend container and run the import against
   *this* database:

```powershell
podman cp C:\temp\itsm-export\. factory-map-backend:/tmp/itsm-export
podman exec factory-map-backend npm run import:itsm -- /tmp/itsm-export
podman exec factory-map-backend rm -rf /tmp/itsm-export
```

Re-run this whenever you refresh the snapshot (it's a full replace of
`itsm_hardware_snapshot`, matching the dev workflow).

## 6. Upgrades / redeploys

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker exec factory-map-backend npm run migration:run
```

`migration:run` is a no-op if there's nothing new to apply, so it's safe to
run on every deploy as a matter of habit.

## Later: HTTPS

Out of scope for this rollout (small internal team, IP/hostname access is
fine per current requirements). If this needs a real domain + TLS later, the
straightforward path is putting an nginx or IIS reverse proxy in front of
both `FRONTEND_PORT` and `BACKEND_PORT` with a cert from the internal CA,
updating `CORS_ORIGIN`/`REACT_APP_API_URL` to the `https://` domain, and
closing the two plain HTTP ports on the VLAN firewall.
