"""
Seed test data for Factory Map — realistic IPC/IT asset environment.
Creates: 2 buildings, 2 floors each, work areas, sections, and ~30 assets.
"""
import json, urllib.request, urllib.error

API = "http://localhost:4000/api"

def post(path, payload, token=None):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{API}{path}", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def patch(path, payload, token):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{API}{path}", data=data, method="PATCH")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# ── Auth ──────────────────────────────────────────────────────────────────────
print("Logging in…")
r = post("/auth/login", {"username": "admin", "password": "Admin@1234"})
token = r.get("token") or r.get("data", {}).get("token")
assert token, "Login failed"

# ── Buildings ─────────────────────────────────────────────────────────────────
print("Creating buildings…")
b1 = post("/buildings", {"name": "Cummins Assembly Hall", "address": "Plant 1, North Wing"}, token)["data"]
b2 = post("/buildings", {"name": "Motor & Rotor Building", "address": "Plant 2, South Wing"}, token)["data"]

# ── Floors ───────────────────────────────────────────────────────────────────
print("Creating floors…")
f1a = post("/floors", {"building_id": b1["_id"], "name": "Ground Floor", "floor_number": 0}, token)["data"]
f1b = post("/floors", {"building_id": b1["_id"], "name": "First Floor",  "floor_number": 1}, token)["data"]
f2a = post("/floors", {"building_id": b2["_id"], "name": "Ground Floor", "floor_number": 0}, token)["data"]
f2b = post("/floors", {"building_id": b2["_id"], "name": "Mezzanine",    "floor_number": 1}, token)["data"]

# ── Work Areas ───────────────────────────────────────────────────────────────
print("Creating work areas…")
wa1 = post("/workareas", {"floor_id": f1a["_id"], "name": "Line 1 Assembly", "color": "#3b82f6", "x": 50, "y": 50, "width": 300, "height": 200}, token)["data"]
wa2 = post("/workareas", {"floor_id": f1a["_id"], "name": "Line 2 Assembly", "color": "#6366f1", "x": 400, "y": 50, "width": 300, "height": 200}, token)["data"]
wa3 = post("/workareas", {"floor_id": f1b["_id"], "name": "IT Server Room",  "color": "#7c3aed", "x": 50, "y": 50, "width": 200, "height": 150}, token)["data"]
wa4 = post("/workareas", {"floor_id": f2a["_id"], "name": "Rotor Line",      "color": "#15803d", "x": 50, "y": 50, "width": 400, "height": 200}, token)["data"]
wa5 = post("/workareas", {"floor_id": f2a["_id"], "name": "Motor Test Bay",  "color": "#b45309", "x": 500, "y": 50, "width": 250, "height": 200}, token)["data"]

# ── Sections ─────────────────────────────────────────────────────────────────
print("Creating sections…")
sec1 = post("/sections", {"workarea_id": wa1["_id"], "name": "Station A", "x": 60, "y": 60, "width": 120, "height": 80}, token)["data"]
sec2 = post("/sections", {"workarea_id": wa1["_id"], "name": "Station B", "x": 200, "y": 60, "width": 120, "height": 80}, token)["data"]
sec3 = post("/sections", {"workarea_id": wa2["_id"], "name": "Press Cell", "x": 410, "y": 60, "width": 120, "height": 80}, token)["data"]
sec4 = post("/sections", {"workarea_id": wa4["_id"], "name": "Winding Station", "x": 60, "y": 60, "width": 140, "height": 90}, token)["data"]

# ── Assets ───────────────────────────────────────────────────────────────────
print("Creating assets…")

def asset(name, atype, bldg_id, floor_id, wa_id=None, sec_id=None, extra=None, x=0, y=0):
    payload = {
        "basic_info": {"display_name": name, "asset_type": atype, "status": "active"},
        "hierarchy": {"building_id": bldg_id, "floor_id": floor_id,
                      "workarea_id": wa_id, "section_id": sec_id,
                      "workstation_id": None},
        "location": {"coordinates": {"x": x, "y": y}, "icon_type": "computer"},
        "itsm": {"hardware_asset_id": None, "is_managed": False, "sync_status": "never"},
    }
    if extra:
        payload.update(extra)
    return post("/assets", payload, token)["data"]

