# Data model migration — aligning factorymap with shopfloor_visualizer

## Why

Three internal apps were being built for the same purpose (shopfloor_visualizer,
IPCdata, factorymap). The decision: don't touch shopfloor_visualizer (owned by
Matthias), and instead bring factorymap's data model in line with its approach —
IFS-primary join key, a clean split between externally-owned master data and
app-owned layout/operational data — while keeping SQL persistence (not files)
because factorymap already has the operational maturity (auth, audit, alerting,
tests) that the other two lack.

A real IFS/CMDB export (`data.xlsx`) confirmed the exact join shape: `ifs_id` is
the stable identifier (a plain machine's `ifs_id` equals its `ifs_machine_id`; an
IPC/IT-managed device has its own `444444-*` `ifs_id` and its `ifs_machine_id`
points back to the physical machine it's mounted on — this relation already
exists inside IFS, it doesn't need to be re-derived). `cmdb_id` is a secondary
identifier, and a meaningful fraction of IPCs have no CMDB match at all
(`cmdb_status: MISSING`) — a real data-quality gap, not an edge case to ignore.

## What phase 1 did (this change)

- Added `MasterAsset` (`backend/src/entities/MasterAsset.entity.ts`, table
  `master_assets`) — read-only IFS/CMDB data, mirroring the xlsx columns.
- Added `Asset.master_ifs_id` — a **soft join** to `MasterAsset.ifs_id`
  (no FK/cascade), so a master row disappearing on a future re-import can
  never delete an Asset/layout row; it just stops resolving. Verified by hand:
  patching an asset's `master_ifs_id` to a non-existent value leaves the asset
  fully intact, with `master: null` in the API response.
- Added `Asset.loc_footprint` (optional polygon, mirrors shopfloor_visualizer's
  `objectTypeTemplates`/footprint convention) — stored but not yet read by
  anything.
- Added `Floor.svg_ref` / `Floor.scale_meters_per_unit` — the file-reference
  convention from shopfloor_visualizer (PRD 5.3a: the plan is its own file, not
  a DB blob). `svg_background` (base64 blob) stays for existing floors; nothing
  resolves `svg_ref` to file content yet.
- `backend/src/controllers/asset.controller.ts`: `GET /assets/:id` always
  attaches the joined `master` object (`null` if unmatched); `GET /assets`
  attaches it when `include_master=true` is passed (batched lookup, same
  opt-in pattern as the existing `include_connections=true`).
- First real TypeORM migration for this project:
  `backend/src/migrations/1732000000000-AddMasterAssetAndIfsJoin.ts`. The repo
  had relied on `synchronize: true` in dev only (see
  `backend/src/migrations/README.md`) — this is the first step toward the
  migration discipline production/Databricks Apps hosting will require.

## What was explicitly NOT done in phase 1

**No live IFS/Databricks connection exists anywhere in the app.** Per explicit
instruction, this is deferred until IFS/Databricks access is confirmed for this
project (it may not match what shopfloor_visualizer's author has). Concretely,
none of the following exist yet:
- An import script that queries Databricks/IFS and upserts `master_assets`.
  `MasterAsset` is currently populated only by hand in
  `backend/src/scripts/seed-mssql.ts` (3 rows mirroring the xlsx sample: one
  plain machine, one IPC with a CMDB match, one IPC with `cmdb_status: MISSING`).
- Any change to `backend/src/services/itsm/` (`IITSMAdapter`, `RealITSMAdapter`,
  `MockITSMAdapter`, `ReconcileService`, `SyncService`). These still target
  Alemba/Operaio exactly as before. The old Alemba-era fields on `Asset`
  (`itsm_guid`, `hardware_asset_id`, `itsm_snapshot`, `sync_*`, `reconcile_*`)
  are untouched — they remain the only working ITSM integration until an
  IFS-backed adapter is deliberately built.

**When IFS/Databricks access is confirmed**, the next step is a
`backend/scripts/import-master-data.ts` (mirrors shopfloor_visualizer's
`databricks-ingest/ingest-mmag-machines.py`) that upserts `master_assets` by
`ifs_id`, and — only once that's proven reliable — a new `IfsMasterDataAdapter`
behind the existing `IITSMAdapter` interface, so `ReconcileService` can
eventually diff against IFS/CMDB instead of (or alongside) Alemba.

## What phase 2 did (this change)

Still fully additive, still **no live IFS/Databricks connection anywhere**:

- Added `ProductionLine` (`backend/src/entities/ProductionLine.entity.ts`, table
  `production_lines`: `code` PK, `description`) and `WorkCenter`
  (`backend/src/entities/WorkCenter.entity.ts`, table `work_centers`: `code` PK,
  `description`, `production_line_code` — soft join to `ProductionLine.code`,
  no FK/cascade, same orphan-safe principle as `master_ifs_id`). This is the
  organizational-hierarchy reference data from shopfloor_visualizer's
  Department→ProductionLine→WorkCenter→Resource model — pure lookup data, not
  geometry. Populated only by hand in `seed-mssql.ts` (one Production Line
  `11101`, one Work Center `30230`) — no live IFS/Databricks call, same
  constraint as `MasterAsset`.
- Added `WorkArea.production_line_code` and `Section.workcenter_code` —
  additive soft-join fields. The existing `coord_x/y`/`dim_width/dim_height`
  fields are untouched, so the current frontend rectangle rendering keeps
  working exactly as before.
- Added `EntityKind` (`backend/src/entities/EntityKind.entity.ts`, table
  `entity_kinds`: `value` PK, `label`, `geometry_type`, `default_color`,
  `rotatable`, `exempt_from_orphan`, `footprint`) — a 1:1 mirror of
  shopfloor_visualizer's `entity_kinds.json`, and `Asset.entity_kind` (soft
  join, defaults to `'object'`). This only covers `Asset` in this phase —
  `NetworkRack`/`PatchPanel`/`WallPort` stay separate tables (see below).
  Seeded with `object`/`infoSphere`/`shopfloorCockpit`; `PLC-A2-001` in the
  seed data uses `shopfloorCockpit` to prove the join end-to-end.
- `workarea.controller.ts`/`section.controller.ts`/`asset.controller.ts`:
  minimal create/update mapping for the new fields, same pattern as
  `master_ifs_id` in phase 1.
- Second hand-written migration:
  `backend/src/migrations/1732100000000-AddOrgHierarchyAndEntityKind.ts`,
  verified the same way as phase 1's (temporarily reverted the dev DB schema,
  ran `up()`, confirmed the schema matched, ran `down()`, confirmed clean
  revert, re-ran `up()`, re-seeded).

