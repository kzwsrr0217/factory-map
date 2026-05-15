# Factory Map — User Guide

## Table of Contents
1. [What is Factory Map?](#what-is-factory-map)
2. [Logging In](#logging-in)
3. [Navigation](#navigation)
4. [Dashboard](#dashboard)
5. [Buildings & Floors](#buildings--floors)
6. [Floor Map](#floor-map)
7. [Work Areas & Sections](#work-areas--sections)
8. [Assets](#assets)
   - [Browsing Assets](#browsing-assets)
   - [Asset Details](#asset-details)
   - [Creating an Asset](#creating-an-asset)
   - [Editing an Asset](#editing-an-asset)
   - [Asset Connections](#asset-connections)
   - [Work Items (To-Do Checklist)](#work-items)
   - [Importing Assets from CSV/Excel](#importing-assets)
9. [Global Search](#global-search)
10. [Network Graph](#network-graph)
11. [Maintenance Calendar](#maintenance-calendar)
12. [Alerts (Admins only)](#alerts)
13. [Reports](#reports)
14. [Audit Log](#audit-log)
15. [Settings](#settings)
16. [User Management (Admins only)](#user-management)
17. [Keyboard Shortcuts](#keyboard-shortcuts)
18. [Tips & Best Practices](#tips--best-practices)

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

1. Open the application in your browser (typically `http://factorymap.company.local` or `http://localhost:3000`)
2. Enter your **username** and **password**
3. Click **Sign In**

If your company uses Active Directory, click **Sign in with Active Directory** and enter your Windows username and password.

### Password requirements
- At least 8 characters
- At least one uppercase letter, one lowercase letter, one number, and one special character

### Forgot your password?
Contact your system administrator — they can reset your password from the User Management page.

### Account locked?
After 5 failed login attempts, your account is locked for 30 minutes. Contact your administrator to unlock it sooner.

---

## Navigation

The left **sidebar** is the main navigation menu:

| Section | Description |
|---------|-------------|
| Dashboard | Overview statistics, asset list, bulk actions |
| Buildings | Browse buildings and floors |
| Map View | Interactive floor plan map |
| Unplaced | Assets not yet positioned on any floor plan |
| Reports | Asset statistics and ITSM sync |
| Network | Force-directed graph of all asset connections |
| Maintenance | Monthly calendar of scheduled maintenance |
| Audit Log | Immutable history of all changes |
| Alerts | Maintenance alert configuration *(admin only)* |
| Settings | Personal preferences, map settings, user management |

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
- **Pan**: click and drag on an empty area of the map
- **Zoom**: use the scroll wheel, or the **+** / **−** buttons in the top-right corner
- **Reset view**: click the target icon to fit the map to the screen
- **Minimap**: a small overview map appears in the bottom-right corner

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

### Map controls
- **Grid snap**: toggle grid snapping in **Settings → Map Grid Snap**
- **Export map**: click the Export button to download the map as a PNG image
- **Print**: click the Print button to open the print dialog

---

## Work Areas & Sections

Work areas are zones within a floor (e.g., "Assembly Line 1", "Server Room"). Sections are subdivisions within work areas. Workstations are individual positions within sections.

### Viewing work areas
Work areas appear as coloured rectangles on the floor map. Click one to see its details.

### Creating a work area (operator/admin)
1. Open a floor map
2. Click **Add Work Area**
3. Enter a name and optional type
4. The work area appears on the map and can be repositioned by dragging

### Adding sections to a work area
1. Click on a work area on the map
2. In the details panel, click **Add Section**
3. Enter the section name and capacity

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

The panel shows all information organized in sections:

| Section | What you'll find |
|---------|-----------------|
| **Work Items** | IT task checklist for this device |
| **Basic Information** | Name, type, serial number, asset tag, manufacturer, model, OS |
| **Network** | IP address, DHCP/static, hostname, VLAN, switch port |
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
Work items appear at the top of the asset details panel. Open items are highlighted with a badge showing the count.

#### Adding a work item
1. Open the asset details panel
2. In the **Work Items** section, type the task description
3. Choose a priority: **Low**, **Medium**, or **High**
4. Press **Enter** or click **Add**

#### Completing a work item
Check the checkbox next to the item. It immediately saves and the item is shown as strikethrough.

#### Deleting a work item
Click the **🗑** (trash) icon next to the item.

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

---

## Alerts

**(Admin role required)**

The **Alerts** page (`/alerts`) configures the daily maintenance notification system.

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

### Searching
- Use the Global Search (Ctrl+K) to quickly find any asset — it searches name, serial, IP, and person simultaneously
- For advanced filtering, use the filter bar in asset list views
