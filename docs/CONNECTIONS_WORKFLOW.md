# Connections — use cases and the surveying process

Status: **design, agreed before implementation.** Connection surveying is
deliberately deferred until after the imminent rack / server / switch
replacement (see [Phase C](#phase-c--switch-ports-after-the-replacement)).

This document works backwards from the questions the app has to answer on a
normal working day, decides which of the two connection layers answers each
one, and only then describes the process for filling them.

---

## 1. The use cases

| # | Real situation | Question the app must answer | Who asks |
|---|---|---|---|
| U1 | "My PC has no network." | Which socket is this device in → which panel port → which switch port → which switch → which IDF? | Service desk, in a call |
| U2 | "We're swapping switch SW-IDF2-01 on Saturday." | Which sockets hang off it, and which devices, people and rooms go dark? | Network / IT infra |
| U3 | "HR is moving to the east wing." | How many sockets does the target room have, how many are patched and live, how many are free? | IT + facility |
| U4 | "New machine arriving in production next week." | Where is the nearest free socket, and is its panel port patched to a switch that has a free port? | IT infra |
| U5 | "This UPS is being replaced." | Which devices are fed from it? | IT infra / facility |
| U6 | "Which server does this application depend on?" | Non-physical relations between assets. | IT ops |
| U7 | Audit / handover | Printable "what is plugged where" per floor and per IDF. | IT management |

U1–U4 are all the same physical chain, from different directions. U5–U7 are not
network sockets at all. That split is what decides the model.

---

## 2. What the model already provides

**Layer A — the socket chain (physical network path).** Already fully modelled,
and it needs *no* connection rows:

```
Asset.wall_port_id
  └── WallPort              label = what is printed on the faceplate, pos_x/pos_y on the floor map
        ├── patch_panel_id + patch_port   → PatchPanel
        │                                     └── rack_id → NetworkRack → network_room_id → NetworkRoom (IDF/MDF)
        └── switch_asset_id + switch_port → the switch Asset
```

Rack-mounted devices skip the wall port: `Asset.rack_id` + `Asset.u_position`
place them directly in a rack.

The Map View side panel already renders this whole chain as a trace
(`frontend/src/pages/MapView.tsx`, "Physical path"), and
`frontend/src/pages/NetworkInfrastructure.tsx` is where rooms, racks, panels and
wall ports are created — a wall port is created *from* the panel port that feeds
it, which is the right direction (see §4).

**Layer B — `AssetConnection` (asset ↔ asset).** A directed row, mirrored into a
second row for `bidirectional` links and tied together by `pair_id`. Carries
`connection_type` (ethernet, fiber, wifi, power, usb, serial, bluetooth,
dependency, peer, parent-child, other), `source_port` / `target_port`, `label`,
`description`, `strength`, and a free `patch_panel` JSON blob. Created in
wire-mode on the map (`AddConnectionModal`).

---

## 3. The rule: which layer for what

> **Ethernet to a wall socket is Layer A. Never Layer B.**

Reasons, in order of importance:

1. **It answers U2 and U4; Layer B cannot.** A PC→switch row says "these two
   things are connected". It does not say *which switch port*, so it cannot
   produce the list of what goes dark when a switch is replaced, nor find a free
   port. The socket chain carries the port at every hop.
2. **Switch replacement invalidates Layer B wholesale.** If the socket chain
   holds the truth, replacing a switch means re-pointing `WallPort.switch_asset_id`
   for the affected ports — the device side is untouched, because a PC's
   relationship is to the *socket*, which did not move. With PC→switch rows, every
   single row has to be rewritten.
3. **A device moves far more often than a socket.** Moving a PC to another desk
   is one field (`wall_port_id`); the panel and switch side stays as it was.
4. **It is a) N rows instead of 2N, and b) not derivable twice.** Two
   representations of one fact drift apart. The socket chain is the one that maps
   onto what a technician can physically see and read off a faceplate.

**Use Layer B only for what the socket chain cannot express:**

| Connection type | Example | Why Layer B |
|---|---|---|
| `power` | UPS → server, PDU → device | Answers U5; no socket chain for power |
| `usb`, `serial` | Machine control PC ↔ CNC / scale / label printer | Direct cable, no panel involved |
| `fiber` | IDF ↔ MDF uplink, or two racks | Both ends are infrastructure, not a faceplate |
| `dependency` | App server → DB server | Answers U6; purely logical |
| `peer`, `parent-child` | Cluster nodes, blade ↔ chassis | Logical grouping |
| `ethernet` **only** when there is genuinely no faceplate — a device patched straight into a switch in the same rack | Server → ToR switch | Record `source_port` / `target_port` |

Everything else that looks like "PC has network" is Layer A.

---

## 4. Volatility — what to survey by hand and what not to

The order of the phases below follows from how often each fact changes. Surveying
a volatile fact by hand, before the thing that changes it happens, is wasted work.