## What phase 3 did (this change)

Surfaces the phase 1-2 backend data in the existing frontend, **without**
touching its coordinate system, SVG-layer rendering, or `Section` (which was
never rendered on the map to begin with — see below). No live IFS/Databricks
connection, same as every prior phase.

- Backend: three minimal read-only endpoints — `GET /api/entity-kinds`,
  `/api/production-lines`, `/api/work-centers` (new
  `entityKind.controller.ts`/`productionLine.controller.ts`/
  `workCenter.controller.ts` + matching route files, mounted in
  `routes/index.ts`). No create/update/delete — this is reference/config data.
- Frontend types: `Asset` gained `entity_kind`, `master_ifs_id`, `master`
  (`AssetMasterData`), `location.footprint`; `WorkArea` gained
  `production_line_code`; `Section` gained `workcenter_code`; `Floor` gained
  `svg_ref`/`scale_meters_per_unit` (type-only, nothing renders it yet). New
  `entityKind.service.ts`/`productionLine.service.ts`/`workCenter.service.ts`.
- `AssetDetailsModal.tsx`: new "Master Data (IFS/CMDB)" section, shown only
  when `master_ifs_id` is set. Highlights `cmdb_status: MISSING` in red
  (`Badge variant="error"`) instead of showing blank CMDB fields, and shows an
  explicit "Master data unavailable" message when the join target is missing
  (orphan). **Important fix made during this phase**: the asset object handed
  to this modal from list views (`GET /assets`, no `include_master`) has
  `master: undefined` (not fetched), which is different from `master: null`
  (fetched, genuinely orphaned). The modal now refetches via
  `assetService.getAsset(id)` (→ `GET /assets/:id`, which always resolves the
  join per phase 1) whenever it opens for an asset with `master_ifs_id` set
  but `master` not yet fetched, so the two states are never confused.
- `FloorMap.tsx`: `WorkArea` header band is tinted by a deterministic
  hash-color of `production_line_code` (mirrors shopfloor_visualizer's
  `render.js` `productionLineColor()` — same code always gets the same color,
  no lookup needed) and the type label gets a `"PL <code>"` suffix; the
  tooltip shows it too. `WorkAreaDetailsModal.tsx` shows the code in its Info
  tab. `AssetMarker` fetches the `EntityKind` list once (config data, cached
  in `FloorMap`) and uses it two ways, both strictly additive: the kind's
  `default_color` is a fallback *only* when the existing status-based color
  logic (`getAssetColor`) has nothing more specific to say (unrecognized
  status), and a small "⟳" badge appears on markers whose kind is
  `rotatable` (visual indicator only — no rotation UI built yet).
- Verified end-to-end in the running dev stack (Claude Browser): `PLC-A2-001`
  shows full Master Data with `cmdb_status: Deployed`; `HMI-A1-001` shows
  `cmdb_status: MISSING` with CMDB detail fields correctly hidden; "Assembly
  Line A" shows the `"Production · PL 11101"` label and a tinted header band;
  `PLC-A2-001`'s marker shows the rotatable "⟳" badge (its seeded
  `entity_kind` is `shopfloorCockpit`, which is `rotatable: true`).