# ── Cummins Line 1 ────────────────────────────────────────────────────────────
ipc1 = asset("518142-23", "ipc", b1["_id"], f1a["_id"], wa1["_id"], sec1["_id"], {
    "basic_info": {"display_name": "518142-23", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Siemens", "model": "IPC477E",
                   "serial_number": "SN-CUM-001", "os_type": "Windows", "os_version": "Windows 10 IoT 2021"},
    "itsm": {"hardware_asset_id": "HWA14744", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.136.10", "vlan": "Vlan 136", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i7-4770TE 2.3GHz", "ram": "16GB RAM", "storage": "240GB SSD"},
    "custom_fields": {"object_id": "518142-23", "serial_object": "444444-001",
                      "environment": "Production", "remote_access_tool": "BeyondTrust",
                      "remote_access_version": "24.1.0", "backup_tool": "Veeam",
                      "backup_status": "active", "fortiedr_active": True},
    "work_items": [],
}, x=70, y=70)

ipc2 = asset("518142-24", "ipc", b1["_id"], f1a["_id"], wa1["_id"], sec2["_id"], {
    "basic_info": {"display_name": "518142-24", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Siemens", "model": "IPC477E",
                   "serial_number": "SN-CUM-002", "os_type": "Windows", "os_version": "Windows 10 IoT 2021"},
    "itsm": {"hardware_asset_id": "HWA14745", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.136.11", "vlan": "Vlan 136", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i7-4770TE 2.3GHz", "ram": "16GB RAM", "storage": "240GB SSD"},
    "custom_fields": {"object_id": "518142-24", "serial_object": "444444-002",
                      "environment": "Production", "remote_access_tool": "BeyondTrust",
                      "remote_access_version": "24.1.0", "backup_tool": "Veeam",
                      "backup_status": "active", "fortiedr_active": True},
    "work_items": [
        {"id": "wi-001", "description": "Windows Update overdue — last applied 90 days ago",
         "done": False, "priority": "high", "created_at": "2026-04-01T08:00:00Z"},
        {"id": "wi-002", "description": "Asset label missing — print and attach",
         "done": False, "priority": "low", "created_at": "2026-04-15T09:00:00Z"},
    ],
}, x=210, y=70)

