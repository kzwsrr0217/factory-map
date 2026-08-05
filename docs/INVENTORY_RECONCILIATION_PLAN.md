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
  non-HWA rows *by serial*, so `N/A 2` and `N/A 3` would have become two assets and two `...`
  rows would have collapsed into one. Read as "no serial" now, and counted.

  A missing serial is not a data-entry error: it means the number was not found or the device
  could not be reached, and it has to be picked up later. Of the 280 rows with no identifier,
  **266 carry a usable serial** (9 of them already on an asset) and **14 have nothing at all**.
  Those 14 come back from the generator as *identify the device* — "read a serial off it" —
  which is the only honest thing to do with them, and the import now says how many are coming
  rather than leaving it to be discovered.

- **The unresolved `MMHIPC…` names cannot be rescued by the data.** Many industrial PCs do
  have HWA numbers today, but the older ones do not always, and **none of the 33 unresolved
  rows carries a serial** — measured. So there is no second key to try: each one is a person
  going to the machine to see whether it has an HWA now. That is a *check-hwa* or *identify
  the device* task, not a matching problem.
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

---

## 8. Runbook — dev first, then the VM

Do the whole thing on the development database first. Not as a rehearsal for its own sake:
step 4 creates 127 rooms and 36 zones, and if the corrections are wrong they arrive with the
wrong names and have to be deleted by hand. On dev that costs a re-seed; on the VM it costs
the real map.

### On dev

**1. Take a backup you have actually restored from.** The import re-places hundreds of assets
in one transaction. `ops/backup-factorymap.ps1` writes one; restoring it once now is what
makes the rest of this reversible.

**2. Merge the exports into one file.** Set E has no JSON, so convert it first:

```bash
cd backend && npm run convert:survey-csv -- ../eszkoz/eszkozok_20260729_MMHBABA.csv
```

Then merge the four newest tool exports plus that conversion. The Inventory import page takes
several files at once and merges them by row id, so this can also be done by selecting them
together in step 5: `eszkozok1.json`, `eszkozok2.json`, `eszkozok.json.bak`,
`szenkefe_eszkozok.bak`, `eszkozok_20260729_MMHBABA.converted.json`. **Do not** add the CSV
twins or `zg_eszkozok.json` — they are the same devices again.

**3. The hierarchy.** On the Buildings page:
- rename `Werk1` → `Werk 1`
- add `Werk 2`
- under each: `Ground floor` (number **0**) and `First floor` (number **1**)

The floor *number* matters more than the name: the survey writes `0` and `1`, and those match
by number without any correction.

**4. The four corrections.** On **Inventory import** → *Stored corrections*, or by previewing
first and using the boxes the preview offers:

| Scope | From | To |
|---|---|---|
| building | `W2` | `Werk 2` |
| building | `BZYSRM3Werk 2` | `Werk 2` |
| floor | `foldszint` | `Ground floor` |
| floor | `1. emelet` | `First floor` |

**5. Preview.** Select the five files, press **What would this change?**. Expected on the
current data:

| | |
|---|---|
| entries read | 735 |
| no building or floor | **0** — if this is not zero, a correction is missing or misspelled |
| identified | 300 by HWA + 92 after the prefix + 30 by the older name |
| unresolved identifiers | 33 (10 numbers, 23 names) |
| rooms the map lacks | 127 |
| new devices with no number | 14 |
| unknown persons | 26 |

Read the numbers before going on. The two that must be right are **0 place failures** and
**735 entries** — anything else means the wrong files or a missing correction.

**6. Fix the person names** the preview lists, using the boxes. 47 of 73 already match; the
rest are nicknames or informal spellings, and each fix is stored for good. This is worth
doing before applying, because a name matched to ITSM also carries the person id.

**7. Apply, with “also create the rooms the survey names” ticked.** One press. Expect ~420
updates and ~280 new local-only assets, plus 127 rooms and 36 zones as default rectangles
stacked below whatever is already drawn on each floor.

**8. Check what the app now says.** On `/normalisation`: the survey step should show the run
and its counts, and the task list should be flagged as older than the data. Press
**Re-derive**. Then on `/tasks`, the shape to expect:
- *register in ITSM* — the new local-only devices
- *identify the device* — the 14 with no number, and the unresolved older names
- *check an HWA* — the 10 unknown numbers, one of them a single missing letter
- *put a label on it* — the labelling round

**9. Only then position the rooms** — and on dev, only enough of them to satisfy yourself the
map behaves. The real positioning is done once, on the VM.

### Then the VM

Once the dev numbers look right:

1. `git pull`, then **run the migrations** — `1733100000000-AddNameCorrections` has not run
   there yet. `ops/deploy-factorymap.ps1` does the pull, rebuild, migration and health check;
   `-DryRun` first.
2. Backup, again, before touching data.
3. Repeat steps 3–8 exactly. The corrections and the hierarchy are per database, so they have
   to be entered again; there are four corrections and six hierarchy rows, which is quicker
   than any export/import of them would be.
4. Position the 127 rooms on the map, floor by floor. This is the long part — do it per floor,
   and use **Arrange N unplaced** on each room afterwards to give its devices coordinates.
5. Re-derive, and work the task list from the printed worksheet.

### If it goes wrong

- **Place failures are not zero** — a correction is missing. The preview names the exact
  spelling that failed; fix it and preview again. Nothing has been written.
- **The preview is right but Apply fails** — it is one transaction, so nothing landed. The
  likeliest cause on a first run is a missing migration.
- **The rooms arrived with wrong names** — they were created from the *corrected* names, so a
  wrong correction means wrong rooms. Delete them and re-run; the corrections are editable
  and the import is idempotent on row ids.
- **A device was placed in the wrong room** — fix it on the asset, not in the survey. The next
  import will overwrite it from the survey again, so the survey needs the fix too if the
  device really moved.