## What phase 4 did (this change)

A prototype SVG-layer rendering path, additive to (not a replacement of) the
`WorkArea` rectangles — proves the file-storage → parsing → rendering chain
end-to-end without waiting for a real, surveyed floor plan.

- Backend: floor plan files now live in `backend/src/floorplans/` (checked
  into the repo, not uploaded at runtime — mirrors shopfloor_visualizer's
  "the plan is its own file, not a DB blob" convention, PRD 5.3a). New
  `GET /api/floors/:id/svg` (`floor.controller.ts` `getFloorSvg` +
  `floors.routes.ts`) serves the file named by `Floor.svg_ref`, with
  path-traversal protection (the resolved path must stay under
  `FLOORPLANS_DIR`; verified by hand — pointing `svg_ref` at `../../../.env`
  correctly returns 400, not the file). No upload endpoint exists — files are
  placed in the directory out-of-band, same as this prototype's demo file.
- `backend/src/floorplans/werk1-ground-floor.svg`: hand-authored, `viewBox="0
  0 1000 800"` (matches `FloorMap.tsx`'s `WORLD_W`/`WORLD_H` — no scale
  conversion needed for this prototype). Three layers, named via a `<title>`
  child on each top-level `<g>` (shopfloor_visualizer's convention, see
  `mvp-2d-demo/js/svgplan.js`): `outline`, `walls` (pure background), and
  `work-centers` (one polygon, identified by its own `<title>30230</title>`
  child — matching the `WorkCenter.code` already seeded in phase 2).
  `groundFloor.svg_ref`/`scale_meters_per_unit` set in `seed-mssql.ts`.
- Frontend: `floorService.getFloorSvg(id)` (raw-text GET, not JSON) + new
  `utils/svgFloorPlan.ts` `parseFloorPlanSvg()` — a minimal, single-purpose
  port of `svgplan.js`'s `layerName()`/`shapeLabel()` identity-extraction
  (layer name from a `<g>`'s `<title>` child; shape code from its own
  `<title>` child or `id` attribute), scoped to just pulling out the
  `work-centers` layer's shapes; everything else stays in the background
  markup, rendered as-is (no transform flattening, same as `svgplan.js`).
- `FloorMap.tsx`: when the current floor has `svg_ref` set, the parsed
  background renders behind the grid/WorkArea layer, and each work-center
  shape renders as its own `<g>` with `fill`/`stroke` set from the same
  `productionLineColor()` hash used for the `WorkArea` header band (via the
  shape's `code` → `WorkCenter.production_line_code` lookup, phase 3's
  `workCenterService`) — so the rectangle and the real shape agree on color.
  Hover shows a tooltip with the code and Production Line. This is
  **unconditional** when `svg_ref` is set — no layer-visibility toggle was
  added (kept deliberately minimal for a prototype); adding one is a small,
  later addition once this proves useful in practice.
- Verified in the browser (Claude Browser, running dev stack): the
  `work-centers` polygon (`title: "30230"`) renders with `points="60,80
  460,80 460,260 60,260"` and `fill="#7c3aed"` — the same color the Assembly
  Line A `WorkArea` header band computes for Production Line `11101`,
  confirmed by inspecting the live DOM.

## What phase 5 did (this change)

The remaining IFS-independent roadmap items — everything left after
excluding what needs external input (a real surveyed floor plan) or is
gated on IFS access (removing the Alemba fields). Still no live
IFS/Databricks connection anywhere.

- **`production-lines` SVG layer.** `backend/src/floorplans/
  werk1-ground-floor.svg` gained a second layer (`<title>production-
  lines</title>`, one shape `<title>11101</title>`); `utils/svgFloorPlan.ts`'s
  `parseFloorPlanSvg()` now extracts both `work-centers` and
  `production-lines` independently (`extractLayerShapes()` factored out and
  called twice) into `ParsedFloorPlan.{workCenterShapes,
  productionLineShapes}`. `FloorMap.tsx` renders production-line shapes as a
  **dashed, unfilled contour** (organizational boundary) underneath the
  work-center shapes' **filled area** (physical space) — both colored by the
  same `productionLineColor()` hash, so all three (WorkArea header band,
  work-center fill, production-line contour) visually agree.
- **Click-to-select on the SVG shapes.** New `shapePopover` state in
  `FloorMap.tsx` — clicking a work-center or production-line shape opens a
  fixed popover (same pattern as the existing `wallPortPopover`/`popover`
  states) showing its code + resolved description (and, for work centers,
  its linked Production Line code); clicking the same shape again closes it.
  Selected shapes get a thicker stroke. Verified live in the browser via
  simulated DOM clicks (`MouseEvent` dispatch) — the popover text appears
  and is confirmed present via `document.body.innerText`, since it renders
  through a React portal outside `<main>`.
