# Data Structure Reference — factorymap vs. shopfloor_visualizer

This document exists for one purpose: make it easy to compare factorymap's
data model against Matthias's `shopfloor_visualizer` app (its PRD lives at
`shopfloor_visualizer/PRD.md` in his own working directory). It is a
structural reference, not a design document — see `ARCHITECTURE.md` for
patterns/behavior and `docs/DATA_MODEL_MIGRATION.md` for the history of how
this model evolved.

Both apps model the same real-world thing (physical assets, placed on floor
plans, joined to external master data) but made different, explicit
trade-offs. Section 5 spells those out directly.

---

## 1. Storage model

| | factorymap | shopfloor_visualizer |
|---|---|---|
| Persistence | Microsoft SQL Server (relational), TypeORM entities | Lightweight REST + DB for app-owned data; floor plans and area layers live in separate SVG files, not DB blobs |
| Master data | Cached locally (`MasterAsset` table), joined by a stable ID | Imported on demand from external tables, joined by `objectId`; app never owns it |
| Floor plans | `Floor.svg_ref` → file on disk (`backend/src/floorplans/`), `Floor.svg_background` (legacy base64 blob) also exists | `floorPlan.svgRef` → file on disk, same "the plan is its own file" convention (this is where factorymap's `svg_ref` convention was deliberately copied from) |
| Area geometry (production lines / work centers / departments) | Own DB tables in the org hierarchy (`ProductionLine`, `WorkCenter`) **plus** an experimental SVG-layer prototype (`production-lines`/`work-centers` named `<g>` layers, parsed client-side, phase 4-5) | Authored entirely as named SVG layers inside the floor-plan file, read-only, never in a DB table |
| Layout portability | No JSON export/import of layout | Explicit `GET /export/layout` / `POST /import/layout` (FR-24) |

---

## 2. Spatial hierarchy

| factorymap | shopfloor_visualizer | Match? |
|---|---|---|
| `Building` | `Building` (in `sites.json`, under a `Site`) | factorymap has no `Site` level above `Building` — single-site assumption is implicit, not modeled |
| `Floor` | `Floor` (`Level`) | Equivalent. factorymap: `floor_number`, `scale_meters_per_unit`, `svg_ref`. shopfloor_visualizer: `elevationMeters` (from a spatial export's `offset` column), `heightMeters` (slab/extrusion height for 3D) |
| `WorkArea` → `Section` → `Workstation` | *(no equivalent — his org hierarchy is separate from spatial, see §3)* | factorymap nests organizational structure **inside** the spatial tree (a `WorkArea` sits on a `Floor`); shopfloor_visualizer keeps them as two **independent** hierarchies joined only via each Functional Object's single parent ref |

factorymap's `Building`/`Floor` are plain rows with a name/number — no
`placement`/`rotationDeg`/3D geoAnchor concept exists anywhere in this schema
(factorymap has no 3D view at all; see §5).

---

## 3. Organizational hierarchy

| factorymap | shopfloor_visualizer | Notes |
|---|---|---|
| *(none — `Department` has no factorymap equivalent)* | `Department` | Not modeled in factorymap at all |
| `ProductionLine` (`code` PK, `description`) | `Production Line` (code from master data, area geometry as an SVG layer) | factorymap owns it as a real reference table; his is master-data-sourced with SVG-authored area geometry |
| `WorkCenter` (`code` PK, `description`, `production_line_code`) | `Work Center` (area geometry as an SVG layer; codes "reserved for future master-data exports" per his PRD — not present in his current export) | factorymap actually populates and uses this table today; his is scaffolded but not yet fed by real data |
| *(none)* | `Resource` | Not modeled in factorymap |
| `WorkArea.production_line_code`, `Section.workcenter_code` | Functional Object's single `parentRef` (any level, variable-depth) | factorymap ties org codes to spatial containers (a `WorkArea`/`Section` carries a code); his ties org parentage directly to each **object instance**, independent of where it sits spatially |

**Key structural difference**: shopfloor_visualizer's org hierarchy attaches
to the *object* ("this Functional Object's parent is Work Center X"),
independent of physical location. factorymap's org hierarchy attaches to the
*spatial container* ("this WorkArea's production line is X"), and an asset
inherits it by virtue of sitting in that WorkArea/Section. Comparing the two
models directly requires this translation.

---

## 4. Physical assets & their master-data join

| factorymap | shopfloor_visualizer | Notes |
|---|---|---|
| `Asset` (~90 columns across identity/hardware/network/OS/location/ITSM/reconcile/maintenance/lifecycle — see `ARCHITECTURE.md` → Data Model) | `Functional Object` (a `Feature` with `entityKind: "object"`, joined to master data by `objectId`) | factorymap's `Asset` is far wider — it owns hardware specs, ITSM sync state, reconcile diffs, maintenance schedule, and connection graph directly on the row; his `Feature` is deliberately just geometry (`position`, `footprint`, `rotation`), with everything else living in the read-only master-data join |
| `Asset.master_ifs_id` → `MasterAsset.ifs_id` (soft join) | `Feature.objectId` → master-data row's `objectId` (join key) | Same join-key philosophy (stable external ID, app never owns the target). factorymap additionally caches the master row locally (`MasterAsset` table); his app re-imports it into the same store on each manual import — no separate "cache table" concept, since master data already lives in his DB post-import |
| `MasterAsset` — `ifs_site`, `ifs_production_line_id`, `ifs_workcenter_id`, `ifs_machine_id`, `cmdb_id`, `cmdb_status`, … | Master-data JSON shape (§6.1 of his PRD): `objectId`, `objectType` (derived), `name`, `site`, `attributes` (open key/value map), `orgRef.{department,productionLine,workCenter,resource}` | His `attributes` is an open map for anything not yet modeled; factorymap's `MasterAsset` is a fixed, typed column set mirroring the actual IFS/CMDB export columns seen so far |
| `Asset.loc_x`/`loc_y`/`loc_rotation`/`loc_footprint` (JSON polygon), snapped freely | `Feature.geometry` (`point`/`polyline`/`polygon`, `closed`), rotation in **fixed 15° steps**, move snapped to a **1m/0.1m grid** | factorymap has no grid-snap increment or rotation-step constraint — free-form x/y/rotation |
| `Asset.entity_kind` → `EntityKind.value` (soft join: `label`, `geometry_type`, `default_color`, `rotatable`, `exempt_from_orphan`, `footprint`) | Object-type polygon template (§6.5, keyed by the `objectId` prefix before its first `-`) | Same "first-placement pre-fills a default footprint from a type template" idea (factorymap's `fillFootprintFromEntityKind`); factorymap's `EntityKind` also carries a map-marker color/rotatable flag his template does not |
| `Asset.predecessor_id`/`successor_id` + `POST /assets/:id/replace` | *(no equivalent — no asset lifecycle/replace concept in his model)* | factorymap-only: physical swap workflow that transfers position/hierarchy/connections/wall-port assignment to a replacement and marks the old row unplaced-but-retained |
| `is_placed` (boolean, derived from non-zero coordinates or a rack assignment) | Implicit: a master-data row with no `Feature` is in the **"unplaced" list** (§5.3, §10) | Same concept, different mechanism — factorymap stores a computed flag on the asset row; his app derives it structurally from "does a Feature exist referencing this objectId" |
| Orphan handling: `orphaned=true` query filter (`master_ifs_id IS NOT NULL` + no matching `MasterAsset` row), live `NOT EXISTS`, self-heals | Orphan handling: "if an Object-ID present in the layout disappears from a re-import, the geometry is flagged as orphaned (visually marked, listed) and never auto-deleted" (§5.3, §10) | Same philosophy (flag, never auto-delete) and the same self-healing behavior in spirit — both re-resolve automatically once the master data reappears, since neither ever deletes the layout/asset row |

**Not modeled in shopfloor_visualizer at all**: `AssetConnection` (physical/
logical links between assets), `AssetSoftware`, maintenance scheduling
(`maint_last_date`/`maint_next_date`/`maint_interval_days`), work items,
ITSM reconcile/sync state, alerting. His PRD's non-goals explicitly exclude
reporting/dashboards and anything beyond a pure visualization layer over
position data.

---

## 5. Network infrastructure (factorymap-only)

`NetworkRoom` → `NetworkRack` → `PatchPanel` → `WallPort` has **no
counterpart anywhere in shopfloor_visualizer's model**. His PRD's domain
model only goes down to `Functional Object`; there is no concept of a wiring
closet, a rack elevation, a patch-panel port grid, or port-to-port cable
routing. See `ARCHITECTURE.md` → Data Model → "Network Infrastructure" for
the full column/relation reference.

---

## 6. What each app deliberately does NOT model

### shopfloor_visualizer's explicit non-goals (from his own PRD §2.2)

- Authentication, user accounts, roles, or per-user permissions
- Persistent edit history / audit trail / multi-user live collaboration
  (`"Concurrent edits (no auth): last-write-wins is acceptable in v1"`)
- Reporting / dashboards beyond exporting the app-owned data models
- Editing or writing back master data (strictly read-only)
- CAD/BIM import, wayfinding/routing, automatic plan digitization
- Scheduled/automatic master-data sync (manual import only)

### factorymap's corresponding gaps (see `ARCHITECTURE.md` → Known Limitations)

- No optimistic concurrency control either — same last-write-wins behavior,
  just never explicitly decided/documented as a v1 trade-off the way his is
- No 3D view, no camera navigation, no "fly-to" jump animation
- No grid-snap increments or fixed-angle rotation steps
- No self-hosted geographic (OpenStreetMap) backdrop
- No layout export/import as portable JSON

### factorymap capabilities with no shopfloor_visualizer equivalent

- RBAC (`viewer`/`operator`/`admin`), JWT + optional LDAP auth
- Immutable audit log (every create/update/delete, per-field diff)
- Maintenance scheduling + email/Teams alerting (daily cron + one-off
  scheduled reminders)
- Two-way-aware ITSM reconciliation (per-field accept/ignore/unlink against
  a live source, not just one-shot import)
- Asset replace/lifecycle (predecessor/successor chain, connection transfer)
- Network infrastructure modeling (§5) with delete guards and port-collision
  checks
- Real-time multi-client updates (Socket.io push on every mutation)

---

## 7. Quick reference — factorymap table list

| Table | Owns | Join style |
|---|---|---|
| `buildings`, `floors`, `work_areas`, `sections`, `workstations` | Spatial + org hierarchy (nested) | Real FK, cascade delete (guarded — see ARCHITECTURE.md §7) |
| `assets` | Physical asset — identity/hardware/network/location/ITSM/maintenance/lifecycle | FK columns to hierarchy are all soft joins |
| `asset_software`, `asset_connections` | Child rows of `assets` | Real FK, cascade delete |
| `network_rooms`, `network_racks`, `patch_panels`, `wall_ports` | Wiring-closet hierarchy | Room→Rack→Panel real FK/cascade; Room.floor_id, WallPort.floor_id/switch_asset_id, Asset.rack_id are soft joins |
| `master_assets` | Cached external IFS/CMDB rows (read-only) | Referenced only via `assets.master_ifs_id` (soft join) |
| `production_lines`, `work_centers` | Organizational reference data | Referenced via soft-joined codes on `work_areas`/`sections` |
| `entity_kinds` | Map-render config per asset type | Referenced via `assets.entity_kind` (soft join) |
| `alert_config`, `alert_logs`, `scheduled_alerts` | Maintenance alerting | `alert_config` is a singleton row (`id = 'global'`) |
| `users`, `active_sessions` | Auth | — |
| `audit_logs` | Immutable change history | Referenced via `document_id`, no FK (so a deleted entity's history survives) |
