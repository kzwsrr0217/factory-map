# Factory Map — User Guide

## Table of Contents
1. [What is Factory Map?](#what-is-factory-map)
2. [Logging In](#logging-in)
3. [Navigation](#navigation)
4. [Dashboard](#dashboard)
5. [Buildings & Floors](#buildings--floors)
6. [Floor Map](#floor-map)
7. [Zones & Work Areas](#zones--work-areas)
8. [Assets](#assets)
   - [Browsing Assets](#browsing-assets)
   - [Asset Details](#asset-details)
   - [Creating an Asset](#creating-an-asset)
   - [Editing an Asset](#editing-an-asset)
   - [Replacing an Asset](#replacing-an-asset)
   - [Asset Connections](#asset-connections)
   - [Work Items (To-Do Checklist)](#work-items)
   - [Importing Assets from CSV/Excel](#importing-assets)
9. [Unplaced & Orphaned Assets](#unplaced--orphaned-assets)
10. [Global Search](#global-search)
11. [Network Graph](#network-graph)
12. [Network Infrastructure](#network-infrastructure)
13. [Maintenance Calendar](#maintenance-calendar)
14. [Normalisation run](#normalisation-run)
15. [ITSM Reconcile](#itsm-reconcile)
    - [Loading a fresh ITSM export](#loading-a-fresh-itsm-export)
    - [Inventory import (the physical walk-around)](#inventory-import)
16. [Nexthink](#nexthink)
17. [Tasks](#normalisation-tasks)
18. [Alerts (Admins only)](#alerts)
19. [Reports](#reports)
20. [Audit Log](#audit-log)
21. [Settings](#settings)
22. [User Management (Admins only)](#user-management)
23. [Keyboard Shortcuts](#keyboard-shortcuts)
24. [Tips & Best Practices](#tips--best-practices)

---

## Looking for how to do something, not what a page does?

This guide is organised by **screen**. If you arrived with a job rather than a question about a page
— "we swapped a machine this morning", "somebody moved desk", "a new laptop arrived" — read
**[PROCESSES.md](PROCESSES.md)** instead. It walks each real process end to end, says which screen
serves each step and which role can do it, and is honest about the steps the app does not cover yet.

Come back here for the detail of an individual screen.

---

## What is Factory Map?

Factory Map is an IT asset management application designed for factory and industrial environments. It helps IT teams:

- **Know where every device is** — visualize assets on a floor plan map with drag-and-drop positioning
- **Track device details** — hardware specs, IP addresses, OS, remote access tools, backup status
- **Manage IT tasks** — per-asset checklists for upgrades, labeling, replacements
- **Record device connections** — which device connects to which (including patch panel routing); view the full network topology graph
- **Schedule and track maintenance** — monthly calendar view, overdue highlighting, and email/Teams alerts
- **Sync with ITSM** — pull hardware data from your IT service management system
- **Keep an audit trail** — every change is logged with who did it and when
- **Search instantly** — global search (Ctrl+K) across all assets with no page reload

---

## Logging In

1. Open the application in your browser (typically `http://factorymap.company.local` or `http://localhost:5174`)
2. Enter your **username** and **password**
3. Click **Sign In**

If your company uses Active Directory, click **Sign in with Active Directory** and enter your Windows username and password.

### Password requirements
- At least 8 characters
- At least one uppercase letter, one lowercase letter, one number, and one special character

### Forgot your password?
Contact your system administrator — they can reset your password from the User Management page.

### Account locked?
After 5 failed login attempts, your account is locked for 30 minutes. The login page shows a countdown timer (`MM:SS`) next to the error message, and the Sign In button is disabled until the lockout expires. Contact your administrator to unlock it sooner.

---

## Navigation

The left **sidebar** is the main navigation menu, in groups:

| Group | Section | Description |
|-------|---------|-------------|
| — | Dashboard | Overview statistics, asset list, bulk actions |
| Places | Buildings | Browse buildings and floors |
| Places | Map View | Interactive floor plan map |
| Places | Survey progress | How far the recording has got, floor by floor: rooms, devices on the plan, sockets patched through to a switch |
| Devices | Unplaced Assets | Assets not yet positioned on any floor plan |
| Devices | Orphaned Assets | Assets whose IFS/CMDB master row no longer resolves |
| Devices | Maintenance | Monthly calendar of scheduled maintenance |
| Network | Infrastructure | Physical network infrastructure — rooms, racks, patch panels, sockets |
| Network | Connections | Force-directed graph of all asset connections |
| Data & admin | Normalisation run | Where the current round has got to: which step is next, and whether the task list is older than the data it describes |
| Data & admin | ITSM Reconcile | Compare assets against the ITSM system (read-only) and resolve differences per field |
| Data & admin | Nexthink | What the machines report about themselves: load the two exports, then read the coverage, the machines the map lacks, what has gone quiet, and where the logons name a different person. Nothing here writes to Nexthink |
| Data & admin | Inventory import | Hand the physical walk-around to the app: preview what it would change, fix the names that did not match, then apply |
| Data & admin | Tasks | What is left before the inventory, the app and ITSM agree. Derived from the data — press **Re-derive** after a new ITSM export. Dismissing needs a reason, and only "put a label on it" can be closed on your word alone: everything else is checked against the data and comes back if the cause is still there |
| Data & admin | Reports | Asset statistics and ITSM sync |
| Data & admin | Alerts | Maintenance alert configuration *(admin only)* |
| Data & admin | Audit Log | Immutable history of all changes |
| Data & admin | Settings | Personal preferences, map settings, user management |

Collapsing the sidebar (the toggle in the header) hides the labels and group
headings; the icons keep their tooltips and the groups stay visible as spacing.

The **header** at the top shows:
- Current page title
- **Global Search** button (or press **Ctrl+K**)
- **Theme toggle** (light/dark mode)
- Your username and logout button

---

## Dashboard

The Dashboard gives you a quick overview of the entire asset inventory.

### Stat cards
- **Total Assets** — number of all registered assets
- **Placed Assets** — assets that have been positioned on a floor map
- **Buildings** — number of buildings
- **Open Work Items** — total number of incomplete IT tasks across all assets
- **Overdue Maintenance** — assets whose next maintenance date has already passed (shown in red; click to filter the list)
- **Due in 30 Days** — assets with maintenance scheduled within the next 30 days (shown in amber; click to filter)

### Asset list
The full asset table supports sorting, filtering by type/status/floor, and free-text search.

### Bulk actions
Select multiple assets using the checkboxes, then use the bulk action bar to:
- **Move** — reassign to a different floor/work area
- **Delete** — remove all selected assets (requires confirmation)
- **Export** — download the selection as a 19-column CSV file

### Export
Click **CSV** or **JSON** in the header actions to export the currently filtered asset list.

### Keyboard shortcut
Press **Ctrl+N** anywhere in the application to open the New Asset form directly from the Dashboard.

---

## Buildings & Floors

### Browsing buildings
1. Click **Buildings** in the sidebar
2. You see all buildings in the system
3. Click a building card to see its floors

### Creating a building (operator/admin)
1. On the Buildings page, click **New Building**
2. Enter the building name and optional address
3. Click **Save**

### Viewing a building's floors
1. Click a building to open the Building Details page
2. You see all floors listed
3. Click a floor to view its details and assets

### Creating a floor (operator/admin)
1. Open a building's detail page
2. Click **Add Floor**
3. Enter the floor number, name
4. Optionally upload a floor plan image (PNG, JPG, or SVG)
5. Click **Save**

### Uploading a floor plan
1. Open a floor's detail page
2. Click **Upload Floor Plan**
3. Select an image file (PNG, JPG, or SVG, max 20 MB)
4. The image is stored and displayed as the map background

---

## Floor Map

The floor map shows all assets positioned on the floor plan.

### Navigating the map
- **Pan**: click and drag on an empty area of the map (one finger on touch screens)
- **Zoom**: scroll the mouse wheel — the map zooms **toward the cursor**; pinch with two fingers on touch screens; or use the **+** / **−** buttons
- **Fit to content** (🎯 or **F**): frames all placed assets and work areas in one click
- **Reset view** (🔄 or **0**): returns to the default view
- **Keyboard**: arrow keys pan, **+**/**−** zoom, **F** fit, **0** reset (while the mouse is over the map)
- **Minimap**: a small overview map in the bottom-right corner; click it to jump, toggle it with 🗺️
- **Toolbar**: the buttons in the top-right corner are grouped into pills — *View* (zoom/fit/reset), *Canvas* (grid snap, minimap, labels, floor-plan opacity), *Layers*, *Export*
- **Labels at a glance**: asset pins keep the same size at any zoom level; labels hide automatically when zoomed far out to avoid clutter
- **Searching / filtering**: matching assets stay highlighted while everything else is dimmed (not hidden), so you keep the spatial context
- **Share the view**: the address bar always reflects the selected building and floor — copy the URL and a colleague opens the same view

### Placing an asset on the map
1. Open the floor map
2. Find an unplaced asset (shown in the left panel or on the Unplaced Assets page)
3. Drag the asset from the panel onto the map
4. The asset snaps to the grid (20px by default; configurable in Settings)

### Moving an asset on the map
1. Click the asset icon to select it
2. Drag it to its new position
3. The move is saved automatically and recorded in the asset's location history

### Viewing asset details from the map
1. Click on an asset icon
2. A popover appears showing: asset name, status (color-coded), IP address, assigned person, next maintenance date (red if overdue, amber if within 30 days), and connection count
3. Click **View Details** to open the full asset details panel

### Wire mode (connection drawing)
1. Click **Wire Mode** in the map toolbar (or press **W**)
2. Click the first asset — it is highlighted as the source
3. Click the second asset — the **Add Connection** dialog opens
4. Choose connection type, label, and optional patch panel / switch port details
5. Click **Add** to save the connection
6. The two assets are now linked; click **Wire Mode** again (or press **W**) to exit

### Layer toggles
The map toolbar has layer toggles that show or hide categories of items:
- **Work Areas** — coloured zone rectangles
- **Workstations** — numbered slot markers
- **Assets** — device icons with status rings
- **Wall Ports** — amber rectangles marking physical network jacks (visible by default)
- **Connections** — grey lines linking connected assets

Click any toggle to hide or show that layer.

### Wall ports on the map
Amber rectangles on the floor plan represent physical **wall ports** (network face plates). They show the port label (e.g., `A-04`). Click a wall port to see its full path: patch panel → rack → network room.

### Network trace
Click any asset to open its detail popover, then click **View Details**. In the side panel:
- **Physical path** — shows the wall port the device is plugged into, the patch panel and port number, the rack, and the network room (IDF/MDF)
- **Logical connections** — shows all configured asset-to-asset connections

This lets you trace the full cable path from the device to the distribution room without leaving the map.

### Map controls
- **Grid snap**: toggle grid snapping in **Settings → Map Grid Snap**
- **Export map**: click the Export button to download the map as a PNG image
- **Print**: click the Print button to open the print dialog

---

## Zones & Work Areas

The hierarchy is **Building > Floor > Zone > Work Area**.

- A **work area** is one room — "HR Office", "Reception", "Assembly Line 1". It is
  the rectangle you draw on the floor map, and assets are placed inside it.
- A **zone** is the bigger named area those rooms belong to — "HR", "Cummins",
  "Maintenance". A zone has no rectangle of its own: the map outlines it from its
  rooms, so a zone made of two adjacent rooms plus one down the corridor shows as
  one L-shaped blob plus a separate one, which is what the floor actually looks like.
- Every room in a zone shares one colour, so you can see at a glance that four
  offices are all HR. The colour belongs to the zone, so it cannot disagree
  between two rooms of the same zone.

This matches the physical inventory survey exactly: `épület` = building,
`emelet` = floor, `helyszín` = zone, `work area` = work area.

### Viewing work areas
Work areas appear as coloured rectangles on the floor map, with their zone's name
above the group. Click one to see its details.

### Creating a work area (operator/admin)
1. Open a floor map and turn on edit mode
2. Draw a rectangle on the plan (or click **Add Work Area**)
3. Enter the room's name, then pick its **Zone** — or choose **+ New zone…** and
   name it, without leaving the dialog
4. The work area appears on the map and can be repositioned by dragging

### Creating the rooms from the survey
The survey names every room and the zone it belongs to, so those do not have to be
typed in by hand. Running the import with `--create-missing-workareas` creates each
missing room with its zone and a default-size rectangle, stacked in a grid below
whatever is already drawn on that floor. You then drag and resize them into place
on the Map View — that part still needs a person, since only you know where the
room actually is.

Run the import **without** `--apply` first: it writes nothing, and its output is
exactly the list of rooms that are missing, grouped by building and floor.

### Placing many assets at once
After importing the inventory survey, every asset has a building, floor and work
area — but no position, so they all sit in the map's unplaced tray. On the floor
page, each work area with waiting assets shows an **Arrange N unplaced** button: it
lays them out on a grid inside that room's rectangle in one go.

The exact spot inside a room carries no information — what matters is which room
the device is in, which the survey already told us — so this is the normal way to
place surveyed assets, not a shortcut. Anything that does need an exact spot can
still be dragged afterwards, and arranging never moves an asset that is already on
the map.

If a room holds more devices than fit as separate icons, it says so and the icons
overlap; that is honest, they really are all in that room.

### Changing a zone's colour
Open any of its rooms, then pick a swatch under **Zone Colour**. It applies to the
whole zone — every room in it changes, not just the one you opened. On **Auto**
the map picks a free colour for the floor.

> **Sections and Workstations are retired.** Earlier versions had two more levels
> below the work area. They are no longer created; assets sit directly in a work
> area. Existing rows stay visible in a work area's details so they can be
> deleted.

---

## Network Sockets

Sockets are **not drawn on the floor map** — a socket is on a wall, so a dot on a
top-down plan was never in the right place, and keeping hundreds of them positioned
cost more than the dot was worth. Instead each floor page has a **Network Sockets**
list, grouped by room.

Labels are the identity: `R1/001` means rack 1, port 001, which is what is printed
on the faceplate and on the patch panel, and what you read out to the service desk.

### 1. Record the sockets (floor page → Network Sockets → Add Sockets)
A rack's sockets are a contiguous range, so add them as one: prefix `R1/`, from 1
to 48. Labels that already exist in the building are skipped, so re-running a
range after adding a few by hand is safe. Pick the room now if you know it, or
leave it and assign later.

### 2. Plug a device in (asset edit → Physical Wall Port)
The picker shows each socket's room, how far it is patched and who is using it:

| What you see | What it means |
|---|---|
| *not patched* | no panel port yet — **the device will have no network** |
| *patched, no switch* | terminated on a panel, but no switch port recorded |
| *live* | panel port and switch port both known |
| *in use by …* | another device holds it; not selectable |

### 3. Patch it at the rack (Network Infrastructure)
Because the numbering runs continuously across a rack's panels, the app can work
out where every socket lands. Use the rack's **🪄** button: it lists each
unpatched socket with the panel and port derived from its label (`R3/025` → the
rack's second panel, port 1), you check the list and apply. Anything it cannot
place is listed with the reason.

Nothing is written until you press apply, so if a rack's numbering ever works
differently, you will see it in the list rather than discover it later.

For the leftovers, click a panel port directly: choose the socket that lands on
it from the list of unpatched ones, then record the switch and switch port its
patch cord goes to. If the socket was never recorded on the floor page, you can
create it here instead.

> For this to work, each patch panel needs its correct **U position** and **port
> count** — that is what the numbering is walked against.

### 4. Follow the path (asset page → Network Path)
Shows the whole chain: socket → patch panel and port → rack → IDF/MDF → switch port
→ switch. The same panel appears in the map's side panel when you trace an asset.

An empty switch side means "not surveyed yet", not "not connected" — see
[CONNECTIONS_WORKFLOW.md](CONNECTIONS_WORKFLOW.md) for the full process.

### Before a switch maintenance window
Open the switch's asset page → **Maintenance Impact** → *Show what depends on this
switch*. It lists every socket on that switch with the device, person and room
behind it.

If it says no sockets are recorded, that means either nothing is patched to the
switch **or** its switch ports have not been surveyed yet — the two look identical
from here, so check the rack before assuming a window is safe.

### How far along is the survey?
On the server, `npm run report:network` prints what is still missing: unpatched
sockets, sockets with no switch port, panel ports with no socket, labels that
disagree with their panel's rack, and wired devices with no socket. Add
`-- --csv=/path/out.csv` for the full list. It is read-only and touches nothing.

---

## Assets

### Browsing Assets

Assets can be browsed from:
- **Floor map** — visual view of placed assets
- **Building Details page** — list of all assets in a building
- **Floor Details page** — list of all assets on a floor
- **Unplaced Assets page** — assets not yet positioned on any map

Each asset in a list shows:
- Asset name and type (with colored icon)
- Status badge (Active / Maintenance / Inactive / Retired)
- Serial number and manufacturer
- Assigned person

### Filtering and sorting
Use the **filter bar** at the top of an asset list to filter by:
- Asset type
- Status
- Building or floor

Use the **search box** to find assets by name, serial number, IP address, or manufacturer.

---

### Asset Details

Click any asset to open the **Asset Details** panel, or navigate directly to `/assets/<id>` for the full-page view. The full-page view adds three extra actions in the top toolbar:

| Button | What it does |
|--------|-------------|
| **QR Code** | Downloads a PNG QR code for this asset. Scanning the code shows the asset's key details (name, serial number, asset tag, model, status, IP address, owner) and includes a tap-to-open link to this asset page. |
| **Print Label** | Opens a print-ready label in a new window. The label contains the same fields plus an embedded QR code image in the top-right corner. |
| **Sync from ITSM** | Pulls the latest data from the ITSM system (only visible for ITSM-managed assets). |

> **QR codes and mobile devices**: The link inside a QR code points to the Factory Map server. If you're on a local network, the URL will use the server's IP address so you can tap it on your phone and reach the app. If the URL shows "localhost", ask your administrator to set `REACT_APP_PUBLIC_BASE_URL` in the server configuration to your server's real hostname.

#### "Where this came from" — the four sources side by side

Near the bottom of the full-page view, **Compare the sources** shows what each source says about this
one device: the app's own record, ITSM, Nexthink and the physical survey, each with the date it last
said anything. It loads on demand, because most visits to an asset page are not about reconciling it.

Read the cells carefully, because three states look similar and mean very different things:

| What you see | What it means |
|---|---|
| a value | that source states this |
| *(empty)* | that source knows the field and it is blank |
| **—** | that source **cannot** know this field. Nexthink has no opinion about who a device is assigned to; a monitor carries no agent, so its whole Nexthink column is dashes |
| a value with a note under it | shown but **not compared** — it is in a different vocabulary. Nexthink says `desktop` where the app says `workstation`; ITSM's location is the site, never a room |

A row is flagged only where sources that can be compared actually disagree. The **person** row is the
one most worth looking at, and the three cells there are three different claims: ITSM's *assigned*
owner, the survey's *observed* occupant, and Nexthink's *heaviest logon*. They differ routinely
without anything being wrong — somebody moved desk, or a colleague signed in once to fix something.
The panel says which is which and decides nothing.

Below the table it also shows who has been signing in (from Nexthink, with the account type, so a
shared or admin account is visible as such) and any value the survey brought that the import declined
to apply because the record already held another.

The panel shows all information organized in sections:

| Section | What you'll find |
|---------|-----------------|
| **Work Items** | IT task checklist for this device |
| **Basic Information** | Name, type, serial number, asset tag, manufacturer, model, OS |
| **Network** | IP address, DHCP/static, hostname, VLAN, switch port; **Physical Wall Port** — the jack label and full cable path (patch panel → rack → room) |
| **Operational** | Remote access tool + version, backup tool/status, Windows update date, FortiEDR |
| **Custom Fields** | Object ID, serial object (IFS), environment, physical condition, notes, tags |
| **Technical Specs** | CPU, RAM, storage, GPU |
| **Software** | Installed software (from ITSM or manually entered) |
| **Connections** | Links to other assets, with connection type and patch panel info |
| **ITSM** | Hardware asset ID, sync status, ITSM snapshot (pending changes) |
| **Maintenance** | Last maintenance date, next scheduled date, interval |
| **Audit History** | Recent changes to this asset |

---

### Creating an Asset

1. Navigate to a floor or building
2. Click **Add Asset** (requires operator or admin role)
3. Fill in the form:
   - **Display Name** — the primary identifier (required)
   - **Asset Type** — select from dropdown (IPC, Workstation, Server, etc.)
   - **Status** — Active, Maintenance, Inactive, or Retired
   - **ITSM / Hardware Asset ID** — the HWA number (e.g., HWA12345) from the ITSM system
   - Fill in other sections as available
4. Click **Save**

**Tip**: As you type in most fields, autocomplete suggestions appear based on existing values. For example, type "Dell" in the Manufacturer field and it will suggest all Dell entries already in the system.

### Autocomplete fields
The following fields offer suggestions from existing data:
- Manufacturer, Model
- OS Type, OS Version
- VLAN
- Remote Access Tool, Remote Access Version
- Backup Tool
- Environment
- Organization
- Serial Object
- Asset Type

---

### Editing an Asset

1. Open the asset details panel
2. Click **Edit** (pencil icon)
3. Modify any fields in the form
4. Click **Save**

All changes are recorded in the Audit Log.

---

### Replacing an Asset

When a device physically fails or is swapped out, use **Replace** instead of
deleting the old one and creating a new one by hand — it moves everything the
old asset held onto the replacement in one step:

1. Open the broken/old asset's details panel and click **Replace**
2. Pick the replacement asset (an existing, ideally unplaced, asset record)
3. Confirm

The replacement inherits the old asset's map position, hierarchy (building/
floor/work area/section/workstation, or rack + U-position), and physical wall
port assignment, and **every connection** the old asset had (both directions)
is re-pointed at the replacement — including, if the old asset was itself a
switch, every wall port wired into one of its ports. The old asset is cleared
to unplaced (it no longer occupies its old spot or rack slot) but is **not
deleted** — it stays in the system for history, and Reports, the Maintenance
Calendar, ITSM Reconcile, and the maintenance-alert emails all automatically
stop counting it once it's been replaced, so it won't keep showing up as if
it were still in service.

The same **Replace** action is available for rack cabinets and patch panels
on the [Network Infrastructure](#network-infrastructure) page, for the same
"physically swapped the unit" scenario.

---

### Asset Connections

Connections represent physical or logical links between devices:
- **Examples**: IPC connected to a CNC machine, server connected to a switch, PC connected to a monitor

#### Adding a connection
1. Open the asset details panel
2. Scroll to the **Connections** section
3. Click **Add Connection**
4. Search for the target asset by name
5. Choose the connection type (Ethernet, WiFi, USB, Fiber, etc.)
6. Optionally enter:
   - **Label** — a short description
   - **Patch Panel Name** and **Patch Panel Port** — where the cable enters the patch panel
   - **Switch Name** and **Switch Port** — where it connects on the switch
7. Click **Add**

#### Viewing connections
Each connection in the list shows:
- The connected asset name and type
- Connection type
- Patch panel info (e.g., `PP: PP-A12/14 → SW: SWITCH-01/Gi0/1`)

#### Removing a connection
Click the **×** button next to a connection. This also removes the reverse connection on the other asset.

---

### Work Items

Work items are a per-asset to-do checklist for IT tasks. Examples:
- "Label the device with asset tag"
- "Upgrade BeyondTrust agent from 23.1 to 24.2"
- "Replace failing Veeam backup job"
- "Schedule OS upgrade from Windows 7"

#### Viewing work items
Work items appear at the top of the asset details panel. Open items are highlighted with a badge showing the count. Any item whose **due date** has passed is shown with an **OVERDUE** badge in red.

#### Adding a work item
1. Open the asset details panel
2. In the **Work Items** section, type the task description
3. Choose a priority: **Low**, **Medium**, or **High**
4. Optionally set a **due date** and **assigned person**
5. Press **Enter** or click **Add**

Each item automatically gets a unique ID so it can be referenced by alerts.

#### Item status
Each work item has a status that you can update:
- **Open** — task has not started
- **In Progress** — work is underway
- **Done** — task is complete (same as checking the checkbox)

#### Completing a work item
Check the checkbox next to the item (sets status to **Done**). It immediately saves and the item is shown as strikethrough.

#### Deleting a work item
Click the **🗑** (trash) icon next to the item.

#### Sending an alert for one item
Click the **bell** icon next to a work item to send an immediate email/Teams notification about that specific task. The notification includes the asset name, item description, priority, and due date. The item is marked as **alert sent** after delivery.

---

### Importing Assets

#### CSV Import
1. Go to any asset list
2. Click **Import** → **CSV Import**
3. Download the template file to see the expected format
4. Fill in the template with your asset data
5. Upload the CSV file
6. Review the import results

#### Bulk import via script (IT admin)
For large imports (e.g., from an Excel spreadsheet), use the Python import scripts in the `uploads/` directory. Contact your system administrator.

---

## Unplaced & Orphaned Assets

Two dedicated pages catch assets that need attention but don't show up in the
normal building/floor browsing views.

### Unplaced Assets
The **Unplaced Assets** page lists every asset without map coordinates —
newly created devices still sitting in a box, or an asset that was moved off
a floor plan. Assets are grouped by building/floor so you can jump straight
to the right floor map and place them. A replaced (retired) asset is **not**
shown here even though it's technically unplaced — it's been superseded on
purpose and will never need placing again.

### Orphaned Assets
The **Orphaned Assets** page lists assets whose external master-data link
(IFS/CMDB) no longer resolves — the source record was deleted or renamed on
a re-import. Factory Map never deletes the asset itself just because the
external link broke; the device may still be sitting right there in the
rack. The page flags it so someone can investigate and either fix the source
record or re-link the asset to the correct one. The moment the source data
resolves again (or the record reappears under the same ID), the asset
disappears from this list automatically — no manual "un-orphan" step needed.

---

## Global Search

Press **Ctrl+K** (or click the search icon in the header) to open the **Global Search** overlay.

- Start typing to search across **all assets** instantly
- Search matches: asset name, serial number, asset tag, IP address, hostname, manufacturer, model, responsible person
- Click a result to open that asset's details
- Press **Escape** to close

The search works entirely offline — no server round-trip is needed after the initial page load.

---

## Network Graph

The **Network** page (`/network`) displays all asset connections as an interactive force-directed graph.

- Each **node** is an asset; the node color matches the asset type
- Each **edge** is a connection; hover to see the connection type and label
- **Drag** nodes to rearrange the layout
- **Scroll** to zoom; drag the background to pan
- Click a node to highlight its direct connections
- Use the filter controls to show only specific asset types or connection types

The graph gives a topology view of your entire network — useful for impact analysis before maintenance or when troubleshooting connectivity.

---

## Network Infrastructure

The **Infra** page (`/infrastructure`) is the physical network documentation tool. It lets you map out your cabling infrastructure from the distribution room all the way to the wall jack.

### Structure overview

```
Network Room (IDF / MDF)
  └── Rack (equipment cabinet in that room)
        └── Patch Panel (cabling termination block)

Wall Port (face plate jack on a floor)
  └── connected to a Patch Panel port
        └── which sits in a Rack
              └── which sits in a Room
```

An **Asset's physical port** (`wall_port_id`) links the device to this hierarchy, giving you the complete cable path.

### Network rooms

**IDF** (Intermediate Distribution Frame) — a floor-level distribution room.  
**MDF** (Main Distribution Frame) — the building-level core room.

Each room card shows:
- Room name and type badge (IDF / MDF)
- Building and optional floor assignment
- Racks with their patch panels listed inside

### Adding a network room (operator/admin)
1. Click **Add Room**
2. Enter the name (e.g., `IDF-W1-GF`), select type (IDF or MDF), and choose the building
3. Optionally select a floor if the room is on a specific floor
4. Click **Save**

### Adding a rack (operator/admin)
1. Open a room card and click **Add Rack**
2. Enter the rack name and U-count (default 42U)
3. Click **Save**

### Adding a patch panel (operator/admin)
1. Click **Add Panel** on a rack
2. Enter the panel name, U-position, port count, and cable type:
   - **Copper** — standard Cat5e/Cat6 copper ports
   - **Fiber** — all fiber-optic ports
   - **Mixed** — panel contains both copper and fiber ports
3. Click **Save**

### Wall ports

Wall ports represent the physical face plates mounted on walls or desks. They appear on the floor map as amber rectangles.

#### Adding a wall port (operator/admin)
1. On the Infra page, click **Add Wall Port**
2. Enter the label (e.g., `A-04`), select the floor, and optionally link it to a patch panel and port number
3. Click **Save**
4. You can then drag the wall port to its correct position on the floor map

#### Linking an asset to a wall port
1. Open the asset's edit form
2. In the **Network** section, choose the **Wall Port** from the dropdown
3. Save — the asset now shows its complete physical cable path in its details panel and on the floor map trace

### Deletion guards

You can't delete a rack, room, floor, or building while it still holds
mounted assets, wall ports, or network rooms — the app blocks the deletion
with a message telling you exactly what's still in the way (e.g. "Cannot
delete rack with 3 mounted asset(s)"), instead of silently leaving those
assets pointing at nothing. Reassign or remove the contents first, or use
**Replace** (below) if you're physically swapping the unit rather than
removing it for good.

Two wall ports also can't be assigned to the same patch-panel port or the
same switch port at the same time — the app rejects the second assignment,
since a physical port can only terminate one cable.

### Replacing a rack or patch panel (operator/admin)

When a cabinet or patch-panel cassette is physically swapped out, use
**Replace** (the 🔁 button next to a rack or panel, shown whenever another
one exists to replace it with) instead of manually reassigning every
mounted device or wired port:

1. Click 🔁 next to the rack or panel being swapped out
2. Choose the replacement (an existing rack in the same room, or panel in the
   same rack)
3. Confirm

Every patch panel and mounted asset in the old rack — or every wall port
wired into the old panel — moves to the replacement, keeping the same
U-positions/port numbers. The now-empty old rack/panel is then removed. If
the replacement is already occupied at one of those U-positions/ports, the
replace is rejected instead of silently overlapping two devices.

---

## Maintenance Calendar

The **Maintenance** page (`/maintenance`) shows all assets with a scheduled maintenance date on a monthly calendar.

### Reading the calendar
- **Blue entries** — maintenance scheduled for a future date
- **Red entries** — maintenance is overdue (date has passed)
- Days with overdue entries have a red background tint

Click any entry to open the asset's full details.

### Navigating months
Use the **◀ / ▶** arrows to move between months, or click **Today** to jump back to the current month.

### Overdue section
A collapsible **Overdue assets** panel appears above the calendar listing all assets past their maintenance date with the original scheduled date.

### Exporting
If the current month has any scheduled assets, a **CSV** button appears in the calendar header. Clicking it downloads a spreadsheet of that month's assets including name, type, status, maintenance dates, assigned person, serial number, and IP address.

> A [replaced](#replacing-an-asset) asset never appears on this calendar or in
> the overdue list, even if its old maintenance date is technically in the
> past — it's been superseded by its replacement, which carries its own
> schedule going forward.

---

## Normalisation run

**Normalisation run** is the page to open when picking the work back up. A round
is: export from ITSM → walk the site → hand both to the app → work the list →
act in Alemba → export again. Each step has its own page; this one says where the
round has got to.

It shows the four steps with **how long ago** each happened — the age is what
matters, since nobody remembers whether the export they loaded was the 12th or the
19th, but "27 days ago" is immediately a problem. Hover a figure for the exact
time.

The warning worth reading is **“The task list is older than the data.”** It means
the list was derived before the newest export or survey, so whatever it says now —
including "nothing outstanding" — describes a situation that has already changed.
The **Re-derive** button sits inside the warning. Pressing it counts as a check
even when it changes nothing, which is the point: "derived and found nothing" and
"never derived" look the same otherwise.

**This round is closed** appears only when the list is both empty *and* derived
from the current data. The next round starts with a fresh ITSM export.

The page never performs a step for you. Loading an export and importing a survey
both need the file in front of you and a preview you actually read — a one-click
"do everything" would be an invitation to skip the check that catches a partial
export.

---

## ITSM Reconcile

The **ITSM Reconcile** page compares assets in Factory Map against the company
ITSM system. **ITSM is the single source of truth and is never modified by this
app** — the page only *reads* from ITSM, and only when you ask it to.

### The list
Opening the page shows every asset that is linked to an ITSM record
(`hardware_asset_id`), together with its last check result: **Not checked**,
**In sync**, **Differences**, or **Missing in ITSM**. This list and the summary
cards at the top come from the local database — no ITSM traffic is generated by
just opening the page. A [replaced](#replacing-an-asset) asset drops off this
list automatically — there's no reason to keep reconciling a decommissioned
device, and the ITSM sync job never overwrites its fields back to "active"
either.

### Checking an asset (operator/admin)
Click **Check ITSM** on an asset. This performs exactly **one** ITSM lookup for
that asset and lists every field where the app and ITSM disagree — serial
number, status, MAC address, display name, asset tag, model, manufacturer, OS,
assigned person, organization, catalog item. Equivalent values are not flagged:
status vocabularies are mapped (`active` ⇄ `Deployed`) and MAC address
formatting is normalised (`AA-BB-…` equals `aa:bb:…`).

### Resolving a difference — per field, your choice
For each row you decide individually:

| Button | What happens |
|--------|--------------|
| **Accept** | The ITSM value is written into Factory Map (ITSM itself is untouched) |
| **Ignore** | The difference is hidden and remembered on the server; if ITSM later reports a *different* value, it resurfaces automatically. Un-ignore any time from the chip list |
| **ITSM is wrong** | Records that Alemba is the one that needs changing, and raises a task for it |
| *(none of them)* | Fix the value by hand in ITSM (use the **Open in ITSM** link), then **Re-check** |

**About "ITSM is wrong".** This is the case that comes up most after a physical survey — the person
standing in the room is right and the record is stale — and until it existed there was nowhere to put
it, so it lived in somebody's head.

Three things about it that are deliberate:

- **The row stays in the differences table.** Unlike an ignore, the difference has not gone away; it
  has been escalated. It stops being outstanding when Alemba actually changes, not when you click.
- **It replaces an ignore on the same field.** They are opposite decisions about one difference.
- **It closes itself.** The `correct-in-itsm` task it raises disappears once a later ITSM export
  reports the value the app was marked right about — so the correction is proven by Alemba changing,
  not by anyone saying so here. If the asset is not in the export at all, the task stays open,
  because nothing can prove it.

The app still never writes to ITSM. What this produces is work for a person.

### Missing in ITSM
If the linked record no longer exists in ITSM, the asset is flagged and offers
**Remove ITSM link** — this clears the link locally and turns the asset into a
plain local record. Nothing is deleted in ITSM.

Every accept, ignore and unlink is recorded in the **Audit Log**.

<a id="loading-a-fresh-itsm-export"></a>
### Loading a fresh ITSM export (operator/admin)

**Load an ITSM export** at the top of the page takes the Hardware Asset export
out of Alemba and refreshes what the app knows about ITSM. Pick the hardware JSON
(the two CSVs — catalog items and persons — are optional; without them the device
type, the make and the person ids stay unfilled, and the page says so).

The files are read **in your browser**; only the rows are sent, so the export
itself never lands on the server.

Press **What would this change?** first. Loading an export *replaces* the app's
picture of ITSM — an export is a point in time, and whatever is missing from it is
missing from ITSM — so the preview names what would appear, what would disappear
and which fields differ, record by record. If more than a tenth of the records
would disappear, it says so plainly: that is almost always a partial export rather
than that many devices leaving ITSM. **Apply** is a second, separate press, and
nothing is written before it.

Whatever disappeared becomes a "confirm or retire" task on the
[Tasks](#normalisation-tasks) page after the next re-derive.

<a id="inventory-import"></a>
### Inventory import (the physical walk-around)

**Inventory import** in the sidebar is where the physical inventory — the survey
tool's export from walking the site — is handed to the app and compared against
what it already holds.

Choose one or more survey exports (several files are merged; if the same entry
appears twice, the last file wins). The tool writes some exports with a `.bak`
extension — same JSON inside — and those are selectable too. As with the ITSM
export, the file is read in your browser and only its rows are sent.

**What would this change?** writes nothing. It tells you:

- how many devices would be re-placed, and how many would be **created as
  local-only records** because ITSM has never heard of them;
- how many would sit on a floor but in no room;
- every building, floor, room, person and HWA number that did **not** resolve.

That last list is the work. Each entry has a box next to it, pre-filled with a
suggestion when the app has a near-miss close enough to propose — "Rcpcio" next to
"Recepció". Saving it stores the answer and re-runs the preview, so you watch the
list shrink. The answer is kept for good: the next import reads that name the same
way, and so does the command-line importer.

Only the name that actually failed gets a box. If the building is unknown, the
floor name underneath it was never even checked, so you are not asked to correct
it.

If a room genuinely is not drawn yet, tick **Also create the rooms the survey
names and the map lacks** before applying. They appear as default-size rectangles
below whatever is already drawn on that floor — drag them into place on the
[Floor Map](#floor-map), then use **Arrange N unplaced** per room.

An identifier with no asset is not a naming problem, and it is two different
problems: a **number** was either misread off the device or is in ITSM but not yet
in the app — the ITSM Reconcile page creates those from the export — while a
**name** (`MMHIPC…`, `MMH PRINTER …`) is an older device nothing has on record and
needs identifying first. The row says which it is; neither has a box, because
neither is a spelling to correct.

### What the import will and will not overwrite

The survey fills in what was written down and **does not erase what was not**. A
blank person, room, note or network area in the survey leaves whatever the app
already has — most often something the ITSM export supplied. Where the survey does
give a value it wins: it is what somebody saw in the room, and a disagreement with
ITSM becomes a task rather than being hidden.

That matters most for people. On the current survey, 310 of the identified rows
name nobody — the walkers were recording rooms, not asking who sits at each desk —
and 233 of those devices have a person from ITSM. Those are left alone.

A few more things worth knowing before you press Apply:

- The preview says **how** each device was identified: by HWA number, by the number
  with its "HWA" prefix supplied, or by the older name on its asset tag. Older
  devices carry names like `MMHIPC7402` or `MMH PRINTER 1033`, and those still
  resolve.
- Serials that are not serials (`...`, `N/A 2`) are read as **no serial** and
  counted. The devices behind them come back as "read a number off it" — there is
  nothing else honest to do with a number nobody could reach.
- **The same device recorded twice** is listed before you apply. Applying is safe —
  the later row wins — but if a pair is really two devices, one is about to lose its
  own record.
- A **person correction that stays in the list** after you save it is telling you
  something: the corrected name is not in the export either. Either it is spelled
  differently there, or that person has no device in this export at all — in which
  case free text is the right answer. Technical accounts (`MMHGEN…`) belong in that
  second group; leave them empty, since a responsible person belongs there rather
  than a generic account.

**Apply — write the placements** is the only step that writes. Afterwards,
re-derive the [task list](#normalisation-tasks) so the newly created devices turn
into "register in ITSM" tasks.

---

<a id="normalisation-tasks"></a>
## Nexthink

**Nexthink** is the third source, and the only one that is not something a person typed: it is what the
machines report about themselves. The page is where an export gets loaded and where the questions that
export raises get read.

Two things to hold on to before reading any number here:

- **Nothing in this app writes to Nexthink.** It is evidence, never a system of record.
- **Nexthink only sees machines carrying its agent.** No monitor, dock or phone ever does. So every
  "absent from Nexthink" number is a limit of the source far more often than a gap in the estate, and
  the page says so next to each one.

### Loading an export (operator/admin)

Both files come from **Investigations → NQL editor → Run → export the grid**. The exact queries are in
the header of `import-nexthink-snapshot.ts`.

**Scope both exports to the same entities.** If they differ, the two files describe different
populations and every comparison between them is quietly wrong. The IPCs live in the Industry
entities, so an export scoped to `Veszprem-Client` alone silently omits every shop-floor machine.

**Check without importing** first. It writes nothing and it is where the numbers worth reading are —
in particular how many devices matched an asset in the map, which is the only place that join gets
measured before anything is overwritten. **Replace the snapshot** then loads it, replacing both tables
wholesale so they always mean "what Nexthink reported as of the last export" rather than a merged
cache nobody can reason about.

Choosing a different file clears the previous check, so the numbers on screen always belong to the
files currently selected.

### What the page tells you

| Section | The question it answers | What it cannot answer |
|---|---|---|
| **What this snapshot covers** | how many devices, per Nexthink entity, and how many are on Windows 11 | nothing about a device without an agent |
| **On the network, not in the map** | which machines are switched on and in no map record | — this is the strongest finding here; a machine cannot report without existing |
| **Stopped reporting** | which machines have gone quiet, counted back from the newest sighting in the export | whether they are gone. In the holiday season weeks of silence is usually leave, and the page says so |
| **The logons name a different person** | where the logon record and the map disagree clearly | who is right. A person who changed desks looks exactly like this |

Two readings the page protects you from:

- **"Absent from the export" is not "gone".** Nexthink drops long-inactive devices entirely, so a
  machine switched off months ago does not appear with an old date — it disappears. Only a comparison
  against the *previous* import can see that, and the page shows it when there is one.
- **A device newer than the loaded ITSM export** is marked as such rather than as missing from Alemba.
  Telling somebody to create a CI that already exists is how a duplicate is made.

### What is not on this page

The findings that are **actions** — a machine to register, a replaced machine still running, a person
to confirm. Those are on the **[Tasks](#tasks)** page, where one can be assigned, dismissed with a
reason, and closed by the data. A second list here would be a second thing to reconcile.

The **Windows 11 reinstall-or-set-aside** verdict is still command-line (`nexthink:win11`), because it
needs a third export — from a remote action — that the app does not store yet.

---

## Tasks

The **Tasks** page answers one question: what is left before the physical
inventory, this app and ITSM all agree?

### Where the data comes from — read this bar first

Above the list, a bar shows each source: how many rows it holds, when it was imported, and how much of
the estate it actually speaks for. It is there because the list below is only as trustworthy as the
exports it was derived from, and "7 devices quiet for 30+ days" means one thing against yesterday's
export and something else against one taken three weeks ago.

- **Coverage matters as much as the date.** A fresh export covering a third of the estate is not fresh
  data about the estate. The Nexthink line says how many assets have reported and why the rest have
  not — most of the gap is monitors and phones that never had an agent, which is not a gap at all.
- **"Import date unknown"** means the table holds data but no import was ever recorded. That is an
  honest unknown, not zero and not today.
- **Only one line is ever coloured**, and only when the source itself states something worth acting
  on — nothing loaded, or devices that dropped out since the previous import.

### The list

The list is **derived**, not kept by hand. **Re-derive from the data** recomputes
it from the three sources — the ITSM export, the survey as it landed in the app,
and the app's own records — so run it after every new export or survey import. It
is safe to run repeatedly: it adds what is new, closes what the data now proves
done, and brings back anything whose cause has returned. That is also why there is
no "add task" button: something that needs doing but cannot be derived means the
generator is missing a rule.

Every task carries the **evidence** that raised it, so you can judge it rather than
trust it. What you can do with one is deliberately narrow:

| Action | What it means |
|---|---|
| **Assign** | Type a name and press Enter. Free text — it need not be a Factory Map user |
| **Done** | For most kinds the *data* decides. If the cause is still there, the next re-derive reopens it — and the page tells you so instead of showing a plain "Saved" |
| **Dismiss** | Requires a reason. The task stays dismissed while the facts stay the same, and returns if they change |

One kind — **Put a label on it** — is marked *needs a person*: nothing in any
export records that a sticker was applied, so your word is the only evidence there
will ever be.

### What kinds you will see

Each kind names an action rather than a symptom — "register it in ITSM", not "missing from ITSM".

| Kind | What it is asking for | Raised from |
|---|---|---|
| Link to ITSM | a confident match was found; connect the asset to the record | ITSM + the matcher |
| Decide which record | several candidates, or a contradiction — a person picks | ITSM + the matcher |
| Register in ITSM | nothing in Alemba carries this device's key. Also raised for a machine Nexthink sees that no register knows at all | ITSM, Nexthink |
| Read a serial off the device | nothing to match on, so it cannot be told from hardware ITSM already holds | the matcher |
| Put a label on it | matched by serial rather than read off a sticker | the matcher |
| Check the HWA | the asset carries a number the export does not contain | ITSM |
| Confirm it exists or retire it | ITSM lists hardware the survey never found | ITSM |
| Resolve field differences | the asset and its ITSM record disagree | reconcile |
| **Add it to the map** | ITSM has it and Nexthink saw it running, but the map does not hold it | Nexthink |
| **Confirm who uses it** | the logon record and the map name different people | Nexthink |
| **Decide the replaced machine's fate** | a machine recorded as replaced is still reporting | Nexthink |
| **The survey saw it differently** | the survey brought a value the import declined to overwrite | the survey |
| **Correct it in Alemba** | you marked ITSM as the wrong one on the reconcile page | your decision |

The bolded ones are newer. Two are worth knowing the reasoning behind:

- **Add it to the map** replaces *Confirm it exists or retire it* for any device Nexthink has seen.
  That task sends somebody to find out whether hardware ITSM lists still exists; if the machine
  reported this week the answer is already yes, and walking the floor to confirm it is waste.
- **Decide the replaced machine's fate** states the observation and the choice but does not pick.
  Whether the right outcome is a reinstall or a shelf depends on Windows 11 eligibility, which comes
  from a separate Nexthink export — see [PROCESSES.md](PROCESSES.md).

When the list is empty the page says **Nothing outstanding**, which is the whole
point of the exercise: the inventory, the app and ITSM agree as far as the data can
show.

<a id="worksheet"></a>
### The worksheet — for the walk and for the typing

**Worksheet to print or export** on the Tasks page opens the same list arranged for
carrying. Pick a kind and a state, then either:

- **Print** — the sheet is grouped by room, in walking order, with a box beside each
  device to tick with a pen. A room's devices stay on one page, and the navigation and
  banners are left off the paper. Made for the labelling round: "put a label on it"
  only becomes actionable once you know which room to walk into.
- **CSV** — the same rows as a spreadsheet, with the serial, the type, the person, the
  place and the reason the task exists. This is the list for whoever registers devices
  in Alemba by hand.

Two things the sheet says out loud. Devices with **no room recorded** are collected
under one heading at the end rather than scattered through the route — those need
finding rather than walking to, and the count is stated at the top. And if the list is
longer than one sheet can hold, it says how many were left off, because a partial list
walked and fully ticked leaves the round open for reasons nobody can see.

The sheet is a snapshot and prints the time it was taken, so a page found on a desk can
be dated. Ticks on paper change nothing in the app: tasks are closed back on the Tasks
page, or by the next re-derive.

---

## Alerts

**(Admin role required)**

The **Alerts** page (`/alerts`) configures maintenance notifications and lets you create scheduled one-off alerts.

### Alert conditions
- **Overdue alerts** — notify when an asset's maintenance date has already passed
- **Upcoming alerts** — notify N days before the scheduled date (configurable; default 7)

### Email
1. Toggle **Email enabled**
2. Enter recipient addresses separated by commas
3. Configure `SMTP_*` environment variables on the server (ask your administrator)

### Microsoft Teams
1. Toggle **Teams enabled**
2. Paste the **incoming webhook URL** from your Teams channel

### Testing
Click **Test Now** to run the alert check immediately and send notifications for any currently affected assets. This is useful to verify SMTP/Teams configuration before the next daily run (07:00).

### Scheduled one-off alerts
The **Scheduled Alerts** section lets you create named reminders to be sent at a specific future date and time.

#### Creating a scheduled alert
1. In the **Scheduled Alerts** section, enter a **title** and **date/time**
2. Choose the **channel**: Email, Teams, or Both
3. Optionally enter an **asset filter** keyword to include only matching assets in the notification
4. Click **Schedule**

The alert fires automatically when the hourly cron next runs after the scheduled time. After it fires, it is marked **Sent** and can no longer be deleted.

#### Cancelling a scheduled alert
Click the **🗑** icon next to an unsent alert to delete it.

### Alert history
The **Alert History** table at the bottom shows the last 50 alert sends with: timestamp, channel (email/Teams), subject, success/failure status, and any error message.

---

## Reports

The Reports page provides:

### Asset Statistics
- Total assets by building
- Assets by type (pie chart / count)
- Assets by status
- Assets with open work items

All totals and counts exclude [replaced](#replacing-an-asset) assets — a
decommissioned device stops counting toward the fleet total, maintenance
figures, or location breakdowns the moment its replacement takes over, so
the numbers reflect what's actually deployed today.

### ITSM Sync
- Click **Sync All from ITSM** to pull the latest hardware data from the ITSM system
- The sync report shows how many assets were:
  - **Created** (new in ITSM, not yet in Factory Map)
  - **Updated** (ITSM-managed assets refreshed)
  - **Snapshotted** (locally-managed assets received a pending ITSM update for review)
  - **Skipped** (no changes in ITSM)
  - **Errors** (sync failed for specific assets)

### ITSM Snapshots
When an ITSM sync creates a snapshot for a locally-managed asset, an orange banner appears on the asset detail. Review the proposed changes and click:
- **Accept** — apply the ITSM data to your local record
- **Dismiss** — discard the snapshot and keep your local data

---

## Audit Log

The **Audit Log** records every create, update, and delete operation in the system.

### Browsing the audit log
1. Click **Audit Log** in the sidebar
2. Browse the chronological list of changes
3. Each entry shows:
   - **User** who made the change
   - **Action** (create / update / delete)
   - **Entity type** (asset, building, user, etc.)
   - **Timestamp**
   - **Diff** — what changed (old value vs. new value)

### Filtering the audit log
Use the filter controls to narrow down by:
- Username
- Action type
- Entity type
- Date range

### Asset-specific history
On an asset's detail panel, the **Audit History** section shows only the changes related to that specific asset.

---

## Settings

Click **Settings** in the sidebar to access personal preferences.

### Display settings
- **Items per page** — how many assets to show per page in list views (10, 25, 50, 100)
- **Date format** — how dates are displayed:
  - **Relative** — "3 days ago", "just now"
  - **Short** — "14.05.2026"
  - **Long** — "14 May 2026"

### Map settings
- **Map grid size** — pixel size of the snap grid (default: 20px)
- **Snap to grid** — toggle whether assets snap to the grid when placed
- **Default zoom** — starting zoom level when opening a floor map

### Theme
Toggle between **Light** and **Dark** mode from the header or settings page.

### Change password
1. Go to **Settings**
2. Click **Change Password**
3. Enter your current password and the new password twice
4. Click **Save**

The new password must meet the complexity requirements:
- 8+ characters, uppercase, lowercase, digit, special character

---

## User Management

**(Admin role required)**

### Accessing User Management
1. Go to **Settings**
2. Click **User Management**

### Creating a user
1. Click **Create User**
2. Enter username, password, role, and optional email
3. Click **Save**

### Changing a user's role
1. Find the user in the list
2. Click the role dropdown next to their name
3. Select the new role
4. Confirm the change

### Resetting a password
1. Find the user in the list
2. Click **Reset Password**
3. Enter the new password (must meet complexity requirements)
4. Click **Save**

### Deactivating a user
1. Find the user in the list
2. Click **Deactivate**
3. The user can no longer log in (their data is preserved)

### Re-activating a user
1. Find the deactivated user (shown with a strikethrough or "Inactive" badge)
2. Click **Activate**
3. This also resets any lockout counter

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open Global Search |
| `Ctrl+N` | Open the New Asset form (from Dashboard) |
| `?` | Open this keyboard shortcuts reference |
| `Escape` | Close any open modal, overlay, or popover |

### Dashboard

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New asset |

### Floor Map

| Shortcut | Action |
|----------|--------|
| `E` | Toggle edit mode (drag assets) |
| `W` | Toggle wire/connection mode |
| `Shift+Drag` | Pan the map without entering edit mode |

Press **?** anywhere in the app to see the full interactive shortcut reference.

---

## Tips & Best Practices

### Naming conventions
- Use consistent naming for assets. Example: `CUMMINS-IPC-001`, `MOTOR-SRV-01`
- Use the **ITSM Hardware Asset ID** (HWA number) as the asset tag for all hardware registered in the ITSM system
- Include the building/line identifier in the name for easy searching

### Work items
- Create a work item immediately when you discover something that needs attention
- Use **High** priority for security or compliance issues (e.g., end-of-life OS, missing backup)
- Use **Medium** for planned maintenance (e.g., scheduled OS upgrade)
- Use **Low** for cosmetic tasks (e.g., re-labeling a device)

### Connections
- Always record which patch panel port a device connects through — this is essential for network troubleshooting
- Use the **bidirectional** option for most physical connections (both sides see the link)

### ITSM sync
- Run a sync from ITSM monthly, or whenever you know hardware has been added/changed in the ITSM system
- Review any pending snapshots promptly — they represent ITSM data that conflicts with your local records

### Floor maps
- Place assets on the floor map as soon as they are physically installed
- Keep coordinates updated when devices are moved — the location history is recorded automatically

### Physical network documentation
- Assign a **wall port** to every networked device as soon as it's cabled — the full physical path (port → panel → rack → room) then appears in one click on the floor map
- Use **Mixed** cable type on patch panels that serve both copper and fiber runs rather than creating separate panels
- Keep the patch panel **port number** filled in on wall ports — this links the face plate to a specific row on the panel for faster cable tracing

### Searching
- Use the Global Search (Ctrl+K) to quickly find any asset — it searches name, serial, IP, and person simultaneously
- For advanced filtering, use the filter bar in asset list views