- **`Workstation`: investigated, NOT deprecated — the earlier "deprecation"
  item in this doc was itself based on an incomplete assumption.** A full
  investigation showed `Workstation` is a live, used feature: full CRUD, a
  dedicated tab in `WorkAreaDetailsModal.tsx`, and a real write path from
  CSV import (`AssetImportModal.tsx` resolves a `workstation` column to
  `Asset.workstation_id`). What actually needed fixing:
  - `seed-mssql.ts` never created a single `Workstation` row — the demo's
    "Workstations" tab was always empty. Fixed: 3 rows added under the
    existing `sec_a1`/`sec_a2` sections, with real `coord_x/coord_y`.
  - `Workstation.coord_x/coord_y/rotation` were stored and returned by the
    API but **never rendered anywhere** — `WorkstationFormModal.tsx`'s text
    promised positioning "in the Map View", which didn't exist. Fixed
    properly (not just the text): `MapView.tsx` and `FloorDetails.tsx` now
    fetch `Section`s + `Workstation`s and filter them to the current floor's
    `WorkArea`s (same "fetch all, filter client-side" pattern
    `FloorDetails.tsx` already used internally, i.e.
    `getWorkstationsInWorkarea`); `FloorMap.tsx` renders each as a small
    diamond marker (`workstationColor()`, mirrors `getAssetColor`'s
    active/maintenance/inactive mapping), hoverable and click-to-select
    (same popover pattern as the SVG shapes). Verified live: seeded `TA-01`/
    `TA-02` (active, green) and `TA-03` (maintenance, amber) all render at
    their seeded coordinates and are clickable.
  - **No drag-to-move was added** — this phase is render + select only
    (explicitly scoped down from the original "build the full thing"
    request to keep this phase's blast radius comparable to prior phases;
    drag-to-move would reuse the exact `WallPort` drag pattern already in
    `FloorMap.tsx` if wanted next).
  - `WorkstationFormModal.tsx`'s note text corrected to state the actual
    current behavior (new workstations start at floor origin (0,0); no
    drag-to-reposition yet) instead of the false promise.

## What phase 6 did (this change)

Automated regression coverage for phases 1-5 (previously zero — everything
had only been verified by hand), plus the one concrete feature gap phase 5
explicitly deferred (Workstation drag-to-move). A `/code-review` pass over
the cumulative diff was also recommended, but that has to be run by the user
— it isn't something this assistant can trigger on its own.

- Backend tests (Jest + Supertest, `setupTests()` — see
  `backend/src/__tests__/helpers/testApp.ts`), following the existing
  `workareas.test.ts` convention (own fixtures in `beforeAll`, own cleanup in
  `afterAll`, no global DB reset):
  - `entity-kinds.test.ts`, `production-lines.test.ts`, `work-centers.test.ts`
    — the three read-only listing endpoints from phase 3.
  - `floors.test.ts` gained a `GET /:id/svg` block: success (200,
    `image/svg+xml`, contains the expected layer markers), 404 (no `svg_ref`,
    unknown floor), and the path-traversal case (400).
  - `assets.test.ts` gained a block covering the `master_ifs_id`/`master`
    join (success, `include_master=true` on the list endpoint, and the
    orphan case — a dangling `master_ifs_id` resolves to `master: null`
    without deleting the asset) and `entity_kind` round-tripping.
  - `workareas.test.ts`/`sections.test.ts` gained
    `production_line_code`/`workcenter_code` round-trip + orphan-safety
    cases.
  - **Found and fixed a real, pre-existing gap while writing these**:
    `floor.controller.ts`'s `createFloor`/`updateFloor` never read
    `svg_ref`/`scale_meters_per_unit` from the request body at all — those
    fields existed on the entity (since phase 1) and were only ever set by
    the seed script writing directly to the repository. There was no way to
    set them through the API. Both handlers now accept them, same as every
    other field.
  - Full suite: 22 test files, 255 tests, all passing.
