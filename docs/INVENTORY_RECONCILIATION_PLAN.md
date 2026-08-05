# Reconciling the physical inventory — findings and plan

The physical walk-around is finished and its exports have arrived. This is what is in
them, what will go wrong if they are imported as they stand, and the order to do it in.

**No survey data is reproduced here.** The exports carry real HWA numbers, serials and
employee names; they live in `eszkoz/`, which is git-ignored as a directory (an
`eszkozok.json*` rule does **not** cover `eszkoz/eszkozok1.json` — checked). Everything
below is counts and shapes.

---

## 1. What arrived: 12 files, 5 surveys

Every file is the same tool's export in one of two formats. Deduplicated:

| Set | Keep | Rows | Same data also in |
|---|---|---|---|
| A | `eszkozok1.json` (05 Aug 11:54) | 316 | `eszkozok1.csv` |
| B | `eszkozok2.json` (05 Aug 11:56) | 134 | `eszkozok2.csv`; **supersedes** `zg_eszkozok.json` (123, 28 Jul) and its CSV |
| C | `eszkozok.json.bak` (30 Jul 11:58) | 117 | `hajtómű_fröcsi_bm.csv` |
| D | `szenkefe_eszkozok.bak` (04 Aug 13:44) | 45 | `szenkefe_eszkozok.csv` |
| E | `eszkozok_20260729_MMHBABA.csv` | 123 | **nothing — CSV only** |

- The `.bak` files are ordinary tool exports; only the extension differs.
- Set B contains all 123 rows of the older `zg` export plus 11 more, **with the same row
  ids**, so merging by `id` collapses them without a decision.
- **7 of the 12 files are redundant.** Merging A–D by row id gives 612 entries; E adds 123
  that appear nowhere else. **735 device records in total.**

The merged file is `eszkoz/_merged-735-rows.json`, in the tool's own shape.

### Row-level duplication is real but small
- **4 HWA numbers recorded twice each** (8 rows). Both rows of each pair are in the same
  room, so this is the same device entered twice, not two devices. Keep the later
  `modositva`.
- One serial appears twice, but the value is the placeholder `...` — junk, not a duplicate.

---

## 2. The identification problem

This is the finding that matters most. The `hwa` column holds **three different kinds of
value**, and the importer currently understands only the first:

| What is in the column | Rows | Resolves to an asset? |
|---|---|---|
| `HWA` + digits | 307 | 300 yes |
| bare digits, no prefix | 95 | **92 yes — but only if the prefix is added first** |
| a hostname / device name (`MMH…`) | 53 | 10 yes by name; 43 no |

Of 455 rows carrying something there: **300 match as written, 92 after normalising, 10 by
device name, 53 unresolved.** Of the unresolved:

- **8 look like proper HWA numbers but exist neither in the app nor in the ITSM export.**
  One is a single missing letter (`HW…` for `HWA…`) — a suggestion, not a silent fix.
- **45 are device names** the app and the export have never seen.

The importer compares the survey's `hwa` against `hardware_asset_id` after folding case
and accents only. `17838` and `HWA17838` therefore do not match, and **92 devices that are
already in the app would be reported as unknown.**

---

## 3. The place hierarchy barely lines up

| Level | In the survey | In the app |
|---|---|---|
| Building | 5 spellings for 2 buildings: `W2` (361), `Werk 2` (196), `BZYSRM3Werk 2` (5 — a scanner accident), `werk 1` (134), `Werk 1` (39) | **one**: `Werk1` |
| Floor | `0` (398) and `foldszint` (68) for the ground floor; `1` (220), `1. emelet` (46), `1. Emelet` (3) for the first | **one**: ground floor, number 0 |
| Zone (`helyszin`) | 36 distinct | 0 |
| Room (`work_area`) | 118 distinct | 1, and **none of the 118 matches it** |

So ~560 rows name a building the app does not have, ~270 name a floor that does not exist,
and every room has to be created. **181 rows have no room at all** — they can be placed on
a floor and no closer.

---

## 4. Other data quality

- **14 placeholder serials**: `...`, `...2`, `N/A`, `N/A 2` … `N/A8`. The importer matches
  non-HWA rows *by serial*, so `N/A 2` and `N/A 3` become two assets, and two `...` rows
  collapse into one. Neither is right.
