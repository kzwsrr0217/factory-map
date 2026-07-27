# Project Status & Handoff — factorymap

> **Read this first if you're a new session with no prior context.** It's a
> point-in-time snapshot of where the project stands, why, and what's next.
> Last updated: 2026-07-27.

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

## 4. ⚠️ Current DB state gotcha

During phase 8 verification, Matthias's **real MMAG master data was imported
into the running dev database** (943 `master_assets` rows etc.), on top of the
demo seed. This is harmless — it's additive, the demo assets still resolve, and
no app-owned layout was touched — but it means the dev DB is **not** the pristine
demo right now. To restore the minimal demo:

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

- **ITSM (Alemba) asset-data reconciliation review** — explicitly the user's
  next intended topic ("majd átnézzük az itsm-ből kapható asset adatokat"):
  make sure the fields obtainable from ITSM line up and are reconcilable the
  same way the IFS data now does.
- **Live Databricks/IFS pull** — the importer eats *exported files* today; a
  live socket is a one-file change in `import-master-data.ts`, gated on access.
- **No optimistic concurrency control** anywhere (last-write-wins) — a known,
  documented limitation (see ARCHITECTURE.md → Known Limitations), not yet
  addressed; would need a version column + conditional update on every mutating
  endpoint. (Matthias's app explicitly accepts the same trade-off in its PRD.)
- **No in-app network-capacity report**; **orphaned-asset re-link is a manual
  field edit**, not a guided wizard.
- **`/code-review` pass** over the cumulative diff — must be run by the user;
  the assistant can't trigger it.
- Real surveyed floor-plan SVGs + real meter scaling (external input).

## 7. Doc map

| Doc | What's in it |
|---|---|
| [README.md](../README.md) | Features, quick start, project structure, running tests |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System diagram, full data model, design patterns, RBAC, Known Limitations |
| [DATA_STRUCTURE.md](DATA_STRUCTURE.md) | **factorymap vs. shopfloor_visualizer** entity/table comparison + ingest parity |
| [DATA_MODEL_MIGRATION.md](DATA_MODEL_MIGRATION.md) | Phase-by-phase (1-8) history with per-phase verification logs |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | API reference, DB schema, ITSM + master-data import, conventions |
| [USER_GUIDE.md](USER_GUIDE.md) | End-user walkthrough of every page |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | Install, env vars, user management, backup |