- **Workstation drag-to-move** (`FloorMap.tsx`, `MapView.tsx`,
  `FloorDetails.tsx`) — the exact `WallPort` pattern: `dragging` union
  gained `'workstation'`; `startDraggingWorkstation` mirrors
  `startDraggingWallPort` (offset = pointer's SVG-space position minus the
  workstation's current `coordinates`); a `handleMouseMove` branch calls
  `onWorkstationMove` on every tick with grid snapping; `MapView.tsx` and
  `FloorDetails.tsx` each got a `handleWorkstationMove` + debounce-timer ref,
  identical to `handleWallPortMove`/`handleWorkareaMove` (optimistic local
  update, 500ms-debounced `workstationService.updateWorkstation(id, {
  coordinates })`). Only active when `editable`; the click-to-select popover
  from phase 5 remains the non-edit-mode behavior (same fork as `WallPort`).
  `WorkstationFormModal.tsx`'s note text updated again — now genuinely true.
  Verified end-to-end via the running dev stack: dragged `TA-01` from
  `(90, 110)` to `(200, 150)` and confirmed via the API that the position
  persisted (`updated_at` changed).

## What phase 7 did (this change)

Not a data-model extension like phases 1-6 — a **live-use-case audit**: working
through realistic end-to-end scenarios (new device, move, replace, delete,
network wiring, maintenance, reports, ITSM sync, RBAC, bulk import) against
the running dev stack and fixing every gap actually reproduced. No live
IFS/Databricks connection changed, same constraint as every prior phase.

**Network infrastructure lifecycle** (`network.controller.ts`):
- `deleteRack`/`deleteRoom` gained the same asset-count guard pattern phases
  before this already used for `WorkArea`/`Section`/`Floor`/`Building` — a
  rack (or a room, via its racks) with `Asset.rack_id` still pointing into it
  can no longer be deleted out from under the mounted asset.
- `deleteFloor`/`deleteBuilding` gained a `NetworkRoom` guard (soft join,
  no FK) and `deleteBuilding` gained its own `WallPort` guard — it deletes
  floors directly via the repository as part of its own cascade, bypassing
  `deleteFloor`'s guards entirely, so the check has to be duplicated there.
- New `findWallPortCollision`: two `WallPort`s can no longer share the same
  (`patch_panel_id`, `patch_port`) or (`switch_asset_id`, `switch_port`) —
  the same principle as the pre-existing rack U-position collision check.
- New `POST /network/racks/:id/replace` and `POST /network/patch-panels/:id/replace`
  — physical-swap endpoints mirroring the pre-existing `POST /assets/:id/replace`
  (move mounted assets/patch panels, or wired wall ports, onto a replacement,
  reject on collision, delete the emptied-out old shell). Minimal frontend UI
  added in `NetworkInfrastructure.tsx` (a 🔁 button next to rack/panel
  edit/delete, shown only when a replacement candidate exists).
- `replaceAsset` (`asset.controller.ts`) gained a fix: replacing an asset that
  was itself a switch left every `WallPort.switch_asset_id` pointing at the
  now-retired old asset instead of following it to the replacement — now
  transferred, same as the connection-transfer logic already there.

**Retired-asset pollution** — the common root cause behind several fixes:
once an asset is replaced (`successor_id` set), it's decommissioned but the
row is kept for history. Nothing had ever taught the rest of the app to treat
that as "no longer live", so it kept surfacing everywhere an active asset
would:
- `getMaintenanceCounts`, `Maintenance.tsx`'s calendar, `AssetReports.tsx`'s
  totals/maintenance stats, and `UnplacedAssets.tsx` all now exclude
  `successor_id`-set assets. Live-tested each: an overdue-maintenance asset's
  presence in every one of these dropped to zero the moment it was replaced.
- `AlertService.checkAndSend()` (the daily 07:00 cron) now excludes them too
  — previously a replaced asset's stale `maint_next_date` or open work items
  would trigger real outbound email/Teams notifications indefinitely.
- `ReconcileService.listLinked()`/`driftSummary()` now exclude them — a
  replaced, ITSM-linked asset no longer sits in the reconcile queue forever.
- `SyncService.runSyncAll()` now skips them entirely — previously an ITSM
  sync would silently "resurrect" a replaced asset's fields (status,
  display_name, …) from the ITSM source, even though the physical unit is
  gone and will never be re-placed. Verified live: `last_synced` stayed
  unchanged across a sync run after replacement, confirming the skip.

**`is_placed` correctness**: clearing `hierarchy.rack_id` (unmounting from a
rack) without also setting map coordinates left `is_placed` stuck at `true`
forever — the asset had no rack and no meaningful position, but never
reappeared in Unplaced Assets because nothing recomputed the flag. Fixed in
`applyBodyToAsset`: clearing `rack_id` now recomputes `is_placed` from
whichever placement signal (rack or coordinates) is actually true.

**Validation gaps closed**:
- `maintenance.last_date` in the future is now rejected (422) —
  previously accepted silently, and would have made unserviced equipment
  look "recently serviced" in `AssetReports.tsx` (`now - last_date < 30 days`
  is trivially true for a future date).
- `AssetImportModal.tsx`/`CsvImportModal.tsx` sent empty strings (`''`) for
  unset hierarchy fields (`workarea_id`, `section_id`, `workstation_id`, and
  `building_id`/`floor_id` when no default context was passed) instead of
  `null`. `z.string().uuid()` rejects `''` as an invalid UUID, so **every
  bulk import row failed** whenever those fields weren't all populated —
  confirmed live (400 "Invalid uuid" before the fix, successful create
  after switching to `null`).

