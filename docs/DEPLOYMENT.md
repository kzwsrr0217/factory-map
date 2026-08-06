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

Windows Server, domain-joined. Run these from an elevated PowerShell prompt
on the VM itself (e.g. via a BeyondTrust/remote-console session):

**1a. Enable WSL2** (containers run in a lightweight Linux VM under the hood
— this is required even though the app itself is "just" running on Windows):

```powershell
wsl --install --no-distribution
```

This enables the Windows-Subsystem-for-Linux and Virtual-Machine-Platform
features and installs the WSL2 kernel in one step. **Reboot the VM** after
this if prompted — a feature-enable on Windows Server almost always requires
one before WSL2 will actually work.

**1b. Install Podman** (the same tool used locally — avoids Docker Desktop's
per-seat licensing for organizational use):

```powershell
winget install -e --id RedHat.Podman
```

`winget` often isn't present on a Windows Server image (it ships with Win10/11
via the Microsoft Store, not Server) — if that command isn't recognized,
download and run the installer directly in a **browser** instead: search the
releases at `https://github.com/containers/podman/releases/latest` for the
Windows `.exe`/`.msi` installer asset. Podman **Desktop** (the GUI variant)
also works fine and is a reasonable alternative — it bundles the CLI and
usually walks through the machine setup below automatically on first launch.

Then, in a **new** PowerShell window (so PATH picks up the fresh install):

```powershell
podman machine init
podman machine start
podman info
```

`podman machine start` does the one-time work of creating the WSL2-backed
Podman VM — expect this first run to take a few minutes. `podman info`
succeeding confirms the machine is up. If the installer didn't add itself to
PATH (`podman: not recognized` even in a fresh window), either add
`%LOCALAPPDATA%\Programs\Podman` to your user `PATH` via
`[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\Programs\Podman", "User")`
— note this needs a **logoff or reboot** to take effect in a remote-console
session, opening a "new" window isn't enough — or just call it by full path /
`Set-Alias podman "$env:LOCALAPPDATA\Programs\Podman\podman.exe"` for the
current session in the meantime.

