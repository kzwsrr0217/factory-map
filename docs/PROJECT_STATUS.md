# Project Status & Handoff — factorymap

> **Read this first if you're a new session with no prior context.** It's a
> point-in-time snapshot of where the project stands, why, and what's next.
> Last updated: 2026-07-27 (Phase 13 — /code-review fixes; SSO login planned next).

---

## 1. What this project is

**factorymap** is a full-stack TypeScript app (React + Node/Express + MSSQL via
TypeORM, run in Docker/Podman) for tracking and visualizing IT/OT assets in a
factory: buildings → floors → work areas → sections → workstations, an
interactive floor-plan map, a physical network-infrastructure model (rooms →
racks → patch panels → wall ports), ITSM (Alemba) reconcile, maintenance
alerting, RBAC, and an immutable audit log.

Full feature list: [README.md](../README.md). Architecture & data model:
[ARCHITECTURE.md](../ARCHITECTURE.md). Data-model history:
[DATA_MODEL_MIGRATION.md](DATA_MODEL_MIGRATION.md).

## 2. The overarching goal (why recent work happened)

There are three internal apps doing overlapping things. The decision:
**don't touch `shopfloor_visualizer`** (owned by Matthias — its PRD is at
`shopfloor_visualizer/PRD.md` in his own working tree, a sibling directory),
and instead evolve factorymap so it (a) models real-world factory usage
faithfully and (b) can **eat the exact same IFS/CMDB data Matthias's app eats**,
so the two can be compared and, eventually, share a data source.

The head-to-head data-model comparison is written up in
[DATA_STRUCTURE.md](DATA_STRUCTURE.md) — the single best doc for "how does
factorymap line up against Matthias's app". Short version: factorymap's
strengths are exactly what his PRD lists as explicit non-goals (RBAC, audit,
maintenance/alerting, reporting, network infrastructure, two-way ITSM
reconcile, asset lifecycle/replace); his strengths are the 3D view, camera
fly-to, grid-snap/rotation, and OSM backdrop, which factorymap doesn't have.

## 3. Current state (all on `main`, pushed to GitHub)

Repo: `github.com/kzwsrr0217/factory-map`. Everything below is merged to
`main` and pushed. Recent history (newest first):

- `eb51212` Merge: **full IFS/CMDB ingest parity + import script** (phase 8)
- `4bf5a28` Merge: **network-infra lifecycle + live-audit fixes + docs** (phase 7)
- earlier: phases 1-6 (master data, org hierarchy, SVG floor plans, workstation
  drag, backend test coverage) + a parallel branch of test-coverage/UI polish
  that was already on `main` when we merged.

### What the last two work rounds delivered