| Fact | Changes | How to capture |
|---|---|---|
| Socket exists, its label, where it is on the floor | Almost never (building works only) | Manual survey — **do first** |
| Socket → panel + panel port | Almost never (it is the fixed cable in the wall) | Manual survey, or existing IDF documentation |
| Panel → rack → IDF | Almost never | Already in the app via Network Infrastructure |
| Which device is in which socket | Weekly (moves, replacements) | Manual at first; keep it current via the normal asset edit |
| **Panel port → switch port** | **Now: everything. Normally: monthly** | **Do last, and prefer reading it from the switch** |
| Switch itself (`switch_asset_id`) | The imminent replacement, then rarely | Re-point the affected wall ports |

The bottom two rows are exactly what the rack/server/switch replacement will
change, which is why connections were deferred — and why the phases are ordered
as they are rather than "survey everything at once".

---

## 5. The process

### Phase A — sockets and the fixed cabling (can start now)

Independent of the switch replacement: nothing here changes when switches are
swapped.

1. **Per IDF, enter the infrastructure** in *Network Infrastructure*: room
   (IDF/MDF) → rack → patch panels with their real port counts. Mostly done
   already for the rooms that exist.
2. **Walk each floor and record the faceplates.** One row per socket:
   the label physically printed on it, the room (work area) it is in, and —
   read off the panel or the existing documentation — which panel and which
   panel port it terminates on.
3. **Enter them** by clicking the panel port in *Network Infrastructure* and
   filling in the wall port. This direction is deliberate: it is impossible to
   create a socket that is patched to a port that does not exist.
4. **Position them on the map**: Map View → edit mode → wall-ports layer → drag
   each socket to where it physically is. Positions are what make U3 and U4
   answerable at a glance.

Leave `switch_asset_id` / `switch_port` **empty** in this phase. An empty switch
side reads honestly as "not yet surveyed"; a guessed one reads as fact.

### Phase B — devices into sockets (with, or right after, the asset survey)

For each device already placed in a work area, set which socket it is plugged
into. Two ways in:

- *Asset edit form* → the wall port field, when working from a list;
- from the map, when working room by room.

A device with no `wall_port_id` is not an error — printers on Wi-Fi, monitors and
docking stations have none. Only the "should be on the wire but isn't recorded"
set matters, and that set is exactly what a report can list (see §6).

### Phase C — switch ports (after the replacement)

Once the new switches are in and their names exist as assets in the app:

1. Set `WallPort.switch_asset_id` + `switch_port` for the ports that are live.
2. **Prefer not doing this by hand.** The switch already knows: its MAC address
   table maps a port to the MAC of whatever is plugged into it, and the app
   already stores `Asset.mac_address`. A one-off export from the switches (or
   from the network monitoring system) joined on MAC address fills the switch
   side of hundreds of ports without a single manual entry, and can be re-run
   after every change. This is the single highest-value automation in the whole
   connection story.
3. Whatever the join cannot match is a short manual list, not a full survey.

### Phase D — the non-network cables (opportunistic, ongoing)

Layer B rows, recorded when someone is at the rack anyway rather than as a
campaign: UPS/PDU feeds (U5), machine ↔ control-PC serial/USB cables, IDF↔MDF
fibre uplinks, and application dependencies (U6). These are dozens of rows, not
thousands, and each one is only worth recording where somebody would actually ask.

---

## 6. What has to be built before Phase B/C can be efficient

Not blocking Phase A — that works with today's UI.

1. **`import-network-survey.ts`** — a wall-port importer built exactly like
   `import-inventory-survey.ts`: **dry run by default**, matches building / floor /
   zone / work area by folded name, reports what did not match, accepts a
   corrections file, and only writes with `--apply`. Columns:
   `epulet, emelet, helyszin, work_area, socket_label, panel_name, panel_port,
   switch_name, switch_port, megjegyzes` — the last two optional and normally
   empty until Phase C.
2. **A MAC-address joiner** for Phase C step 2, taking a switch port/MAC export
   and setting the switch side of the matching wall ports. Same dry-run
   discipline; ambiguous MACs skipped rather than guessed, the way
   `ReconcileService`'s serial matching drops ambiguous serials.
3. **Two reports** (extend `reconcile-report.ts`):
   - *unpatched sockets* — wall ports with no panel port, and panel ports with no
     socket (both directions of the same gap);
   - *wired devices with no socket* — desktops/servers/printers that are placed in
     a work area, are not decommissioned, and have no `wall_port_id`. This is the
     Phase B to-do list, and it shrinks visibly as work proceeds.
4. **Impact view for U2** — given a switch asset, list its wall ports and the
   devices, people and work areas behind them. The data is all present; this is a
   query and a panel, and it is what makes a Saturday maintenance window safe.
5. **Free-port view for U4** — per work area: sockets, patched, occupied, free.

Suggested order: 3 → 1 → 4 → 2 → 5. The reports come first because they make the
survey's progress measurable, and item 1 turns the survey from typing into a file
drop.

---

## 7. Constraints that hold throughout

- **ITSM is read-only.** Nothing in this workflow writes to Alemba/Operaio, and
  nothing queries it in a loop. The socket chain is factorymap's own data — ITSM
  has no concept of it.
- **Never invent a link.** An empty switch side, an unpatched panel port and a
  device with no socket are all legitimate states that a report can find. A
  guessed one is indistinguishable from a surveyed one and quietly poisons U2,
  which is the use case where being wrong costs a production outage.
- **The faceplate label is the key**, not a generated id. It is what the
  technician on the phone can read out during U1.
