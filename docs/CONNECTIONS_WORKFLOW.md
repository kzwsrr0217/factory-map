# Connections — use cases and the surveying process

Status: **agreed design.** Connection surveying starts with the sockets; the
switch side waits until after the imminent rack / server / switch replacement.

This document works backwards from the questions the app has to answer on a
normal working day, decides which of the two connection layers answers each one,
and only then describes the process for filling them.

---

## 1. The use cases

| # | Real situation | Question the app must answer | Who asks |
|---|---|---|---|
| U1 | "My PC has no network." | Which socket is this device in → which panel port → which switch port → which switch → which IDF? | Service desk, in a call |
| U2 | "We're swapping switch SW-IDF2-01 on Saturday." | Which sockets hang off it, and which devices, people and rooms go dark? | Network / IT infra |
| U3 | "HR is moving to the east wing." | How many sockets does the target room have, how many are patched and live, how many are free? | IT + facility |
| U4 | "New machine arriving in production next week." | Where is the nearest free socket, and is its panel port patched to a switch? | IT infra |
| U5 | "This UPS is being replaced." | Which devices are fed from it? | IT infra / facility |
| U6 | "Which server does this application depend on?" | Non-physical relations between assets. | IT ops |
| U7 | Audit / handover | Printable "what is plugged where" per floor and per IDF. | IT management |

U1–U4 are all the same physical chain, from different directions. U5–U7 are not
network sockets at all. That split is what decides the model.

---

## 2. Two design principles

**The socket label is the identity.** Sockets are labelled `R1/001`, `R3/125` —
rack, then port. The label is what is physically printed on the faceplate and on
the patch panel, and it is what a technician reads out during a U1 call. It is
therefore the key, not a generated id, and not a map position.

The port numbers run **continuously across a rack's panels**: with 24-port
panels, `R3/001`–`R3/024` land on the rack's first panel, `R3/025`–`R3/048` on the
second, and so on, in `u_position` order. So the label does not merely name the
rack — it determines the exact panel port. Three consequences, all now built:

- Sockets are created in bulk from the label pattern (`R1/001`…`R1/048`) instead
  of typed one at a time, which is what makes "what sockets exist on this floor"
  cheap to fill in.
- **Patching is derived, not looked up.** A rack's whole set of unpatched sockets
  is placed onto its panel ports from the labels alone, and the operator confirms
  a list instead of doing hundreds of lookups (`utils/wallPortLabel.ts`).
- The label is checkable against reality: a socket labelled `R1/…` whose patch
  panel sits in rack R2 is a data-entry error, and a report can find it.

The derivation is deliberately conservative. It refuses to order panels that lack
a `u_position` rather than falling back to some arbitrary order, it never writes
without the list being shown first, and it reports a named reason for every
socket it could not place — so a wrong assumption about the numbering surfaces on
the first rack instead of after three hundred sockets.

**The map shows what people navigate by, not an inventory of wall fixtures.**
Rooms, zones and devices go on the floor plan; sockets do not. A socket's exact
x/y on a top-down plan is never accurate (it is on a wall, not on the floor),
maintaining a few hundred of them by dragging costs real time, and the payoff is
a dot the label already describes better. So **wall ports are not drawn on the
map** — they are a per-floor list, grouped by room.

---

## 3. What the model already provides

**Layer A — the socket chain (physical network path).** Already modelled, and it
needs *no* connection rows:

```
Asset.wall_port_id
  └── WallPort              label ("R1/001"), floor_id, workarea_id (which room)
        ├── patch_panel_id + patch_port   → PatchPanel
        │                                     └── rack_id → NetworkRack → network_room_id → NetworkRoom (IDF/MDF)
        └── switch_asset_id + switch_port → the switch Asset
```

Every one of `patch_panel_id`, `patch_port`, `switch_asset_id` and `switch_port`
is nullable, so "this socket exists but is not patched yet" is a first-class
state — no schema change needed for it. The API already rejects two sockets
claiming the same panel port or the same switch port
(`findWallPortCollision` in `backend/src/controllers/network.controller.ts`).

Rack-mounted devices skip the socket entirely: `Asset.rack_id` + `Asset.u_position`
place them directly in a rack.

**Layer B — `AssetConnection` (asset ↔ asset).** A directed row, mirrored into a
second row for `bidirectional` links and tied together by `pair_id`. Carries
`connection_type` (ethernet, fiber, wifi, power, usb, serial, bluetooth,
dependency, peer, parent-child, other), `source_port` / `target_port`, `label`,
`description`, `strength`. Created in wire-mode on the map (`AddConnectionModal`).

---

## 4. The rule: which layer for what

> **Ethernet to a wall socket is Layer A. Never Layer B.**

Reasons, in order of importance:

1. **It answers U2 and U4; Layer B cannot.** A PC→switch row says "these two
   things are connected". It does not say *which switch port*, so it cannot
   produce the list of what goes dark when a switch is replaced, nor find a free
   port. The socket chain carries the port at every hop.