**RBAC verified, not just declared**: live-tested a `viewer`-role token
against every mutating endpoint tried (asset PATCH/DELETE, asset POST, user
creation) — all correctly return 403 from the API itself, not merely a
hidden UI button; read endpoints remain open. No gap found.

**Error messages now reach the user**: `frontend/src/utils/apiError.ts`
(`getApiErrorMessage`) extracts the backend's actual `error` string from a
failed request instead of the generic Axios `err.message` ("Request failed
with status code 409"). Wired into every `catch` block that surfaces one of
this phase's new guard/collision messages (`NetworkInfrastructure.tsx`,
`ConnectionManager.tsx`, `RackDiagram.tsx`, `AssetDetails.tsx`,
`BuildingDetails.tsx`, `FloorDetails.tsx`, `WorkAreaDetailsModal.tsx`) —
confirmed live in the browser: deleting a room with mounted assets now shows
"Cannot delete room with 5 rack-mounted asset(s)…" instead of "Delete
failed".

**Investigated, found to already work correctly (no fix needed)**:
Orphaned-asset re-resolution (`orphaned=true` filter is a live `NOT EXISTS`
query — self-heals the moment the master row reappears, nothing to fix);
audit log immutability (no DELETE/PATCH route exists for it, for any role).

**Identified but intentionally not fixed this phase** — flagged as a known
limitation instead (see `ARCHITECTURE.md` → Known Limitations): no
optimistic concurrency control anywhere in the schema (no version column on
any entity; concurrent edits are last-write-wins). Fixing this properly needs
a version column plus a conditional-update check on every mutating endpoint —
a deliberate, larger architectural change, not a live-audit bug fix.

## What's deferred to a later phase (not started)

- **Real floor plan content.** The demo SVG is intentionally a rough
  prototype (one rectangle, two wall lines, two organizational layers) — a
  real, surveyed floor plan (ideally authored in Inkscape, following the
  same layer/title convention) is still needed for this to be useful beyond
  proving the pipeline works. This is external input, not an engineering task.
- **Real meter-based scaling.** `scale_meters_per_unit` is set to `1` (a
  placeholder) — nothing actually converts SVG units to real-world meters
  yet; this prototype's `viewBox` was deliberately chosen to match the
  existing fixed 1000×800 space specifically to sidestep that conversion.
- **Replacing the `WorkArea` rectangles.** They render unchanged, side by
  side with the new SVG layer — no phase so far removes or replaces them.
