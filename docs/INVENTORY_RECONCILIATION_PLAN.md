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

| What is in the column | Rows | Where it resolves |
|---|---|---|
| `HWA` + digits | 307 | 300 on `hardware_asset_id` |
| the same number, prefix left off | 95 | 92 — **but only once the prefix is supplied** |
| an older device name (`MMHIPC…`, `MMH PRINTER …`, `MMH LABEL …`, `MMHWSBDE…`) | 53 | 30 on **`asset_tag`**, none on the display name |

HWA is the current convention. The names are what older devices carry and they still have
to resolve — they are not errors. **In the app they live in `asset_tag`**, which is where
the ITSM export's own asset tag landed; measured, not assumed. The same name is written
with underscores, with spaces and run together in different rows of the same survey, so the
comparison has to ignore separators entirely.

Row by row, of the 455 that carry an identifier:

| | rows |
|---|---|
| matched as written | 300 |
| matched after supplying the `HWA` prefix | 92 |
| matched by the older name, via `asset_tag` | 30 |
| resolved to nothing | 33 — 10 number-shaped, 23 name-shaped |

The 23 name-shaped misses are almost all `MMHIPC…` industrial PCs, which is plausible:
nobody registered them in ITSM. One of the number-shaped misses is a single missing letter
(`HW…` for `HWA…`).

**Before this was fixed** the importer compared the survey's value against
`hardware_asset_id` after folding case and accents only. `17838` did not match `HWA17838`
and no name matched anything, so **122 devices the app already holds would have been
reported as unknown** — a task list full of work that does not exist.

---

## 3. The place hierarchy barely lines up

| Level | In the survey | In the app |
|---|---|---|
| Building | 5 spellings for 2 buildings: `W2` (361), `Werk 2` (196), `BZYSRM3Werk 2` (5 — a scanner accident), `werk 1` (134), `Werk 1` (39) | **one**: `Werk1` |
| Floor | `0` (398) and `foldszint` (68) for the ground floor; `1` (220), `1. emelet` (46), `1. Emelet` (3) for the first | **one**: ground floor, number 0 |
| Zone (`helyszin`) | 36 distinct | 0 |
| Room (`work_area`) | 118 distinct | 1, and **none of the 118 matches it** |

Which building and floor the survey actually uses, and how many rows each:

| | Ground floor | First floor |
|---|---|---|
| **Werk 1** | 123 | 50 |
| **Werk 2** | 343 | 219 |

**Decided**: the buildings are `Werk 1` and `Werk 2`, the floors `Ground floor` (0) and
`First floor` (1). The existing `Werk1` is renamed to `Werk 1` — folding ignores the space,
so both `werk 1` and `Werk 1` in the survey then match it without a correction.

**Four corrections cover all 735 rows**, and that is not an estimate — it was rehearsed
against a scratch database: place failures went 735 → 478 with the buildings and floors
alone → **0** with these four.

| Scope | The survey says | Read it as |
|---|---|---|
| building | `W2` | `Werk 2` |
| building | `BZYSRM3Werk 2` | `Werk 2` |
| floor | `foldszint` | `Ground floor` |
| floor | `1. emelet` | `First floor` |

`1. Emelet` needs no separate row: folding makes it the same key as `1. emelet`. `0` and `1`
match by floor number without a correction.

Every room still has to be created. **181 rows have no room at all** — they can be placed on
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

## 5. What would have happened if this had been imported as it stood

Ranked by damage. All four are fixed now (§6, phase 1); they are kept here because they are
the reason the fixes exist, and because a future export can bring them back.

1. **Set E would create 123 duplicate assets.** Its CSV has no `azonosito_mod` column, so
   every row fell to the "not in ITSM" branch — including the 65 that carry an HWA number and
   already exist.
2. **92 devices would be reported as unknown HWAs** because the prefix was missing, and 30
   more because their older name was never looked for: 122 tasks describing work that does
   not exist.
3. **Placeholder serials would create junk assets** and merge unrelated devices.
4. ~560 rows are skipped for want of a building, and their floor names were never even
   looked up — and while that was true, the identifier problems above were invisible, because
   the place check ran first and stopped the row.