2. **Switch replacement invalidates Layer B wholesale.** If the socket chain holds
   the truth, replacing a switch means re-pointing `WallPort.switch_asset_id` for
   the affected ports — the device side is untouched, because a PC's relationship
   is to the *socket*, which did not move. With PC→switch rows, every row has to
   be rewritten.
3. **A device moves far more often than a socket.** Moving a PC to another desk is
   one field (`wall_port_id`); the panel and switch side stays as it was.

**Use Layer B only for what the socket chain cannot express:**

| Connection type | Example | Why Layer B |
|---|---|---|
| `power` | UPS → server, PDU → device | Answers U5; no socket chain for power |
| `usb` | **Laptop → docking station** (see below) | The laptop's cable goes to the dock, not to the wall |
| `serial`, `usb` | Machine control PC ↔ CNC / scale / label printer | Direct cable, no panel involved |
| `fiber` | IDF ↔ MDF uplink, or two racks | Both ends are infrastructure, not a faceplate |
| `dependency` | App server → DB server | Answers U6; purely logical |
| `peer`, `parent-child` | Cluster nodes, blade ↔ chassis | Logical grouping |
| `ethernet` **only** where there is genuinely no faceplate — a device patched straight into a switch in the same rack | Server → ToR switch | Record `source_port` / `target_port` |

Everything else that looks like "PC has network" is Layer A.

### Docking stations

A dock is a permanent desk fixture with a fixed cable to the wall socket; the
laptop is the mobile part. So:

- the **dock** carries `wall_port_id` — it is what is actually plugged into `R1/001`;
- the **laptop** gets a `usb` Layer B connection to the dock, and no `wall_port_id`.

Putting the socket on the laptop would be wrong in the way that matters: the
laptop leaves the building every evening while the socket does not, so the
"which device is in R1/001" answer would go stale daily, and a U2 impact list
would name a laptop that is at home.

Desk mini-switches / chained hubs do not occur — they are prohibited here — so
one socket means one directly-attached device (or one dock).

---

## 5. Volatility — what to survey by hand and what not to

The phase order below follows from how often each fact changes. Surveying a
volatile fact by hand, before the thing that changes it happens, is wasted work.

| Fact | Changes | How to capture |
|---|---|---|
| Socket exists, its label, which room it is in | Almost never (building works only) | Bulk-create from the label pattern, assign rooms — **do first** |
| Socket → panel + panel port | Almost never (it is the fixed cable in the wall) | At the rack, together with the switch side |
| Panel → rack → IDF | Almost never | Already in the app via Network Infrastructure |
| Which device is in which socket | Weekly (moves, replacements) | Manual; then kept current through normal asset editing |
| **Panel port → switch port** | **Now: everything. Normally: monthly** | **Last, and preferably read out of the switch** |
| The switch itself (`switch_asset_id`) | The imminent replacement, then rarely | Re-point the affected sockets |

The bottom two rows are exactly what the rack / server / switch replacement will
change, which is why the switch side waits.

---

## 6. The process

### Phase A — what sockets exist (can start now)

Unaffected by the switch replacement.

1. **Per IDF, enter the infrastructure** in *Network Infrastructure*: room
   (IDF/MDF) → rack → patch panels with their real port counts.
2. **Create the sockets from their labels.** A rack's sockets are a contiguous
   range (`R1/001`…`R1/048`), so they are generated, not typed. At this point a
   socket has a label, a floor and nothing else.
3. **Assign each socket to a room** (work area). This is the step that makes "find
   a free socket in this room" possible, and it replaces what dragging dots on the
   map used to do — more cheaply and more precisely.

`patch_panel_id`, `patch_port`, `switch_asset_id` and `switch_port` stay **empty**
in this phase. An empty switch side reads honestly as "not surveyed yet"; a
guessed one is indistinguishable from a verified one.

### Phase B — devices into sockets

For each device placed in a work area, record which socket it is plugged into,
from the asset form's *Physical Wall Port* field. The picker must show each
socket's state, because "free" alone is not enough:

| State | Meaning |
|---|---|
| not patched | no panel port → **it will not work** |
| patched, no switch | physically terminated, but no live port |
| live | panel port and switch port both known |
| occupied | another asset already holds it |

Without this, a device gets assigned to a dead socket and the job looks done.

A device with no socket is not an error — Wi-Fi printers, monitors and laptops
(see docking stations) have none. The set that matters is "should be on the wire
but has no socket recorded", and that is a report, not a UI rule.

### Phase C — patching, at the rack

This is one visit, not two. Standing at the rack you can read which panel port a
socket lands on and plug its patch cord, so both facts are recorded together:

1. In *Network Infrastructure*, use the rack's **🪄 patch-from-labels** action.
   It places every unpatched socket labelled for that rack onto its panel port,
   derived from the number; you check the list and apply. Sockets it cannot place
   are listed with the reason.