- **Frontend (Jest/RTL) test coverage for the phase 1-5 UI** — the backend
  now has coverage; the frontend components (`AssetDetailsModal`'s Master
  Data section, `FloorMap`'s SVG layer/workstation rendering) still don't.
  `MapView.test.tsx`/`AssetDetails.test.tsx` were already failing before any
  of this work (confirmed via `git stash`) and remain unfixed — out of scope
  so far.
- **A `/code-review` pass over the cumulative diff** — recommended, but has
  to be run by the user (`/code-review` or `/code-review ultra`); not
  something this assistant can trigger unprompted.
- **Removing the legacy Alemba/ITSM fields from `Asset`** — only once an
  IFS-backed reconcile path is built and confirmed to cover what Alemba
  currently provides.
- **Any live IFS/Databricks connection** — unchanged from phase 1: still
  nothing calls out to IFS or Databricks anywhere in the app.

**Phase 7:**
- All fixes verified against the running dev stack via purpose-written
  Node scripts (`podman exec factory-map-backend node -e/...`) hitting the
  live API as `admin`, plus `tsc --noEmit` on both `backend/` and
  `frontend/` after every change — no automated test suite run this phase
  (deferred per explicit instruction; the user runs it manually).
- Rack/room delete guards: creating an asset mounted in a rack, then
  attempting to delete that rack/room, confirmed 400 with the exact
  mounted-count message; unmounting first confirmed the delete then succeeds.
- Wall port collisions: two wall ports assigned to the same patch-panel port
  or the same switch port both confirmed rejected with 409; a self-update
  (relabeling a port without changing its assignment) confirmed it does not
  false-positive against its own row.
- Rack/patch-panel replace: patch panels and mounted assets confirmed
  transferred with U-positions intact, the emptied old rack/panel confirmed
  gone (404) afterward, and a genuine U-position collision confirmed
  blocking a second replace attempt with 409 rather than silently
  overlapping — also verified end-to-end through the actual browser UI
  (the 🔁 button), not just the API.
- Switch replacement: a `WallPort.switch_asset_id` pointing at a switch that
  was then replaced confirmed re-pointed at the replacement asset.
- Retired-asset exclusion: for each of `getMaintenanceCounts`,
  `Maintenance.tsx`, `AssetReports.tsx`, `UnplacedAssets.tsx`,
  `AlertService.checkAndSend()`, and `ReconcileService`, created an
  overdue/linked asset, confirmed it counted, replaced it, confirmed the
  count/list dropped back down / the entry disappeared.
- ITSM sync zombie-resurrection: replaced a seeded ITSM-linked asset,
  ran `POST /api/itsm/sync-all`, confirmed `last_synced` was unchanged
  (proving the sync skipped it) rather than bumped to "now".
- `is_placed` recompute: mounted an asset in a rack (`is_placed: true`),
  cleared `rack_id` via PATCH, confirmed `is_placed` flipped back to `false`
  (previously stayed stuck at `true`).
- Future maintenance date: `POST /assets` with `maintenance.last_date` in
  2099 confirmed rejected (422); the same request with today's date, and a
  same-day PATCH update (the "mark maintenance done" pattern), both
  confirmed still succeed — no regression on the normal flow.
- Bulk import: reproduced the exact payload shape `CsvImportModal.tsx`/
  `AssetImportModal.tsx` send (empty-string hierarchy fields) against
  `POST /assets/bulk` directly, confirmed 400 "Invalid uuid" before the fix
  and a successful create after switching those fields to `null`.
- RBAC: created a throwaway `viewer` user, confirmed 403 from the API on
  asset PATCH/DELETE/POST and user creation, confirmed 200 on `GET /assets`;
  test user removed afterward.
- Error-message surfacing: triggered a real guard (deleting a room with
  mounted assets) through the actual browser UI and confirmed via a network
  request inspection + immediate DOM read that the toast shows the specific
  backend message, not the generic "Delete failed".

## Considered and rejected: NetworkRack/PatchPanel/WallPort → EntityKind

Earlier phases (1-2) listed this as a deferred goal, on the assumption that
`NetworkRoom`/`NetworkRack`/`PatchPanel`/`WallPort` were map-placeable object
types like `Asset`, and so could eventually fold into the same `EntityKind`
config model. A full investigation (entities, controllers, every frontend
consumer, seed data, e2e coverage) showed this assumption was **wrong**, and
the unification was dropped rather than attempted:

- `NetworkRoom`/`NetworkRack`/`PatchPanel` have **no coordinates at all** —
  they're a real nested organizational hierarchy (room → rack → panel)
  rendered as a tree in a dedicated page (`frontend/src/pages/
  NetworkInfrastructure.tsx`), not placeable objects on a floor map.
- `PatchPanel.port_count`/`patch_port` drive a **live, clickable numeric
  port-grid UI**; `NetworkRack.u_count` + `Asset.u_position`/`rack_u_size`
  drive a **rack-elevation diagram** (`frontend/src/components/network/
  RackDiagram.tsx`) with multi-U slot occupancy and cable routing. Both are
  genuine slot-occupancy computations `EntityKind`'s flat `value/label/
  geometry_type/footprint/rotatable/default_color/exempt_from_orphan` shape
  cannot express.
- `WallPort` *is* map-placeable (`pos_x`/`pos_y`), but carries a 3-level
  denormalized join (`patch_panel_name`/`rack_name`/`room_name`/`room_type`)
  consumed as flat strings by three separate surfaces (`AssetDetails.tsx`,
  `FloorMap.tsx`'s cable-tracing UI, `NetworkInfrastructure.tsx`'s port
  tooltips) — folding it alone into `EntityKind` would have meant rebuilding
  that join logic with no `EntityKind` field to hold it.
- All of the above is exercised by real seed data (2 rooms, 2 racks, 3
  panels, 9 wall ports, cross-linked to rack-mounted and floor-placed assets)
  and by `e2e/network.spec.ts` + `frontend/src/__tests__/
  NetworkInfrastructure.test.tsx`.

**Conclusion**: `EntityKind` stays scoped to what it was actually built for —
`Asset`'s configurable map-rendering type (phases 2-3) — not a general
"every placeable/organizational entity" abstraction. The network
infrastructure model stays as its own, richer set of tables.

## Verification performed

**Phase 1:**
- `master_assets` table and the new `assets`/`floors` columns confirmed present
  via `INFORMATION_SCHEMA` after both `synchronize: true` (dev) and the
  hand-written migration's `up()`.
- `npm run migration:run` and `npm run migration:revert` both verified against
  the live dev DB (reverted the dev schema by hand to the pre-change state
  first, ran `up()`, confirmed the schema matched, ran `down()`, confirmed
  clean revert, then re-ran `up()` and re-seeded).
- `backend/src/scripts/seed-mssql.ts` seeds 3 `MasterAsset` rows and links two
  existing floor assets (`PLC-A2-001`, `HMI-A1-001`) via `master_ifs_id` — one
  resolves to a CMDB-matched IPC, the other to the `MISSING` case.
- `GET /api/assets/:id` and `GET /api/assets?include_master=true` both
  confirmed to return the joined `master` object end-to-end via the running
  dev stack.
- Orphan safety confirmed by hand: patching an asset's `master_ifs_id` to a
  non-existent `ifs_id` leaves the asset fully intact (`master: null`, asset
  still fully resolvable) — no cascade deletion.
- Full backend test suite (`npm test` inside `factory-map-backend`): 19 suites,
  238 tests, all passing after the change.

**Phase 2:**
- `production_lines`, `work_centers`, `entity_kinds` tables and the new
  `work_areas`/`sections`/`assets` columns confirmed present via
  `INFORMATION_SCHEMA` after both `synchronize: true` and the migration's
  `up()`.
- `npm run migration:run`/`migration:revert` verified the same way as phase 1
  (revert dev schema by hand → `up()` → confirm → `down()` → confirm → re-run
  `up()` → re-seed).
- `GET /api/workareas` confirmed to return `production_line_code: "11101"` for
  Assembly Line A; `GET /api/assets?q=PLC-A2` confirmed to return
  `entity_kind: "shopfloorCockpit"`.
- Orphan safety confirmed by hand: patching a `WorkArea.production_line_code`
  to a non-existent code leaves the work area fully intact and resolvable —
  no cascade deletion, matching the `master_ifs_id` pattern from phase 1.
- Full backend test suite: 19 suites, 238 tests, all passing after the change.

**Phase 3:**
- `GET /api/entity-kinds`, `/api/production-lines`, `/api/work-centers`
  confirmed against the running dev stack to return the seeded rows.
- End-to-end in the browser (logged in as `admin`, running dev stack):
  `PLC-A2-001` details show the full Master Data section (`cmdb_status:
  Deployed`, MAC/OS/manufacturer all populated); `HMI-A1-001` shows
  `cmdb_status: MISSING` with the CMDB detail fields correctly hidden;
  Assembly Line A's header on the map shows `"Production · PL 11101"` and a
  tinted band (confirmed via the rendered SVG: `fill-opacity="0.28"` vs the
  default `"0.18"`, hash-color happened to also compute to `#7c3aed` for code
  `11101` — verified by hand-computing the same hash, not a bug); the
  `PLC-A2-001` marker shows the "⟳" rotatable badge.