**Phase 7 — live-use-case audit** (worked through realistic scenarios against
the running app and fixed every reproduced gap):
- Network-infra delete guards (can't delete a rack/room/floor/building that
  still holds mounted assets / wall ports / rooms) + wall-port collision guard
  (two ports can't share a patch-panel or switch port).
- **Replace endpoints** for rack cabinets and patch panels (physical swap moves
  everything to the replacement), mirroring the existing asset replace; and a
  fix so replacing a *switch* asset re-points the wall ports wired to it.
- **Retired-asset pollution fixes**: a replaced asset (`successor_id` set) is
  now excluded from maintenance counts/calendar, reports, unplaced list, the
  daily alert cron, ITSM reconcile list, and — importantly — the ITSM **sync**
  (which previously "resurrected" a decommissioned asset's fields).
- `is_placed` recompute on rack-unmount; future `maintenance.last_date`
  rejected (422); CSV/JSON **bulk import fixed** (empty-string hierarchy fields
  were 400-ing every row — now sent as `null`); frontend error toasts now
  surface the real backend message (`getApiErrorMessage`).
- RBAC and audit-log immutability verified live (no gap — no code change).

**Phase 8 — IFS/CMDB ingest parity** (the "eat the same data" goal):
- Widened `master_assets` / `production_lines` / `work_centers` / `entity_kinds`
  with the **full** column set of Matthias's real export shapes — all new
  columns **optional/nullable**, verified against his actual ingest scripts and
  sample JSON (not guessed).
- **`npm run import:master -- <dir>`** (`backend/src/scripts/import-master-data.ts`):
  idempotent, layout-safe importer that reads the exact files his ingest
  scripts produce (`masterData.json`, `OTAssetData.json`, `production_lines.json`,
  `workcenters.json`, `entity_kinds.json`), merging the machines + OT-assets
  shapes into one `master_assets` row per `ifs_id` (an OT asset's `parent_id`
  becomes `ifs_machine_id` — the same machine↔device parent join his app uses).
- Verified end-to-end against his **real MMAG export**: 528 machines + 580 OT
  assets → 943 master rows, 79 production lines, 572 work centers, 3 entity
  kinds; parent join resolves; idempotent on re-run.

**Phase 9 — ITSM MMH-scoped snapshot + demo-data cleanup** (not yet committed —
see §7 below):
- `ITSM_MODE=snapshot` (`SnapshotITSMAdapter`) — zero live ITSM calls, reads a
  new `itsm_hardware_snapshot` landing table populated by
  `ops/itsm/Export-ItsmMmhSnapshot.ps1` (one MMH-filtered OData call, run on a
  domain-joined machine — **not yet actually run for real**) +
  `npm run import:itsm -- <dir>` (full replace per run).
- `GET /api/itsm/reconcile/unlinked-mmh` — the reverse reconcile direction
  ("ITSM has it, factorymap doesn't"), and `POST /api/itsm/reconcile/unlinked-mmh/create`
  to materialise selected snapshot rows into real, **unplaced** local assets
  (ITSM has no floor-plan geometry, so a human still places them on the map).
  Both verified end-to-end with fictitious snapshot rows (not real MMH data).
- At the user's request, **all 45 demo Asset rows were deleted** from the dev
  DB via the existing per-asset delete endpoint (keeps audit/wall-port/connection
  cleanup consistent) — building/floor/work-area/section/workstation hierarchy
  was intentionally left intact, then **repopulated with all 1057 real MMH
  ITSM hardware assets** (unplaced) — see above.

## 4. ⚠️ Current DB state gotcha

During phase 8 verification, Matthias's **real MMAG master data was imported
into the running dev database** (943 `master_assets` rows etc.), on top of the
demo seed. This is harmless — it's additive, and no app-owned layout was
touched — but it means `master_assets` is **not** pristine demo data.

**As of phase 9, the `assets` table is no longer demo data either**: all 45
demo assets were deleted and replaced with **1057 real MMH hardware assets
from ITSM** (unplaced — none have floor-plan coordinates yet; ITSM has no
geometry to place them from). `itsm_hardware_snapshot` (1057 rows) and
`hardware-catalog-items.csv`'s resolved fields are baked into those asset
rows via `backfillAssetsFromSnapshot()` — re-running the import + backfill
is idempotent (never overwrites a field that already has a value) and safe
to repeat once a fresher ITSM export is available. To restore the minimal
**demo** state instead (e.g. for a pilot/demo walkthrough, not real MMH work):

```bash
podman exec factory-map-backend npm run seed        # buildings/floors/assets/users (also clears master data)
podman exec factory-map-backend npm run seed:itsm   # ITSM reconcile demo links
```

To re-import the IFS data any time, copy the export dir into the container and
run `npm run import:master -- <dir>` (it can't see host paths directly — the
`shopfloor_visualizer` data dir is not mounted into the container).

## 5. How to run & verify

- Stack: three Podman containers — `factory-map-mssql`, `factory-map-backend`
  (port 4000), `factory-map-frontend` (port 5174). `docker-compose.yml` /
  `podman compose up -d`.
- Login: `admin` / `Admin@1234`.
- Dev uses TypeORM `synchronize: true`, so entity changes auto-apply on backend
  restart; hand-written migrations exist too (`backend/src/migrations/`) for the
  prod path.
- **Verification method used this session** (by explicit user preference):
  `tsc --noEmit` on both `backend/` and `frontend/`, plus purpose-written Node
  scripts hitting the live API — **the Jest suite is run manually by the user,
  not by the assistant.** Browser checks via the in-app browser (port 5174).
- Podman/WSL2 networking can occasionally wedge (`wslrelay.exe` stuck — accepts
  TCP but responses don't route back); the fix is a full `wsl --shutdown` then
  `podman machine start` + restart the 3 containers. This is infra, not code.

## 6. What's deferred / candidate next steps

- **ITSM asset-data reconciliation + real MMH population — done (Phase 9).**
  A real, currently-running reconciliation script for this ITSM instance
  (outside this repo) revealed the live Alemba contract differs from what
  `RealITSMAdapter` assumed (Kerberos SSO not bearer token, OData `$filter`
  not free-text, nested nav-property fields not flat captions) — and that the
  backend's Podman container has no confirmed way to authenticate to ITSM
  directly. Built `ITSM_MODE=snapshot` instead: `SnapshotITSMAdapter` (zero
  live ITSM calls) reads a landing table (`itsm_hardware_snapshot`) populated
  by `ops/itsm/Export-ItsmMmhSnapshot.ps1` (one MMH-filtered OData call, run
  on a domain-joined machine) + `npm run import:itsm` (full replace). Also
  added `GET /api/itsm/reconcile/unlinked-mmh` — the reverse direction the
  per-asset check structurally couldn't cover ("ITSM has it, factorymap
  doesn't") — and `POST /api/itsm/reconcile/unlinked-mmh/create` (+ UI
  buttons) to materialise selected snapshot rows into real, **unplaced**
  local assets (ITSM carries no floor-plan geometry, so placement is manual
  from the Unplaced Assets page).

  **All 45 demo `Asset` rows were deleted** (hierarchy kept), and **the dev DB
  is now populated with all 1057 real MMH hardware assets from ITSM**
  (unplaced), including resolved `type`/`manufacturer`/catalog-item-ID/
  assigned-person fields — none of which are queryable directly on the
  Hardware Asset in this ITSM instance:
  - **Bug found and fixed** in the export script: the person relationship was
    named wrong (`HardwareAssetIsAssignedToPerson` → real name
    `HardwareAssetIsUsedByPerson`), so `AssignedPersonName` was silently null
    in every prior export; also fixed the asset's own display-name field
    (`Name` → `DisplayName`) and added `CatalogItemId`/`PersonId` capture
    (both free — already in the same payload once you know the right name).
  - **`type`**: classified from the *Catalog Item's* own `Type` field (a
    controlled ITSM vocabulary — Desktop/Notebook/Server/IPC/...), not
    parsed from text. That field isn't reachable through the Hardware
    Asset's nav-expansion or the Catalog Items grid's "Export to CSV" by ID
    — joined by catalog item **display name** instead (`import-itsm-
    snapshot.ts`; the internal GUID from the Hardware Asset payload has no
    counterpart in that CSV). "Network Device" is disambiguated by keyword
    against the catalog item name (switch/router/access_point/other).
  - **`manufacturer`**: NOT exposed anywhere queryable in this ITSM instance
    (confirmed — not on the Hardware Asset, not in the Catalog Items
    grid/CSV export, only visible on each Catalog Item's own individual
    record form, which would need an Alemba admin to widen that grid's
    server-side projection to pull in bulk). Derived instead from the first
    word of the catalog item's display name — an approximation, not an
    authoritative field.
  - **Model, OS type/version**: confirmed not populated anywhere in this
    ITSM instance (Model isn't in the Catalog Items CSV either; the Hardware
    Asset's Software Assets list is applications only, no OS entry) — not
    populated, matching upstream reality rather than guessing.
  - A one-time reference join against a hand-exported `hardware-catalog-
    items.csv` (618 org-wide catalog items, via the ITSM web UI's Asset
    Management > Hardware Asset Management > Hardware Catalog Items grid)
    resolves `type`/`manufacturer` for all assets in one pass; the CSV parser
    had to special-case ~20 rows with an unescaped inch-mark quote in the
    display name (`Monitor 24"`) that breaks naive CSV quote-toggling.
  - `ReconcileService.backfillAssetsFromSnapshot()` (`npm run backfill:itsm`)
    fills these newly-resolved fields onto already-created assets without
    recreating them, and never overwrites a field that already has a value.

  See DEVELOPER_GUIDE.md / ARCHITECTURE.md → ITSM Integration for the full
  data flow and field-mapping table.
- **Frontend UX pass (Phase 10, same round)** — done:
  - `AssetDetails.tsx`: filled in previously-unrendered `Asset` fields —
    Custom Fields card (physical condition, environment, notes, tags, remote
    access, backup, Windows update, FortiEDR), IFS/CMDB Master Data card,
    predecessor/successor lifecycle links, created/updated timestamps,
    Section/Workstation names, expanded Wall Port detail, Move History,
    richer Connections table (strength/patch-panel/description), software
    vendor. `work_items` (a whole task-tracking sub-feature with zero UI) was
    explicitly left out of scope — a separate, larger piece of work.
  - `Dashboard.tsx`: table view now has a **column picker** (popover next to
    the card/table toggle) — Type/Status/Manufacturer/IP-Serial/Location/Next
    Maint. are independently toggleable; choice persists via `localStorage`
    (`db_columns`), matching the existing `db_*` view-state pattern.
  - **Bug fixed**: `Asset.toApiResponse()`'s `assigned_person` was gated on
    `person_id` (a separate, unpopulated local field) instead of
    `person_itsm_id` — silently hid the name/ITSM-id even when both were
    present. Also removed a workaround that had faked `person_id` as the raw
    ITSM GUID to route around this (a real bug, not a fix — showed a GUID
    mislabeled as "ID"); cleared the 742 assets it had already written to.
  - **Bug fixed**: `FloorDetails.tsx`'s "No floor plan yet" empty-state banner
    checked only `floor.svg_background` (the older embedded-image field), not
    `floor.svg_ref` (the newer file-reference field) — a floor using `svg_ref`
    showed both the real plan *and* a spurious "upload a plan" prompt on top
    of it. Map View (which only ever checked `svg_ref`) was unaffected.
- **Real building data — started (Phase 10)**: demo `Asset` rows were gone
  already (see §4); **the demo hierarchy itself (1 building, 3 floors, 5 work
  areas, 4 sections, 3 workstations, 2 network rooms, 2 racks, 3 patch panels,
  9 wall ports) was also deleted** in this round, via the existing per-object
  DELETE endpoints bottom-up (respecting the app's own delete guards) — zero
  real assets were placed on it, so nothing was lost. First **real** building
  now exists: **Werk1 / Ground Floor (Földszint)**, from a Visio export out of
  IFS:
  - The raw Visio→SVG export was full of non-structural detail (furniture,
    machines, computers, HVAC, sanitary, dimensions, per-asset `HWA Nr.`
    labels, ...). Visio preserves its original **layer structure** in the SVG
    export (`<v:layer>` defs + each shape's `v:layerMember`), which let this
    be filtered **by layer** instead of by hand in Inkscape — built a
    throwaway Python filter script to prove the approach (5.4MB → 2.5MB,
    confirmed only structural layers remained), but the user's own manual
    Visio layer cleanup (exported straight to
    `backend/src/floorplans/Werk1 floor 0.svg`) converged on almost the exact
    same result independently and was used as the actual source.
  - **Scale calibration**: cropped the SVG to its content bounding box via
    Inkscape CLI (`werk1-floor0-cropped.svg`, `viewBox="0 0 1688.7581
    842.08991"`), then calibrated `scale_meters_per_unit` (`0.0341`) against
    two independent Google Maps satellite measurements of the real building
    (long side ≈55.91m, short side ≈29.61m — closely corroborating the
    user's own initial "~30×55m" estimate) — the two ratios are ~6% off
    (expected for hand-drawn-plan vs. satellite-click measurement), so the
    scale is an average of both axes, not exact.
  - Building/Floor created directly via the API (not the UI) — hit and fixed
    a real bug in the process: passing a Hungarian `ö` through an inline
    shell/curl command corrupted it to `U+FFFD` before it ever reached the
    server; fixed by writing the JSON payload to a file first (bash/MSYS
    shell + non-ASCII characters is a real gotcha for any future scripted
    API calls with non-English names).
  - **Only one floor of one building done.** The rest of the real
    building/floor/work-area/section/workstation hierarchy — and the
    matching Visio→SVG cleanup for each — is the next big chunk of work; see
    §6 below.
- **Jest/dev-DB isolation — done (Phase 11).** The test suite (`itsm.test.ts`'s
  `sync/all` test in particular) ran directly against the dev database —
  confirmed it had polluted it with 22 mock ITSM records at least once this
  round. Fixed properly: `jestEnv.ts` (a Jest `setupFiles` entry, guaranteed
  to run before `config.ts` is ever imported) now redirects
  `MSSQL_DATABASE` to a `_test`-suffixed name; `testApp.ts` creates that
  database on first connect (via a raw `mssql` connection to `master`) if it
  doesn't exist yet, then `synchronize: true` builds the schema fresh. Tests
  now run against `factorymap_test`, never `factorymap` — verified via a
  standalone script mimicking the real setup (confirmed 0 assets in the test
  DB vs. 1057 in dev, both present as separate databases).
- **Person ID (`mmh####`) enrichment — done (Phase 11).** Same limitation and
  same fix pattern as Manufacturer: the ITSM login-style Person ID (e.g.
  `mmhgeza`) isn't exposed on the Hardware Asset's nav expansion (only the
  Person's GUID + display name are) — resolved via a one-time join against a
  hand-exported `persons.csv` (ITSM web UI: Asset Management > Master Data >
  Persons, filtered to `Location contains 'MMH'` > Export to CSV — 1140
  people), keyed by display name (`import-itsm-snapshot.ts`). Resolved for
  **644 of 742** assigned-person assets (87%) — the remainder likely aren't
  in the MMH-filtered Persons export (e.g. a manager based elsewhere) or have
  a display-name mismatch; not chased further, same as Manufacturer's
  "approximation, not authoritative" tradeoff.
- **Live Databricks/IFS pull** — the importer eats *exported files* today; a
  live socket is a one-file change in `import-master-data.ts`, gated on access.
- **No optimistic concurrency control** anywhere (last-write-wins) — a known,
  documented limitation (see ARCHITECTURE.md → Known Limitations), not yet
  addressed; would need a version column + conditional update on every mutating
  endpoint. (Matthias's app explicitly accepts the same trade-off in its PRD.)
- **No in-app network-capacity report**; **orphaned-asset re-link is a manual
  field edit**, not a guided wizard.
- **`/code-review` pass — done (Phase 13).** Full-session review
  (`6f4d54f..HEAD`, excluding the Werk1 floor-plan SVG/VSDX binaries): 8 finder
  angles, 1-vote verify, 10 findings surfaced, all fixed. Highlights: two of
  this session's own new reconcile-accept paths (Assigned Person, Catalog
  Item) silently no-op'd under `ITSM_MODE=snapshot` — the production default —
  because `SnapshotITSMAdapter.toHardware()` never populated the
  `assigned_to_person`/`catalog_item_itsm_id` fields `ReconcileService`'s
  apply() logic reads; `unlinkAsset()` didn't clear person fields, leaving
  stale ITSM person data visible after "unlink"; the bulk MMH-asset-create
  endpoint's audit logging was silently broken (wrong response shape reaching
  `auditLog` middleware); `jestEnv.ts` had its own dotenv-ordering bug that
  could silently defeat the Phase-11 test-DB-isolation fix for a local
  `npm test` run. Also fixed: `network`/`maintenance` presence gates on
  `Asset.toApiResponse()` excluding `switch_port`/`maint_notes` (same class as
  the `assigned_person` bug fixed in Phase 10), stale relation state on
  `AssetDetails.tsx`'s new Replaces/Replaced-By navigation, a PowerShell
  `ConvertTo-Json` single-record quirk in the export script, and an N+1 query
  pattern in the two bulk reconcile-service functions (now batched with
  `In([...])`).
- **SSO login — planned, blocked on Global IT (App Registration request is
  slow at this company).** Two paths discussed:
  1. **Entra ID (Azure AD) OIDC** — the org's mandated approach for
     approved services, via `@azure/msal-node` + `@azure/msal-browser`,
     alongside the existing local/LDAP login tabs (same pattern LDAP already
     established: capabilities flag → dedicated service → controller → route
     → frontend tab). `config.azure.*` already exists as scaffolding
     (tenantId/clientId/clientSecret/redirectUri, read only by the
     `/auth/capabilities` flag today) but needs a real Entra ID App
     Registration from Global IT before any of it can work — requested, slow.
  2. **Interim: Windows Integrated Authentication (Kerberos/SPNEGO)** — no
     App Registration needed, reuses the same AD trust `LdapAuthService`
     already has. Recommended shape: IIS in front of the Node backend with
     Windows Authentication enabled (mature, standard for intranet apps) —
     IIS negotiates the Kerberos ticket and forwards the verified AD username
     to the app in a header, which the app trusts and maps to a local `User`
     via the same auto-provisioning logic `LdapAuthService` already has. Not
     yet implemented — the user asked for the write-up first; next step is
     confirming whether to proceed with this on the Windows Server VM
     (docs/DEPLOYMENT.md).
- **Remaining real buildings/floors** — Werk1 Ground Floor is done (see
  above); every other building/floor still needs the same Visio→SVG
  layer-cleanup + scale-calibration treatment, plus real work
  areas/sections/workstations placed on each. This is the main remaining
  body of work — see §6 for a suggested approach.

- **Production VM deployment — done (Phase 12), not yet run against a real
  VM.** `docker-compose.prod.yml` + `frontend/Dockerfile.prod` (static CRA
  build served by `nginx`, no dev servers/bind-mounts) + `.env.prod.example`,
  for a Windows Server VM reachable by the team over the corp VLAN
  (IP/hostname access, no TLS in this scope). MSSQL is never published to the
  host — only the frontend and backend ports need a VLAN firewall rule.
  `docs/DEPLOYMENT.md` covers the full walkthrough: Podman/WSL2 prerequisites,
  the exact firewall rule, first-deploy steps, first-admin bootstrap (there's
  no public register endpoint — a one-off `ts-node` snippet creates it),
  MSSQL backup/restore, and the ITSM snapshot-import procedure adapted to
  copy the exported files *onto* the VM rather than pulling from Alemba
  directly (same read-only/no-live-calls constraint as dev).
  Verified locally: both prod images build clean, the frontend container
  actually serves (`index.html` + SPA deep-link fallback both 200), and the
  build-arg → baked-in `REACT_APP_API_URL` pipeline was confirmed present in
  the built JS bundle. **Not yet verified**: an actual deploy onto a real VM —
  no VM has been provisioned yet.
- **Next up**: the `/code-review` pass mentioned above (cheap, high value,
  keeps getting bumped), then an actual VM deploy once IT provisions one.

## 7. Doc map

| Doc | What's in it |
|---|---|
| [README.md](../README.md) | Features, quick start, project structure, running tests |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System diagram, full data model, design patterns, RBAC, Known Limitations |
| [DATA_STRUCTURE.md](DATA_STRUCTURE.md) | **factorymap vs. shopfloor_visualizer** entity/table comparison + ingest parity |
| [DATA_MODEL_MIGRATION.md](DATA_MODEL_MIGRATION.md) | Phase-by-phase (1-8) history with per-phase verification logs |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | API reference, DB schema, ITSM + master-data import, conventions |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production VM deployment: compose, nginx, firewall, backup/restore, ITSM import on the VM |
| [USER_GUIDE.md](USER_GUIDE.md) | End-user walkthrough of every page |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | Install, env vars, user management, backup |