- **Device type**: blank on 455 rows (correct — type comes from ITSM for HWA rows),
  `Monitor` on 246, and ~13 rows where a Dell **model** was typed into the type field.
- **Persons**: 73 distinct names, 47 known to the ITSM export, 26 not.
- 9 of 280 serials match a serial already on an asset.

---

## 5. What would happen if this were imported today

Ranked by damage:

1. **Set E creates 123 duplicate assets.** The CSV has no `azonosito_mod` column, so every
   row falls to the "not in ITSM" branch and is created as a new local asset — including
   the 65 that carry an HWA number and already exist.
2. **92 devices are reported as unknown HWAs** because of the missing prefix, and land in
   the task list as work that does not exist.
3. **Placeholder serials create junk assets** and merge unrelated devices.
4. ~560 rows are skipped entirely for want of a building, and their floor names are never
   even looked up.

None of this is silent — the preview reports all of it — but items 1–3 are the app reading
the data wrongly, not the data being wrong, and those are worth fixing in code first.

---

## 6. The plan

### Phase 0 — one file instead of twelve *(done)*
Keep the newest of each set, drop the CSV twins and the superseded `zg` export, merge by
row id. `eszkoz/_merged-735-rows.json`.

**Open question for set E**: it has no row ids and no `azonosito_mod`. Ask whoever exported
it for the tool's JSON. If that is not available, convert it, deriving `azonosito_mod` from
whether the HWA column holds a number, and mint stable row ids so a re-import can dedupe.

### Phase 1 — make the importer read the data as it actually is *(code)*
1. **Normalise the HWA column**: bare digits get the `HWA` prefix. Recovers 92 devices.
2. **Tell a number from a name**: a value like `MMH…` is a device name, so match it against
   the app's and the export's `display_name` instead of `hardware_asset_id`. Recovers 10,
   and turns the other 43 into honest tasks instead of unknown-HWA noise.
3. **Infer the row mode when the column is missing**: HWA column holds a number → an HWA
   row. This is what stops set E from creating 123 duplicates.
4. **Reject placeholder serials** (`...`, `N/A`, `N/A 2`, …): treat them as no serial at
   all, so they neither create junk nor merge devices, and report them.
5. **Report duplicate rows in the preview**: the same HWA or serial twice, before applying.

Each is a small, testable change to `services/inventory/surveyImport.ts` with the numbers
above as the test fixtures.

### Phase 2 — the hierarchy *(human decisions, then bulk)*
1. Decide the canonical building names, then create the missing building and floors.
2. Store the spelling variants as corrections (`W2` → the canonical name, `foldszint` → the
   ground floor, `1. emelet` → the first) on the **Inventory import** page. Five building
   and five floor corrections cover every row.
3. Preview, then apply with **“also create the rooms the survey names”**: 118 rooms and 36
   zones appear as default rectangles below what is already drawn.
4. Drag the rectangles into place on the map, floor by floor. This is the long manual part
   and it cannot be automated — only a person knows where a room is.

### Phase 3 — import
Preview on `/inventory-import`, fix the flagged names inline (26 unknown persons, whatever
rooms remain), re-preview until the list stops shrinking, then apply. Expect roughly 400
updates and 200+ new local-only assets.

### Phase 4 — work the list
Re-derive on `/normalisation`, then:
- the 43 unresolved device names → *identify the device*
- the 8 unknown HWA numbers → *check an HWA* (one is a one-letter typo)
- the new local-only assets → *register in ITSM*, worked from the worksheet CSV
- the labelling round → the printed worksheet, room by room

The round is finished when the task list is empty and was derived after the last import.

---

## 7. Order of work

| # | What | Who |
|---|---|---|
| 1 | Phase 1, items 1–5 (importer) | code |
| 2 | Get set E as JSON, or convert it | ask, then code |
| 3 | Canonical building and floor names | decision |
| 4 | Corrections + create the hierarchy | app |
| 5 | Preview → apply | app |
| 6 | Position the rooms on the map | manual, per floor |
| 7 | Re-derive and work the tasks | app + Alemba |

Steps 1–2 are what stop the import from producing work that does not exist. Nothing should
be applied before them.
