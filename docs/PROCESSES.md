# Factory Map — Processes

The other guides describe **screens**. This one describes **work**: the things that actually happen
to a device in a factory, and what the app does at each step of them.

It exists because those are not the same shape. A user guide organised by screen answers "what does
this page do"; nobody's day starts with a page. It starts with "we swapped a machine this morning"
or "somebody moved desk" — and answering that means touching three screens in an order the guides
never state. Every gap in this document was found by walking a real process end to end and noticing
where it forces you into a terminal, a spreadsheet, or somebody's memory.

**Status:** written 2026-08-19 against the state of the app on that date. The gap register at the
end is the honest list of what does not work end to end yet, and it is the list to clear before
production.

---

## Table of contents

- [The principle everything follows from](#the-principle-everything-follows-from)
- [Who can do what](#who-can-do-what)
- [Processes](#processes)
  - [1. A new device goes into service](#1-a-new-device-goes-into-service)
  - [2. A device is swapped](#2-a-device-is-swapped)
  - [3. A device or a person moves](#3-a-device-or-a-person-moves)
  - [4. The person changes, the machine stays](#4-the-person-changes-the-machine-stays)
  - [5. A monitor or other peripheral](#5-a-monitor-or-other-peripheral)
  - [6. A device leaves service](#6-a-device-leaves-service)
  - [7. A physical survey round](#7-a-physical-survey-round)
  - [8. An ITSM reconcile round](#8-an-itsm-reconcile-round)
  - [9. A Nexthink round](#9-a-nexthink-round)
  - [10. Network socket work](#10-network-socket-work)
  - [11. Administration](#11-administration)
- [Gap register](#gap-register)
- [Before production](#before-production)

---

## The principle everything follows from

There are three sources of truth about the estate and **none of them is authoritative**:

| Source | What it knows | What it cannot know |
|---|---|---|
| **ITSM (Alemba)** | what was recorded: the CI, its serial, who it is assigned to | whether the machine is switched on, or where it physically is beyond the site |
| **The physical survey** | what a person saw standing in the room | anything after the walk-around; it ages from the day it is taken |
| **Nexthink** | what the machine itself reports: OS, when it last ran, who signs in | anything about a device with no agent — every monitor, dock and phone |

The app is a fourth thing: **the record it owns**, which is the placement on the map and everything
a person has decided. It is not a copy of any of the three.

Two rules follow, and every function in the app is built to them:

1. **The app never writes to ITSM.** Not once, anywhere. Where Alemba is wrong, the app produces a
   task for a person. This is policy, not a limitation to be fixed.
2. **Where sources disagree, a person decides.** An automated import may fill a gap; it may never
   overwrite a value somebody verified. Every place that rule bites is recorded rather than
   silently resolved — see [survey rounds](#7-a-physical-survey-round).

---

## Who can do what

Three roles, and the shape is simpler than it looks:

| | `viewer` | `operator` | `admin` |
|---|---|---|---|
| Read everything | ✔ | ✔ | ✔ |
| Create, edit, delete assets and places | | ✔ | ✔ |
| Record a swap, move, or connection | | ✔ | ✔ |
| Import ITSM exports and survey files | | ✔ | ✔ |
| Resolve reconcile differences | | ✔ | ✔ |
| Generate the task list, close tasks | | ✔ | ✔ |
| Manage users and roles | | | ✔ |
| Change alert configuration | | | ✔ |

**Two things about this to confirm rather than assume:**

- **No read is restricted.** Every `GET` route is open to any authenticated user, which includes the
  audit log and every person-to-device assignment. That is a deliberate choice for a small internal
  team, but person assignments and logon records are personal data, so it should be a decision
  somebody has made on purpose rather than a default nobody looked at.
- **`operator` is a wide role.** It can delete an asset, replace one, bulk-edit hundreds and
  overwrite a whole ITSM snapshot. There is no separate "can import" or "can delete" permission. For
  a team of a few people that is proportionate; it stops being so the day the app is opened wider.

---

## Processes

Each process below gives the real-life steps first, then what the app does at each one. Where a step
has no app support the row says so plainly.

### 1. A new device goes into service

**Trigger:** hardware arrives and is being handed to somebody.

| Real step | In the app | Role |
|---|---|---|
| Device is registered in Alemba | — nothing. This happens in Alemba, and it must happen first | — |
| Export from ITSM reaches the app | **ITSM Reconcile** page → import the hardware export | operator |
| The device appears as unlinked | **ITSM Reconcile → Unlinked MMH assets** lists it | any |
| Create it in the map | same page, bulk-create from the export | operator |
| Put it in a room | **Floor Map** — drag it into place, or **Asset** page → set the room | operator |
| Assign the person | comes from the ITSM export automatically; editable on the **Asset** page | operator |
| Label it | physical work. The app can only say it is needed — a `label-device` task | operator closes it |

**The hard dependency:** a device that is not in Alemba **cannot** be created from the export, and
the app refuses to invent one. That refusal is correct — inventing a device Alemba has never heard of
is how a duplicate is born — but it means intake is blocked on Alemba, and the app cannot unblock it.

**Where this shows up as a finding:** Nexthink sometimes sees a machine that is on the network and in
no register at all. Two such devices exist today. They come out as `register-in-itsm` tasks, and the
only way to clear them is to create the CI in Alemba.

### 2. A device is swapped

The most common process, and the one most likely to be recorded days late from memory or a chat
message.

| Real step | In the app | Role |
|---|---|---|
| New machine is issued, old one comes off the desk | — | — |
| Record the swap | **Asset** page → replace, naming the replacement | operator |
| Place, room, person and connections move to the new machine | automatic, inside one transaction | — |
| The replacement is created if the map has never seen it | automatic, **from the ITSM export** | — |
| Decide the old machine's fate | `nexthink:win11` names it per machine: reinstall, fix first, or set aside | operator |
| Old machine physically leaves or is reinstalled | physical work | — |

**What the swap does and does not move.** It hands over the placement, the room and every connection.
It does **not** overwrite the new machine's person if ITSM already gave it one — it only fills the
gap, because the export is what says who has the new machine. A monitor named as coming with the
replacement is placed in the same room and attached to the new machine as a child.

**Where the fate decision comes from.** "Reinstall or set aside" depends on Windows 11 eligibility,
which is not in the device inventory at all — TPM and Secure Boot come from a Nexthink **remote
action**. With that export loaded, `nexthink:win11` answers it per machine. Without it, nothing in
the app can.

**The gap:** the swap itself is a UI action, but everything after it — confirming it from the logon
record, and the reinstall-or-shelf verdict — is a command-line report. See the gap register.

### 3. A device or a person moves

| Real step | In the app | Role |
|---|---|---|
| Machine is carried to another room | **Floor Map** — drag it, or set the room on the **Asset** page | operator |
| Its monitors and dock should follow | **not automatic.** Children stay where they were | operator, by hand |
| The wall socket it used is now free | **Network Infrastructure** — the socket's occupancy follows the asset | — |

**The gap:** moving a machine does not move what hangs off it. A desk move is one physical act and
several separate edits in the app, which is exactly the kind of thing that gets half-done. See the
gap register.

### 4. The person changes, the machine stays

| Real step | In the app | Role |
|---|---|---|
| Somebody else takes over the machine | changed in Alemba, ideally first | — |
| The next ITSM export disagrees with the app | **ITSM Reconcile** → the person field shows a difference | any |
| Decide | accept the ITSM value, ignore the difference, or mark ITSM as the wrong one | operator |
| Where the logon record disagrees with both | `confirm-primary-user` task, from Nexthink | operator |

**Three claims that look like one.** ITSM's *assigned* owner, the survey's *observed* occupant and
Nexthink's *heaviest logon* are different statements and routinely differ without anything being
wrong. The **Asset page → "Where this came from"** panel shows all three side by side with what each
one means. Nothing in the app resolves them automatically, on purpose: 18 devices have their top two
users within a whisker of each other, and naming one would invent a fact.

### 5. A monitor or other peripheral

| Real step | In the app | Role |
|---|---|---|
| Screen is registered in Alemba | in Alemba, first | — |
| Attach it to its machine | **Asset** page → connections, as a `parent-child` | operator |
| It should be in the same room as its machine | set by hand, or automatically when named in a swap | operator |

**The live gap, and it is large.** Every monitor is supposed to be in Alemba. The export holds 161;
the survey found 384 with a serial. So roughly 230 monitors are not in the register, and a monitor
that is not in Alemba **cannot be attached in the app** — it does not exist to attach. Two came up in
a single chat message this week.

The work list for it already exists: **Task Worksheet** filtered to `register-in-itsm`, which prints
serial, type, person and room in walking order. It is data entry into Alemba, not app work.

### 6. A device leaves service

| Real step | In the app | Role |
|---|---|---|
| Machine is taken out of use | — | — |
| It stops reporting to Nexthink | `nexthink:quiet` shows it, with the caveat that August silence is usually leave | any |
| It drops out of the Nexthink export entirely | the import ledger reports it — the strongest signal available | any |
| It is retired in Alemba | in Alemba | — |
| It leaves the next ITSM export | `verify-disposal` task closes itself | — |

**Absence is the signal, not staleness.** Nexthink ages long-inactive devices out of its export
completely, so a decommissioned machine does not appear with an old date — it disappears. That is
only observable against a previous import, which is what `import_runs` exists for.

### 7. A physical survey round

| Real step | In the app | Role |
|---|---|---|
| Walk the floors with the survey tool | outside the app | — |
| Upload the export | **Inventory Import** page | operator |
| Fix the names the app does not recognise | same page — building, floor, zone, room and person corrections | operator |
| Create rooms the survey names that are not drawn | `--create-missing-workareas`, or draw them on the floor | operator |
| Apply | **Normalisation run** page | operator |
| Work the resulting list | **Tasks** page, and **Task Worksheet** to carry | operator |

**Corrections are worth more than they look.** Four corrections — two building abbreviations and two
Hungarian floor names — moved 456 survey rows from unmatched to matched. The report groups the
failures by place with row counts precisely so the big ones get fixed first.

**What the import decides silently, and where it is now recorded.** The rule is *fill a gap, never
overwrite*. Where the survey brought a value and the asset already held a different one, the old one
wins — correct for an automated import, and it used to destroy the disagreement at the moment of
discovering it. Those are now recorded in `survey_observation.suppressed_fields` and become
`resolve-survey-difference` tasks, which close themselves when somebody settles them.

### 8. An ITSM reconcile round

| Real step | In the app | Role |
|---|---|---|
| Export hardware, catalogue items and persons from Alemba | in Alemba | — |
| Import all three | **ITSM Reconcile** page, or `import:itsm` | operator |
| Compare everything | same page — compare all | operator |
| Per field, decide | accept ITSM · ignore the difference · **mark ITSM as wrong** | operator |
| Correct Alemba where it is wrong | in Alemba. The `correct-in-itsm` task closes itself when a later export carries the app's value | operator |

**Load all three exports, not just the hardware one.** With the catalogue and persons CSVs present,
type classification went from 76/1082 to 1033/1082 and person ids from 0/750 to 656/750. The
hardware export alone imports cleanly and quietly leaves most of the estate mistyped.

### 9. A Nexthink round

| Real step | In the app | Role |
|---|---|---|
| Export devices and logons from Investigations | in Nexthink | — |
| Export the Windows 11 readiness remote action | in Nexthink | — |
| Import | **command line only** — `import:nexthink` | operator with a terminal |
| Read the five reports | **command line only** | operator with a terminal |
| Act | the findings that are actions appear on the **Tasks** page | operator |

**This is the least finished process in the app.** The data, the tasks it feeds and the per-asset
evidence panel are all in the product; the import and all five reports are scripts. Someone without
a terminal cannot run a Nexthink round at all. See the gap register.

The five reports:

| Script | Answers |
|---|---|
| `nexthink:swap-check` | does the logon record confirm a claimed swap |
| `nexthink:unknown` | which machines are on the network and not in the map |
| `nexthink:person-mismatch` | where the logon record and the map name different people |
| `nexthink:quiet` | which machines have stopped reporting |
| `nexthink:win11` | reinstall it or set it aside |

### 10. Network socket work

Wall sockets, patch panels, racks and switches have their own agreed workflow, which starts from the
socket rather than the device. See **[CONNECTIONS_WORKFLOW.md](CONNECTIONS_WORKFLOW.md)** — it is
not repeated here.

The one process-level thing worth stating: **Network Infrastructure → switch impact** answers "what
goes dark if this switch comes down", which is the list you need before a maintenance window and
cannot be produced by hand once a floor has a few hundred sockets.

### 11. Administration

| Task | Where | Role |
|---|---|---|
| Create users, set roles, reset passwords | **Settings → Users** | admin |
| LDAP / AD sign-in | configured by environment, see ADMIN_GUIDE | admin |
| Alert configuration | **Alerts**, config is admin-only | admin |
| Read the audit log | **Audit Log** | any authenticated — see the note above |

---

## Gap register

What does not work end to end today. Ordered by how much it costs the person doing the work.

| # | Gap | Cost | Notes |
|---|---|---|---|
| G1 | **The whole Nexthink round is command-line.** Import and all five reports. | High — a process nobody without a terminal can run | The tasks it produces DO appear in the UI. It is the import and the reports that have no page. |
| G2 | **230 monitors are not in Alemba**, so they cannot be attached to their machines. | High, but the work is data entry, not development | Worksheet exists: `register-in-itsm`. Policy is confirmed: every monitor goes into Alemba. |
| G3 | **Moving a machine does not move its monitors and dock.** | Medium — a desk move becomes several edits and gets half-done | Children keep their old room. |
| G4 | **A swap cannot attach a peripheral that is not in the map or the export.** | Medium | Same root as G2. |
| G5 | **176 assets sit on a floor with no room.** | Medium — they are findable but not on a rectangle | Mostly the survey's unmatched-place backlog; correcting the places fixes most of it. |
| G6 | **The survey's "who I saw" cannot be accepted with one click.** | Medium | The disagreement is recorded and becomes a task, but resolving it is a manual edit of the asset. |
| G7 | **No import is scheduled.** Every round starts with somebody exporting by hand. | Medium | The Nexthink API path is written but has no credential; ITSM has no API path at all. |
| G8 | **Reads are unrestricted, including the audit log and person assignments.** | To confirm, not necessarily to change | Deliberate for a small team; it is personal data. |
| G9 | **`operator` is one wide role.** Delete, bulk-edit and whole-snapshot import are the same permission. | To confirm | Proportionate today. |

---

## Before production

The deploy order matters more than the date:

1. **The lockfile fix goes first.** `package.json` and `package-lock.json` had drifted, and `npm ci`
   — which the production Dockerfile uses — refuses to run on a mismatch. This is the oldest item in
   the backlog and it blocks the image build, not the app.
2. **Baseline the migration history.** The first production database is a restore of the dev one, so
   its `typeorm_migrations` table has to be marked up before `migration:run` will behave. Use
   `verify:migrations --baseline`; it writes the rows itself and refuses if the schema does not
   already match.
3. **`NODE_ENV=production`**, which is what turns off `synchronize: true`. Leaving it on in
   production means TypeORM reshapes the schema from the entities at startup.
4. **Rotate the credentials that have been exposed** — see ADMIN_GUIDE. At least one SA password and
   two account passwords have been shared in places they should not have been.
5. **Decide G8 and G9 on purpose.** Neither needs code today, but both should be a decision rather
   than a default.

G1 is the one gap worth closing before people are told to use the app for Nexthink rounds, because
"run this in a terminal" is not a process — it is an instruction to one person who happens to have
one.