2. For anything left over, open the panel port and attach the socket by hand —
   this sets `patch_panel_id` + `patch_port`.
3. Record the switch and switch port the patch cord goes to.

Step 1 assumes each panel's `port_count` and `u_position` are correct, since that
is what the numbering is walked against. Getting a rack's panels right once is
worth it: it turns the rest of that rack into one confirmation.

For the mass fill after the switch replacement, **prefer not doing step 3 by
hand.** The switch already knows: its MAC address table maps a port to the MAC of
whatever is plugged in, and the app already stores `Asset.mac_address`. A one-off
export from the switches, joined on MAC address, fills the switch side of hundreds
of ports and can be re-run after every change. This is the highest-value
automation in the whole connection story. Whatever the join cannot match is a
short manual list, not a full survey.

### Phase D — the non-network cables (opportunistic, ongoing)

Layer B rows, recorded when someone is at the rack or the desk anyway rather than
as a campaign: UPS/PDU feeds (U5), laptop→dock, machine ↔ control-PC serial/USB,
IDF↔MDF fibre uplinks, application dependencies (U6). Dozens of rows, not
thousands, and each one only where somebody would actually ask.

---

## 7. What has to be built

**Done:**

1. ✅ **`WallPort.workarea_id`** — nullable soft join, same pattern as
   `WorkArea.zone_id`. Without it a socket is only located to a floor, and "find a
   free socket in this room" is unanswerable. Replaces `pos_x` / `pos_y`, which are
   no longer maintained. Migration `1732900000000-AddWallPortWorkArea` assigns the
   room where the old position falls inside exactly one work-area rectangle, and
   leaves it null where two overlap rather than guessing.
2. ✅ **Socket list per floor**, grouped by room, with each socket's state —
   `FloorWallPortList`, on the floor page. This *is* the "what sockets exist on
   this floor" answer.
3. ✅ **Create sockets without a panel**, single and by label range
   (`R1/001`–`R1/048`) — `WallPortFormModal` and `POST /network/wall-ports/range`.
   Labels already used in the building are skipped and reported.
4. ✅ **Attach-an-existing-socket** on a panel port, for Phase C step 2 — the
   Network Infrastructure port dialog now offers this building's unpatched sockets
   before offering to create one.
5. ✅ **State-aware socket picker** in the asset form: each socket shows its room,
   how far it is patched, and who holds it; occupied ones are disabled, and picking
   an unpatched one warns that the device will have no network.
6. ✅ **Physical-path panel on the asset page** — `PhysicalPathTrace`, shared by
   the map's side panel and the asset page.
7. ✅ **Sockets removed from the floor map**, along with the layer toggle, drag
   and popover. Connections whose far end is a socket are no longer drawn as lines
   either — without a maintained position they would point at (0,0).
8. ✅ **Patching derived from labels** — `utils/wallPortLabel.ts` plus
   `GET /network/wall-ports/patch-suggestions` and
   `POST /network/wall-ports/apply-patch-suggestions`, surfaced as the rack's
   patch-from-labels action. Read-only until confirmed; every assignment is
   re-checked against the port-collision guard on apply, because the list may
   have been on screen while someone else patched the same port.

9. ✅ **Gap report** — `npm run report:network` (`network-gaps-report.ts`), its
   own script rather than an addition to `reconcile-report.ts`: that one answers
   "does our data match ITSM", this one answers "how far along is the survey", and
   they are run by different people at different times. Five sections, each a
   shrinking to-do list: unpatched sockets, sockets with no switch port, panel
   ports with no socket, labels that disagree with their panel's rack, and wired
   devices on a floor with no socket. Read-only, `--csv` for the full list, and it
   prints what it left out rather than truncating silently.
10. ✅ **Impact view for U2** — `GET /network/switches/:id/impact`, shown on a
    switch's asset page: every socket hanging off it with the device, person and
    room behind each. Loaded on demand, since it only matters for switches.

**Still to do:**

11. **MAC-address joiner** for the Phase C switch side, with the same dry-run
    discipline as the survey importer: ambiguous MACs skipped, not guessed. The
    label derivation covers the panel side; the switch side still needs the
    switches' own MAC address tables. Worth doing right after the switch
    replacement, when every switch port has to be re-recorded anyway.

---

## 8. Constraints that hold throughout

- **ITSM is read-only.** Nothing here writes to Alemba/Operaio, and nothing
  queries it in a loop. The socket chain is factorymap's own data — ITSM has no
  concept of it.
- **Never invent a link.** An empty switch side, an unpatched panel port and a
  device with no socket are all legitimate states a report can find. A guessed one
  is indistinguishable from a surveyed one and quietly poisons U2 — the use case
  where being wrong costs a production outage.
- **Don't clutter the map.** Every new thing drawn on the floor plan competes with
  the rooms and devices people actually navigate by.