If `podman machine init`/`start` complains about the WSL version being too
old, this VM likely has the legacy "inbox" `wsl.exe` (bundled with the OS
image) rather than the newer Microsoft Store-distributed WSL app —
`wsl --version` not being a recognized flag confirms this. Update it with
`wsl --update --web-download` (pulls from GitHub instead of the Microsoft
Store, which a restrictive corporate proxy is more likely to allow); if that
also fails, download the `.msixbundle` from
`https://github.com/microsoft/WSL/releases/latest` in a browser and install
it with `Add-AppxPackage -Path "<downloaded file>"`. **Corporate networks
that heavily restrict outbound traffic may block command-line HTTP clients
(PowerShell, `wsl.exe`'s own updater) while still allowing normal browser
downloads** — if `winget`/`wsl --update` hit a 403 or similar, downloading
the same artifact via a browser instead is the reliable fallback throughout
this whole prerequisites section (git, Podman, WSL kernel/app updates,
Compose — all of it).

**1c. Install the Compose CLI** (`docker-compose.prod.yml` needs a compose
front-end — Podman itself doesn't parse compose files):

```powershell
winget install -e --id Docker.DockerCompose
```

Same `winget`-missing fallback as above: download
`docker-compose-windows-x86_64.exe` from
`https://github.com/docker/compose/releases/latest` in a browser, rename it
to `docker-compose.exe`, and drop it in the same folder as `podman.exe`
(`%LOCALAPPDATA%\Programs\Podman`) so it ends up on the same PATH entry.
Verify with `docker-compose --version` in a new shell.

Once network access from inside the WSL2 VM is proven working (the acid test
below), it's worth confirming compose can actually reach it too — this is
what `docker-compose ... up --build` will exercise for real (pulling base
images, running `npm install` during the build):

```powershell
podman pull docker.io/library/hello-world
```

This is a genuinely different network path than plain PowerShell commands —
even if `winget`/`wsl --update` were blocked above, image pulls from inside
the Podman VM may still work fine (they did in practice here).

**1d. Make Podman start on boot.** The `podman machine` VM is tied to the
Windows account that ran `podman machine init` (its state lives under that
user's profile), so the startup task must run as **that same account**, not
SYSTEM. Easiest done via Task Scheduler's GUI (`taskschd.msc`): New Task →
trigger "At startup" → action `podman machine start` → on the General tab,
"Run whether user is logged on or not" with that account's credentials. (A
one-line `schtasks`/`Register-ScheduledTask` equivalent needs that account's
password supplied non-interactively, which isn't worth scripting for a
one-time setup step.)

**1e. Git.** `winget install -e --id Git.Git` if it isn't already present, to
clone/pull the repo.

## 2. Port binding + firewall / VLAN rule

**Known Podman-on-Windows quirk**: published container ports (`ports:` in the
compose file) sometimes only bind to `127.0.0.1` on the Windows host, not all
interfaces — check with `netstat -an | findstr :4000`; if it shows
`127.0.0.1:4000` rather than `0.0.0.0:4000`, `localhost:4000` will work but
nothing else (not the VM's own real IP, not other machines on the VLAN) will
ever reach it, no matter what the firewall allows. Fix with a Windows-level
port proxy bridging "listen on all interfaces" → "forward to where Podman
actually put it" (a standard workaround for this exact class of WSL2/Docker
Desktop/Podman limitation, and unrelated to any firewall/security policy —
it doesn't open anything, just fixes local routing):

```powershell
netsh interface portproxy add v4tov4 listenport=4000 listenaddress=0.0.0.0 connectport=4000 connectaddress=127.0.0.1
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=127.0.0.1
netsh interface portproxy show all   # verify
```

Note that `podman ps` / `podman port` will *claim* the port is published on
`0.0.0.0` even when the real Windows-side listener is loopback-only — don't
trust it, trust `netstat`.

> ### ⚠️ The portproxy breaks on every container recreate — read before rebuilding
>
> **Podman must bind the port BEFORE the portproxy rule exists.** If the
> portproxy already holds `0.0.0.0:<port>` when a container is created, podman's
> host-side port publish silently fails, and the portproxy then forwards
> `0.0.0.0:4000 → 127.0.0.1:4000` — which is *itself*. Every request loops back
> and closes instantly: the browser shows `net::ERR_EMPTY_RESPONSE`,
> `Invoke-RestMethod` says "the connection was closed unexpectedly", and the
> backend logs show **no incoming requests at all** (it's healthy and connected
> to SQL Server, it just never sees the traffic). `netstat` gives it away:
> `0.0.0.0:4000` listening with no matching `127.0.0.1:4000` listener, plus a
> long tail of `127.0.0.1:4000 → 127.0.0.1:xxxxx TIME_WAIT` — the wreckage of
> the loop.
>
> Any `docker-compose ... up -d --build` that recreates a container triggers
> this. (A container compose leaves alone — "Running" rather than "Started" in
> its output — keeps working, which is why the frontend can serve the login page
> while the API is dead.) `podman restart` does **not** fix it: the container
> reuses the same broken port config rather than retrying the bind.
>
> So on every rebuild/redeploy, do it in this order:
> ```powershell
> netsh interface portproxy delete v4tov4 listenport=4000 listenaddress=0.0.0.0
> netsh interface portproxy delete v4tov4 listenport=8080 listenaddress=0.0.0.0
> docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
> netstat -an | findstr LISTENING | findstr ":4000 :8080"   # confirm podman bound them
> netsh interface portproxy add v4tov4 listenport=4000 listenaddress=0.0.0.0 connectport=4000 connectaddress=127.0.0.1
> netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=127.0.0.1
> ```
> If a container was already recreated with the rule in place, `podman restart`
> won't help — force a real recreate after deleting the rule:
> `docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --force-recreate backend`.
> Last-resort reset of podman's whole port-forwarding state:
> `podman machine stop; podman machine start`.

Separately, only **two ports** need to be reachable from the VLAN — pick
values (defaults `8080` and `4000`) and open exactly those:

- `FRONTEND_PORT` (default `8080`) — the app itself.
- `BACKEND_PORT` (default `4000`) — the API + Socket.io (the frontend talks
  to this directly from users' browsers, it's not proxied).

**Do not open 1433** (or any MSSQL port) to the VLAN — `docker-compose.prod.yml`
doesn't publish it at all, so there's nothing to open regardless.

```powershell
New-NetFirewallRule -DisplayName "factory-map frontend" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "factory-map backend"  -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```

**If security/firewall is managed centrally** at your organization (GPO-pushed
Windows Firewall policy, or a separate network-level firewall/ACL), creating
local rules yourself may get silently overridden on the next policy refresh,
or may simply not be the right channel — send whoever manages it a request to
allow inbound TCP on these two ports to this VM's hostname/IP from the VLAN,
same as any other network-change request. In practice, intra-VLAN traffic
between two machines may already be permitted by the central policy even
without an explicit local rule — worth just testing reachability from another
machine before assuming the ticket is required.

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
- Generate a real `JWT_SECRET`. From PowerShell (no `openssl` needed on a
  plain Windows Server box):
  `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`
- Pick a real `MSSQL_PASSWORD` (8+ chars, 3 of 4 of upper/lower/digit/symbol).
- Leave `ITSM_MODE=snapshot` — this deployment has no path to live Alemba
  access (see §5), same constraint as the dev environment.

Build and start:

```bash
docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Run migrations (schema `synchronize` is off in production by design — see
`backend/src/config/database.ts`):

```bash
docker exec factory-map-backend npm run migration:run
```

**On a genuinely fresh database, this will fail** — every migration in this
repo is an incremental delta written on top of a schema that dev environments
always got via `synchronize: true`; there's no "create everything from
scratch" migration, because until now nobody had deployed to a truly empty
database. Expect an error like `Cannot find the object "assets" because it
does not exist`. TypeORM rolls the failed migration back cleanly (each runs
in its own transaction), so this is safe to hit — fix it once, in order:

1. **Build the full current schema from the entities**, overriding just this
   one command's environment (not the running container) so `synchronize`
   turns on for a single pass:
   ```powershell
   podman exec -e NODE_ENV=development factory-map-backend node -e "require('./dist/config/database').connectDatabase().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })"
   ```
   Expect a long stream of `CREATE TABLE`/`CREATE INDEX` statements ending in
   "SQL Server connected successfully". This matches exactly what the
   migrations would have produced, since the entities are the current source
   of truth and migrations were written to keep pace with them.
2. **Baseline the migration history** so TypeORM knows these are already
   accounted for. Do not copy a list out of this document — an earlier version
   of it listed 7 of the 13 migrations and would have left six of them to be
   applied on top of a schema that already had them. Print the current list
   instead:
   ```bash
   docker exec factory-map-backend npm run verify:migrations
   ```
   That builds a throwaway database, walks these very steps on it, checks the
   result against the entities, and ends by printing the `INSERT INTO
   typeorm_migrations …` statement for exactly the migrations in the repo. Run
   the statement it prints:
   ```powershell
   podman exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "<MSSQL_PASSWORD>" -No -d factorymap -Q "<the INSERT it printed>"
   ```
3. Re-run `docker exec factory-map-backend npm run migration:run` — it
   should now say "No migrations are pending". Every *future* migration
   (added after this point) will apply normally from here on; this baseline
   step is only ever needed once, on the first deploy to a fresh database.

`npm run verify:migrations` is worth running before any deploy, not just the
first: it is the only check that notices when a migration has fallen behind an
entity, because every test suite runs against a `synchronize`d database and so
cannot.

### Alternative: starting from a copy of the development database

The normalisation round — the survey, the 128 rooms, the name corrections, the
recorded machine swaps — is a fortnight of judgement calls that live in the
development database and nowhere else. Redoing it against an empty production
database would mean making every one of those calls a second time, so the first
deployment starts from a restored copy instead.

Its **schema** is already correct: `synchronize` built it from the current
entities, which is exactly what `verify:migrations` confirms. Its **migration
history** is not, because development never needed one — only 2 of the 13
migrations are recorded, so `migration:run` on the server would try to apply
eleven deltas the schema already has.

1. **Back up development.** Both parameters are required; the password comes out
   of the env file rather than the command line:
   ```powershell
   .\ops\backup-factorymap.ps1 -EnvFile .env -Destination C:\temporary\factorymap-backups
   ```
2. **Copy the `.bak` to the VM** — network share or RDP file copy. It is around
   25 MB and it contains real names and assignments, so it is Confidential:
   put it somewhere with the same protection as the server itself, and delete
   the transfer copy afterwards.
3. **Restore it, over whatever is on the server now.** Read the dry run first —
   it prints the exact `RESTORE` statement and what the target currently holds,
   which is the last chance to notice that the target is not what you thought:
   ```powershell
   .\ops\restore-factorymap.ps1 -EnvFile C:\factorymap\.env.prod `
       -BakFile D:\transfer\factorymap-20260806-143939.bak `
       -SafetyBackupTo D:\backups\factorymap -DryRun
   ```
   Then without `-DryRun`. It backs up the database it is about to overwrite
   first and refuses to continue if that backup fails, stops the backend so the
   restore can take the database exclusively, reads the logical file names out of
   the `.bak` rather than assuming them, and starts the backend again. It ends by
   printing the two steps below, because both need a decision and neither should
   happen automatically.
4. **Mark the migrations the restored schema already contains.** Do not copy a
   list from here — print the current one, which is computed from the database
   you are about to copy:
   ```bash
   docker exec factory-map-backend npm run verify:migrations
   ```
   Its last section names the unrecorded migrations and gives the `INSERT INTO
   typeorm_migrations …` for exactly those. Run it against the restored database.
5. `docker exec factory-map-backend npm run migration:run` — expect "No
   migrations are pending". If it instead starts applying things, stop: the
   baseline did not take, and the safety backup from step 3 is the way back.
6. **Clear out what only belonged in development.** The test suites leave users
   behind, and the seeded accounts carry passwords that are in this repository.
   Read the list first, then remove them, then change the admin password —
   before anyone else can reach the server:
   ```bash
   docker exec factory-map-backend npm run prune:dev-accounts
   docker exec factory-map-backend npm run prune:dev-accounts -- --apply
   docker exec -it factory-map-backend npm run set:password -- --username admin
   ```
   The prune deliberately refuses to delete an admin and leaves `operator` /
   `viewer` alone — they may be accounts somebody means to use — so change or
   delete those by hand.
7. Confirm `ITSM_MODE=snapshot` in `.env.prod`. With `mock` the per-asset "Check
   ITSM" button compares real assets against fabricated data and writes
   `missing` onto every one of them — the reconcile page reports the mode for
   this reason, and it is worth a look at after the first start.
8. Open the **Normalisation run** page. It should say the export was loaded, the
   survey applied, and the comparison is current. If it warns that nothing has
   been compared against the current export, press **Compare all** — the stored
   verdicts came over with the backup and are only as fresh as the last run on
   development.

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
**Always browse to it using that exact hostname/port** — including when
testing from the VM itself. Browsing via `localhost:8080` instead will load
the page fine but then fail login with a CORS error (`Access-Control-Allow-Origin`
mismatch), since `CORS_ORIGIN` is configured for `<VM-HOST>:8080` specifically,
not `localhost`. The frontend shows this as a generic "Invalid username or
password" — check the browser DevTools Network/Console tab if login fails
unexpectedly to tell a real credential problem apart from a connectivity/CORS
one.

## 4. Backup / restore (MSSQL volume)

The data lives entirely in the `mssql_data` named volume. Simplest backup —
a SQL-level dump, portable and restorable without matching container/volume
internals:

```bash
docker exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "<MSSQL_PASSWORD>" -No -Q \
  "BACKUP DATABASE [factorymap] TO DISK = N'/var/opt/mssql/backup.bak'"
docker cp factory-map-mssql:/var/opt/mssql/backup.bak ./factorymap-$(date +%Y%m%d).bak
```

### Scheduling it

Use `ops/backup-factorymap.ps1` rather than the two commands by hand. It reads
`MSSQL_PASSWORD` out of the deployment's own `.env.prod` (so the secret isn't
duplicated into the task's arguments or into the log), writes a dated `.bak`,
deletes the in-container copy so the volume doesn't grow, prunes host files older
than `-KeepDays`, and **exits non-zero if the file is missing or suspiciously
small** — a nightly task that reports success while producing nothing is worse
than no task.

```powershell
C:\factorymap\ops\backup-factorymap.ps1 -EnvFile C:\factorymap\.env.prod -Destination D:\backups\factorymap
```

Register it (run once, as the same account that owns the podman machine):

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\factorymap\ops\backup-factorymap.ps1" -EnvFile "C:\factorymap\.env.prod" -Destination "D:\backups\factorymap"'
$trigger = New-ScheduledTaskTrigger -Daily -At 01:30
Register-ScheduledTask -TaskName 'factorymap-backup' -Action $action -Trigger $trigger `
  -Description 'Nightly factorymap DB backup' -RunLevel Highest
```

> **The scheduled-task gotcha here:** podman on Windows runs inside the *user's*
> WSL2 session, so `podman exec` only works while that session exists. A task set
> to "Run whether user is logged on or not" will fail every night with a
> connection error. Either register it under the same account with **Run only
> when user is logged on**, or make the podman machine start at boot and confirm
> `podman ps` works from a non-interactive session before trusting the schedule.
> Check the task's Last Run Result after the first night — this is exactly the
> kind of thing that silently never runs.

**Copy the `.bak` files off the VM.** A VM-level snapshot alone won't give you an
easy point-in-time restore of just the database, and a backup that lives only on
the machine it protects isn't a backup.

What is worth protecting, concretely: the ITSM snapshot can be re-exported from
Alemba, but the **zones, work-area rectangles, socket labels and every manual
placement** were entered by hand and exist nowhere else.

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

Use the script:

```powershell
cd C:\factory-map\ops
.\deploy-factorymap.ps1 -Root C:\factory-map -HostName <VM-HOST>
```

It does the whole sequence below and stops at the first failure, saying what state
that leaves behind — in particular, if it dies while the portproxy rules are down it
says so and prints the commands to restore them, because that is the state in which
the app looks healthy and is unreachable.

`-DryRun` prints every step without running any of it. `-SkipPull` deploys what is
already checked out, which is what you want when re-running after a failed step. With
uncommitted changes in the checkout it refuses to pull rather than deciding for you
whether a hotfix someone made on the VM should survive.

The manual sequence, which the script follows and which is still what to fall back on
if it fails midway — recreating a container silently breaks the port proxy (see the
warning in §2), so the portproxy rules have to come down before the rebuild and go
back up after, otherwise the app comes back up "healthy" but unreachable:

```powershell
cd C:\factory-map
git pull
netsh interface portproxy delete v4tov4 listenport=4000 listenaddress=0.0.0.0
netsh interface portproxy delete v4tov4 listenport=8080 listenaddress=0.0.0.0
docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
podman exec factory-map-backend npm run migration:run
netstat -an | findstr LISTENING | findstr ":4000 :8080"
netsh interface portproxy add v4tov4 listenport=4000 listenaddress=0.0.0.0 connectport=4000 connectaddress=127.0.0.1
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=127.0.0.1
Invoke-RestMethod http://<VM-HOST>:4000/health
```

`migration:run` is a no-op if there's nothing new to apply, so it's safe to
run on every deploy as a matter of habit. The closing `/health` check against
the **real hostname** (not `localhost`) is the one that actually proves the
deploy is reachable — `localhost` works even when the portproxy is broken.

## Later: HTTPS

Out of scope for this rollout (small internal team, IP/hostname access is
fine per current requirements). If this needs a real domain + TLS later, the
straightforward path is putting an nginx or IIS reverse proxy in front of
both `FRONTEND_PORT` and `BACKEND_PORT` with a cert from the internal CA,
updating `CORS_ORIGIN`/`REACT_APP_API_URL` to the `https://` domain, and
closing the two plain HTTP ports on the VLAN firewall.