ipc3 = asset("518142-31", "ipc", b1["_id"], f1a["_id"], wa2["_id"], sec3["_id"], {
    "basic_info": {"display_name": "518142-31", "asset_type": "ipc", "status": "maintenance",
                   "manufacturer": "Beckhoff", "model": "C6030",
                   "serial_number": "SN-CUM-010", "os_type": "Windows", "os_version": "Windows 7 SP1"},
    "itsm": {"hardware_asset_id": "MMHIPC7814", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.136.25", "vlan": "Vlan 136", "dhcp_static": "static"},
    "technical_specs": {"cpu": "Core 2 Duo E8400", "ram": "4GB DDR2", "storage": "60GB HDD"},
    "custom_fields": {"object_id": "518142-31", "serial_object": "444444-010",
                      "environment": "Production", "remote_access_tool": "TeamViewer",
                      "backup_tool": "Manual", "backup_status": "not_configured",
                      "fortiedr_active": False},
    "work_items": [
        {"id": "wi-003", "description": "Schedule OS upgrade — Win7 EoL, FortiEDR not compatible",
         "done": False, "priority": "high", "created_at": "2026-03-10T10:00:00Z"},
        {"id": "wi-004", "description": "Replace HDD with SSD before upgrade",
         "done": False, "priority": "medium", "created_at": "2026-03-10T10:05:00Z"},
        {"id": "wi-005", "description": "Install BeyondTrust after OS upgrade",
         "done": False, "priority": "medium", "created_at": "2026-03-10T10:10:00Z"},
    ],
}, x=415, y=70)

# ── IT Server Room ────────────────────────────────────────────────────────────
srv1 = asset("CUMINS-SRV-01", "server", b1["_id"], f1b["_id"], wa3["_id"], None, {
    "basic_info": {"display_name": "CUMINS-SRV-01", "asset_type": "server", "status": "active",
                   "manufacturer": "Dell", "model": "PowerEdge R740",
                   "serial_number": "SN-SRV-001", "os_type": "Windows Server",
                   "os_version": "Windows Server 2022"},
    "itsm": {"hardware_asset_id": "HWA20001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.10.5", "hostname": "CUMINS-SRV-01",
                "vlan": "Vlan 10", "dhcp_static": "static"},
    "technical_specs": {"cpu": "Intel Xeon Gold 6254", "ram": "64GB DDR4", "storage": "4TB RAID5"},
    "assigned_person": {"person_id": "IT001", "full_name": "Nagy Gábor"},
    "custom_fields": {"environment": "Production", "serial_object": "444444-100",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "24.1.0",
                      "backup_tool": "Veeam", "backup_status": "active", "fortiedr_active": True},
    "work_items": [],
}, x=70, y=70)

sw1 = asset("CUMINS-SW-01", "switch", b1["_id"], f1b["_id"], wa3["_id"], None, {
    "basic_info": {"display_name": "CUMINS-SW-01", "asset_type": "switch", "status": "active",
                   "manufacturer": "Cisco", "model": "Catalyst 2960-X",
                   "serial_number": "SN-SW-001"},
    "itsm": {"hardware_asset_id": "HWA20002", "is_managed": False, "sync_status": "never"},
    "network": {"ip_address": "192.168.10.254", "hostname": "CUMINS-SW-01",
                "vlan": "Vlan 10", "dhcp_static": "static"},
    "custom_fields": {"environment": "Production", "serial_object": "444444-101"},
    "work_items": [],
}, x=150, y=70)

ap1 = asset("CUMINS-AP-GF-01", "access_point", b1["_id"], f1a["_id"], wa1["_id"], None, {
    "basic_info": {"display_name": "CUMINS-AP-GF-01", "asset_type": "access_point", "status": "active",
                   "manufacturer": "Cisco", "model": "Aironet 2802I",
                   "serial_number": "SN-AP-001"},
    "itsm": {"hardware_asset_id": "HWA20010", "is_managed": False, "sync_status": "never"},
    "network": {"ip_address": "192.168.10.20", "vlan": "Vlan 10", "dhcp_static": "static"},
    "custom_fields": {"environment": "Production"},
    "work_items": [],
}, x=300, y=180)

# ── Rotor Line ────────────────────────────────────────────────────────────────
ipc4 = asset("Csévélő Gép 1", "ipc", b2["_id"], f2a["_id"], wa4["_id"], sec4["_id"], {
    "basic_info": {"display_name": "Csévélő Gép 1", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Beckhoff", "model": "C6515",
                   "serial_number": "SN-ROT-001", "os_type": "Windows", "os_version": "Windows 10 IoT 2021"},
    "itsm": {"hardware_asset_id": "HWA31001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.142.10", "vlan": "Vlan 142", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i7-6700 3.4GHz", "ram": "16GB DDR4", "storage": "256GB SSD"},
    "custom_fields": {"serial_object": "444444-200", "environment": "Production",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "24.1.0",
                      "backup_tool": "Veeam", "backup_status": "active", "fortiedr_active": True},
    "work_items": [],
}, x=70, y=70)

ipc5 = asset("Csévélő Gép 2", "ipc", b2["_id"], f2a["_id"], wa4["_id"], sec4["_id"], {
    "basic_info": {"display_name": "Csévélő Gép 2", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Beckhoff", "model": "C6515",
                   "serial_number": "SN-ROT-002", "os_type": "Windows", "os_version": "Windows 10 IoT 2021"},
    "itsm": {"hardware_asset_id": "HWA31002", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.142.11", "vlan": "Vlan 142", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i7-6700 3.4GHz", "ram": "16GB DDR4", "storage": "256GB SSD"},
    "custom_fields": {"serial_object": "444444-201", "environment": "Production",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "23.2.0",
                      "backup_tool": "Veeam", "backup_status": "active", "fortiedr_active": True},
    "work_items": [
        {"id": "wi-010", "description": "Update BeyondTrust from 23.2.0 to 24.1.0",
         "done": False, "priority": "medium", "created_at": "2026-04-20T11:00:00Z"},
    ],
}, x=160, y=70)

ipc6 = asset("Tekercselő IPC", "ipc", b2["_id"], f2a["_id"], wa4["_id"], None, {
    "basic_info": {"display_name": "Tekercselő IPC", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Siemens", "model": "IPC427E",
                   "serial_number": "SN-ROT-010", "os_type": "Windows", "os_version": "Windows 7 SP1"},
    "itsm": {"hardware_asset_id": "MMHIPC8001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.142.15", "vlan": "Vlan 142", "dhcp_static": "static"},
    "technical_specs": {"cpu": "Core i5-4570T 2.9GHz", "ram": "8GB RAM", "storage": "120GB SSD"},
    "custom_fields": {"serial_object": "444444-210", "environment": "Production",
                      "remote_access_tool": "TeamViewer", "backup_tool": "Manual",
                      "backup_status": "not_configured", "fortiedr_active": False},
    "work_items": [
        {"id": "wi-011", "description": "Win7 EoL — plan upgrade or hardware replacement",
         "done": False, "priority": "high", "created_at": "2026-02-01T08:00:00Z"},
        {"id": "wi-012", "description": "Migrate from TeamViewer to BeyondTrust",
         "done": False, "priority": "high", "created_at": "2026-02-01T08:10:00Z"},
        {"id": "wi-013", "description": "Confirm Veeam license for this machine",
         "done": False, "priority": "medium", "created_at": "2026-02-01T08:20:00Z"},
    ],
}, x=250, y=70)

# ── Motor Test Bay ────────────────────────────────────────────────────────────
ipc7 = asset("Motor Teszter IPC", "ipc", b2["_id"], f2a["_id"], wa5["_id"], None, {
    "basic_info": {"display_name": "Motor Teszter IPC", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Kontron", "model": "KBox A-230-R",
                   "serial_number": "SN-MOT-001", "os_type": "Windows", "os_version": "Windows 10 LTSC 2019"},
    "itsm": {"hardware_asset_id": "HWA32001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.145.10", "vlan": "Vlan 145", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i5-7500T 2.7GHz", "ram": "16GB DDR4", "storage": "256GB SSD"},
    "assigned_person": {"person_id": "PROD002", "full_name": "Kovács Péter"},
    "custom_fields": {"serial_object": "444444-300", "environment": "Production",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "24.1.0",
                      "backup_tool": "Veeam", "backup_status": "active", "fortiedr_active": True},
    "work_items": [],
}, x=510, y=70)

ipc8 = asset("Motor Teszter IPC 2", "ipc", b2["_id"], f2a["_id"], wa5["_id"], None, {
    "basic_info": {"display_name": "Motor Teszter IPC 2", "asset_type": "ipc", "status": "active",
                   "manufacturer": "Kontron", "model": "KBox A-230-R",
                   "serial_number": "SN-MOT-002", "os_type": "Windows", "os_version": "Windows 10 LTSC 2019"},
    "itsm": {"hardware_asset_id": "HWA32002", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.145.11", "vlan": "Vlan 145", "dhcp_static": "static"},
    "technical_specs": {"cpu": "i5-7500T 2.7GHz", "ram": "16GB DDR4", "storage": "256GB SSD"},
    "assigned_person": {"person_id": "PROD002", "full_name": "Kovács Péter"},
    "custom_fields": {"serial_object": "444444-301", "environment": "Production",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "24.1.0",
                      "backup_tool": "Veeam", "backup_status": "error"},
    "work_items": [
        {"id": "wi-020", "description": "Veeam backup job failing since 2026-04-10 — check repository space",
         "done": False, "priority": "high", "created_at": "2026-04-10T07:00:00Z"},
    ],
}, x=580, y=70)

# Workstations (IT staff)
ws1 = asset("IT-WS-Nagy", "workstation", b1["_id"], f1b["_id"], wa3["_id"], None, {
    "basic_info": {"display_name": "IT-WS-Nagy", "asset_type": "workstation", "status": "active",
                   "manufacturer": "Dell", "model": "OptiPlex 7090",
                   "serial_number": "SN-WS-001", "os_type": "Windows", "os_version": "Windows 11 Pro"},
    "itsm": {"hardware_asset_id": "HWA50001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.10.100", "hostname": "IT-WS-NAGY",
                "vlan": "Vlan 10", "dhcp_static": "dhcp"},
    "technical_specs": {"cpu": "Intel Core i7-10700", "ram": "32GB DDR4", "storage": "512GB SSD"},
    "assigned_person": {"person_id": "IT001", "full_name": "Nagy Gábor"},
    "custom_fields": {"environment": "Office", "remote_access_tool": "BeyondTrust",
                      "remote_access_version": "24.1.0", "backup_tool": "Veeam",
                      "backup_status": "active", "fortiedr_active": True},
    "work_items": [],
}, x=80, y=110)

# Monitor linked to workstation
mon1 = asset("DELL-MON-001", "monitor", b1["_id"], f1b["_id"], wa3["_id"], None, {
    "basic_info": {"display_name": "DELL-MON-001", "asset_type": "monitor", "status": "active",
                   "manufacturer": "Dell", "model": "UltraSharp U2722D",
                   "serial_number": "SN-MON-001"},
    "itsm": {"hardware_asset_id": "HWA50010", "is_managed": False, "sync_status": "never"},
    "assigned_person": {"person_id": "IT001", "full_name": "Nagy Gábor"},
    "custom_fields": {"environment": "Office"},
    "work_items": [],
}, x=80, y=140)

srv2 = asset("MOTOR-SRV-01", "server", b2["_id"], f2b["_id"], None, None, {
    "basic_info": {"display_name": "MOTOR-SRV-01", "asset_type": "server", "status": "active",
                   "manufacturer": "HP", "model": "ProLiant DL360 Gen10",
                   "serial_number": "SN-SRV-010", "os_type": "Windows Server",
                   "os_version": "Windows Server 2019"},
    "itsm": {"hardware_asset_id": "HWA40001", "is_managed": True, "sync_status": "never"},
    "network": {"ip_address": "192.168.20.5", "hostname": "MOTOR-SRV-01",
                "vlan": "Vlan 20", "dhcp_static": "static"},
    "technical_specs": {"cpu": "Intel Xeon Silver 4210R", "ram": "32GB DDR4", "storage": "2TB RAID1"},
    "assigned_person": {"person_id": "IT001", "full_name": "Nagy Gábor"},
    "custom_fields": {"environment": "Production", "serial_object": "444444-400",
                      "remote_access_tool": "BeyondTrust", "remote_access_version": "24.1.0",
                      "backup_tool": "Veeam", "backup_status": "active", "fortiedr_active": True},
    "work_items": [
        {"id": "wi-030", "description": "Add second NIC for redundancy",
         "done": False, "priority": "low", "created_at": "2026-05-01T09:00:00Z"},
    ],
})

# ── Connections ───────────────────────────────────────────────────────────────
print("Creating connections…")

def connect(asset_id, connected_id, conn_type, label=None, pp=None, token=token):
    payload = {"connected_asset_id": connected_id, "connection_type": conn_type,
               "bidirectional": True, "strength": "normal"}
    if label: payload["label"] = label
    if pp:    payload["patch_panel"] = pp
    try:
        post(f"/assets/{asset_id}/connections", payload, token)
    except Exception as e:
        print(f"  [warn] connection failed: {e}")

# IPC 1 → Switch (ethernet)
connect(ipc1["_id"], sw1["_id"], "ethernet", "Plant Network",
        {"panel_name": "PP-LINE1", "panel_port": "01", "switch_name": "CUMINS-SW-01", "switch_port": "Gi0/1"})

# IPC 2 → Switch
connect(ipc2["_id"], sw1["_id"], "ethernet", "Plant Network",
        {"panel_name": "PP-LINE1", "panel_port": "02", "switch_name": "CUMINS-SW-01", "switch_port": "Gi0/2"})

# Workstation → Server (network dependency)
connect(ws1["_id"], srv1["_id"], "network", "Domain Services")

# Monitor → Workstation
connect(mon1["_id"], ws1["_id"], "usb", "USB-C Hub", None)

# IPC4 → IPC5 (peer - same line)
connect(ipc4["_id"], ipc5["_id"], "peer", "Line Sync")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\nSeed complete!")
all_ids = [ipc1, ipc2, ipc3, ipc4, ipc5, ipc6, ipc7, ipc8, srv1, srv2, sw1, ap1, ws1, mon1]
print(f"  Buildings: 2  Floors: 4  WorkAreas: 5  Sections: 4")
print(f"  Assets created: {len(all_ids)}")
print(f"  Connections: 5")
print(f"\nAssets with open work items:")
for a in [ipc2, ipc3, ipc5, ipc6, ipc8, srv2]:
    n = len([i for i in a.get("work_items",[]) if not i.get("done")])
    if n: print(f"    {a['basic_info']['display_name']} — {n} open item(s)")