None of it was silent — the preview reported it — but items 1–3 were the app reading the data
wrongly rather than the data being wrong, which is a different kind of problem.

---

## 6. The plan

### Phase 0 — one file instead of twelve *(done)*
Keep the newest of each set, drop the CSV twins and the superseded `zg` export, merge by
row id: `eszkoz/_merged-735-rows.json`.

Set E had no JSON to be had, so it is converted:

```bash
npm run convert:survey-csv -- eszkoz/eszkozok_20260729_MMHBABA.csv
```

`convert-survey-csv.ts` maps the Hungarian headers, derives `azonosito_mod` from whether the
identifier column holds anything usable, and **mints each row id from the row's own content**
— so converting twice gives the same ids and a re-import updates instead of duplicating.
Verified on the file: 123 entries, 65 read as ITSM rows, identical ids on a second run.

### Phase 1 — make the importer read the data as it actually is *(done)*
In `services/inventory/surveyImport.ts`, each with tests using the numbers above as fixtures:

1. **The `HWA` prefix is supplied** when the survey wrote the number alone. Recovers 92.
2. **A name is looked up as a name**, against `asset_tag` then the display name, ignoring
   separators so `MMH_PRINTER_1039`, `MMH PRINTER 1039` and `MMHPRINTER1039` are one device.
   Recovers 30, and turns the rest into honest "go and identify this" tasks.
3. **The row mode is inferred when the column is missing**: an identifier means an ITSM row.
   An explicit `EGYEB` still wins. This is what stops set E creating 123 duplicates.
4. **Placeholder serials are read as no serial** and counted, so they neither create junk nor
   merge devices.
5. **Duplicate rows are named in the preview** — the same identifier or serial on more than
   one row, before applying rather than explained afterwards. This found a fifth pair the
   file-level analysis had missed: one device recorded once with the prefix and once without.

The preview also now says **how** each row resolved, so if `hwa_prefixed` drops to zero on a
later export, the survey tool has started writing full numbers and the rule can go.

One further fix that fell out of it: **the identifier is resolved before the place**, and
reported either way. Doing it the other way round meant 612 of 735 rows were dropped at the
building check, so a run reported 6 identifier problems out of the 33 that were there — and
only after every building had been fixed would the rest have appeared.

### Phase 2 — the hierarchy *(next, and the long part)*
1. Rename `Werk1` → `Werk 1`; create `Werk 2`; create `Ground floor` (0) and `First floor`
   (1) under both.
2. Enter the four corrections from §3 on the **Inventory import** page. Rehearsed: place
   failures go to zero.
3. Preview, then apply with **“also create the rooms the survey names”** — 118 room names
   across the four floors (127 rooms, since a name reused on another floor is another room)
   and 36 zones appear as default rectangles below whatever is already drawn.
4. Drag the rectangles into place, floor by floor. This cannot be automated: only a person
   knows where a room is. It is the bulk of the remaining effort.

### Phase 3 — import
Preview on `/inventory-import`, fix what is flagged inline (26 unknown persons, whatever
rooms remain), re-preview until the list stops shrinking, then apply. On the current data
expect roughly 420 updates and 280 new local-only assets.

### Phase 4 — work the list
Re-derive on `/normalisation`, then:
- the 23 unresolved device names (mostly `MMHIPC…` industrial PCs) → *identify the device*
- the 10 unknown numbers, one a single missing letter → *check an HWA*
- the new local-only assets → *register in ITSM*, worked from the worksheet CSV
- the labelling round → the printed worksheet, room by room

The round is finished when the task list is empty and was derived after the last import.

---

## 7. Order of work

| # | What | Who | State |
|---|---|---|---|
| 1 | Read the identifier column properly (phase 1) | code | **done** |
| 2 | Convert set E | code | **done** |
| 3 | Canonical building and floor names | decision | **done** |
| 4 | Create the hierarchy + the four corrections | app | next |
| 5 | Preview → apply | app | |
| 6 | Position the rooms on the map | manual, per floor | the long part |
| 7 | Re-derive and work the tasks | app + Alemba | |

Steps 1–3 were what stood between the import and a task list worth trusting. Step 6 is where
the time goes.