- Frontend test suite: `MapView.test.tsx` and `AssetDetails.test.tsx` fail
  both **before and after** this phase's changes (verified via
  `git stash`/`git stash pop` on the `frontend/` changes and re-running) —
  pre-existing failures, unrelated to this work. All other frontend suites
  pass (60/66 tests total both before and after).
- Full backend test suite: 19 suites, 238 tests, all passing after the change.

**Phase 4:**
- `GET /api/floors/:id/svg` confirmed to return the seeded SVG with the
  correct `image/svg+xml` content type; path traversal confirmed blocked by
  hand (`svg_ref` pointed at `../../../.env` → 400, not the file's contents).
- Browser: the `work-centers` shape (`title: "30230"`) confirmed rendering
  with `fill="#7c3aed"` — the same color the Assembly Line A header band
  computes — by inspecting the live DOM.
- Full backend test suite: 19 suites, 238 tests, all passing after the change.

**Phase 5:**
- Browser DOM inspection confirmed: the `production-lines` shape (`title:
  "11101"`) renders `fill="none"` with `stroke-dasharray="10,6"`; the
  `work-centers` shape renders filled as before; both present simultaneously.
- Click-to-select verified by dispatching a `MouseEvent` on the parsed
  shape's DOM node and confirming `"Work Center 30230"` appears in
  `document.body.innerText` (the popover renders via a React portal, outside
  `<main>` — plain `get_page_text` on `<main>` would have missed it).
- The 3 seeded workstations (`TA-01`, `TA-02` active/green, `TA-03`
  maintenance/amber) confirmed rendering as diamond markers at their exact
  seeded `coordinates`; clicking `TA-03`'s marker confirmed its popover text
  appears the same way.
- Frontend test suite: same 60/66 pass rate as phase 3 (the 2 pre-existing
  failures, `MapView.test.tsx`/`AssetDetails.test.tsx`, are unaffected).
- Full backend test suite: 19 suites, 238 tests, all passing after the change.

**Phase 6:**
- New/extended backend test files run clean: 22 suites, 255 tests
  (up from 19/238), including the path-traversal 400 case and the
  master-data orphan case as explicit assertions rather than only manual
  checks.
- Workstation drag-to-move verified end-to-end against the running dev
  stack: dragged `TA-01` from `(90, 110)` to `(200, 150)` in the browser
  (Edit Mode on); confirmed via `GET /api/workstations` that the position
  persisted server-side (`updated_at` advanced) — not just a client-side
  visual change.
- Frontend test suite: unchanged, 60/66 (same 2 pre-existing failures).
- Full backend test suite: 22 suites, 255 tests, all passing after the change.
