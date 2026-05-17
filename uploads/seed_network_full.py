"""
seed_network_full.py — Full realistic network infrastructure seed.

What this script does:
  1. Patches all 74 existing wall ports to add switch_asset_id (proper cross-patching)
  2. Fixes the 4 ALC/SPARE ports that are missing patch_port numbers
  3. Adds second copper panel to every IDF/MDF rack
  4. Adds management/IPMI panels to server racks
  5. Creates 80+ new wall ports across all floors with full connections
  6. Leaves a realistic mix: some patched, some spare (unpatched)

Run inside the project root:
    python uploads/seed_network_full.py
"""
import urllib.request, urllib.parse, json, sys, time

BASE = "http://localhost:4000"

# ── helpers ──────────────────────────────────────────────────────────────────

def api(method, path, data=None, token=None):
    url = BASE + path
    body = json.dumps(data).encode() if data else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERROR {method} {path}: {e.code} {err[:120]}")
        return None

def login():
    r = api("POST", "/api/auth/login", {"username": "admin", "password": "Admin@1234"})
    return r["data"]["token"]

def get_all(path, token):
    r = api("GET", path, token=token)
    return r["data"] if r else []

def patch(path, data, token):
    return api("PATCH", path, data, token)

def post(path, data, token):
    return api("POST", path, data, token)

def ok(label):
    print(f"  [+] {label}")

# ── asset & infrastructure IDs (from live DB) ─────────────────────────────

# Switch/router asset UUIDs
SW = {
    "W1-SW-CORE-01":  "93B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SW-DIST-GF":  "A5B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SW-ACC-ALA":  "A6B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SW-ACC-ALB":  "A7B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SW-ACC-ALC":  "A8B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SW-DIST-FF":  "A9B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-RTR-01":      "8FB3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-FW-01":       "91B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SRV-01":      "9BB3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SRV-02":      "9EB3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-SRV-03":      "A1B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-NAS-01":      "A4B3433E-F36B-1410-820E-001FAACEC9AE",
    "W2-SW-CORE-01":  "88B4433E-F36B-1410-820E-001FAACEC9AE",
    "W2-SW-STAMP":    "8DB4433E-F36B-1410-820E-001FAACEC9AE",
    "W2-RTR-01":      "83B4433E-F36B-1410-820E-001FAACEC9AE",
    "W3-SW-CORE-01":  "FFB4433E-F36B-1410-820E-001FAACEC9AE",
    "W3-RTR-01":      "F9B4433E-F36B-1410-820E-001FAACEC9AE",
}

# Existing rack IDs
RACK = {
    "RACK-W1-CORE":  "380C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W1-SRV":   "390C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W1-FIBER": "3A0C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W1-GF-01": "3B0C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W1-FF-01": "400C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W2-CORE":  "450C433E-F36B-1410-8211-001FAACEC9AE",
    "RACK-W3-CORE":  "4A0C433E-F36B-1410-8211-001FAACEC9AE",
}

# Existing patch panel IDs
PP = {
    "PP-W1-CORE-CU":   "4F0C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-SRV":       "540C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-CAMPUS":    "550C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-RISER-GF":  "560C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-RISER-FF":  "570C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-GF-PROD":   "580C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-GF-FIBER":  "590C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-FF-OFFICE": "5A0C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W1-FF-FIBER":  "5C0C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W2-MFG":       "5E0C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W2-FIBER":     "600C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W3-WH":        "620C433E-F36B-1410-8211-001FAACEC9AE",
    "PP-W3-FIBER":     "640C433E-F36B-1410-8211-001FAACEC9AE",
}

# Floor IDs
FLOOR = {
    "W1-BAS": "31B3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-GF":  "3BB3433E-F36B-1410-820E-001FAACEC9AE",
    "W1-FF":  "59B3433E-F36B-1410-820E-001FAACEC9AE",
    "W2-GF":  "6FB3433E-F36B-1410-820E-001FAACEC9AE",
    "W3-GF":  "83B3433E-F36B-1410-820E-001FAACEC9AE",
}

# ── STEP 1: patch existing wall ports with switch_asset_id ────────────────

def patch_existing_ports(token):
    print("\n[1] Patching existing wall ports with switch_asset_id...")
    ports = get_all("/api/network/wall-ports", token)
    port_map = {p["label"]: p["_id"] for p in ports}

    updates = []

    # ── WERK1 Basement — PP-W1-SRV (core switch uplinks/server drops) ──────
    # These 8 ports on the server patch panel connect to core switch Gi1/0/1-8
    bas_assignments = [
        ("WP-W1-BAS-01", SW["W1-SW-CORE-01"], "Gi1/0/1", 1,  "W1-RTR-01 — router data port"),
        ("WP-W1-BAS-02", SW["W1-SW-CORE-01"], "Gi1/0/2", 2,  "W1-FW-01 — firewall LAN port"),
        ("WP-W1-BAS-03", SW["W1-SW-CORE-01"], "Gi1/0/3", 3,  "W1-SRV-01 — application server"),
        ("WP-W1-BAS-04", SW["W1-SW-CORE-01"], "Gi1/0/4", 4,  "W1-SRV-02 — application server"),
        ("WP-W1-BAS-05", SW["W1-SW-CORE-01"], "Gi1/0/5", 5,  "W1-SRV-03 MES — MES server"),
        ("WP-W1-BAS-06", SW["W1-SW-CORE-01"], "Gi1/0/6", 6,  "W1-NAS-01 — NAS storage"),
        ("WP-W1-BAS-07", SW["W1-SW-CORE-01"], "Gi1/0/7", 7,  "W1-SW-DIST-GF — uplink to GF dist"),
        ("WP-W1-BAS-08", SW["W1-SW-CORE-01"], "Gi1/0/8", 8,  "W1-SW-DIST-FF — uplink to FF dist"),
    ]
    for label, sw_id, sw_port, pp_port, desc in bas_assignments:
        if label in port_map:
            updates.append((port_map[label], {"switch_asset_id": sw_id, "switch_port": sw_port,
                                               "patch_port": pp_port, "description": desc}))

    # ── WERK1 GF — production area, patched to access switches ──────────────
    gf_assignments = [
        # ALA line — 7 drops → W1-SW-ACC-ALA
        ("WP-W1-GF-ALA-01", SW["W1-SW-ACC-ALA"], "Gi1/0/1",  1,  "W1-IPC-ALA-01 — IPC workstation A1"),
        ("WP-W1-GF-ALA-02", SW["W1-SW-ACC-ALA"], "Gi1/0/2",  2,  "W1-IPC-ALA-02 — IPC workstation A2"),
        ("WP-W1-GF-ALA-03", SW["W1-SW-ACC-ALA"], "Gi1/0/3",  3,  "W1-IPC-ALA-03 — IPC workstation A3"),
        ("WP-W1-GF-ALA-04", SW["W1-SW-ACC-ALA"], "Gi1/0/4",  4,  "W1-HMI-ALA-01 — HMI panel A"),
        ("WP-W1-GF-ALA-05", SW["W1-SW-ACC-ALA"], "Gi1/0/5",  5,  "W1-HMI-ALA-02 — HMI panel B"),
        ("WP-W1-GF-ALA-06", SW["W1-SW-ACC-ALA"], "Gi1/0/6",  6,  "W1-PLC-ALA-01 — PLC station A1"),
        ("WP-W1-GF-ALA-07", SW["W1-SW-ACC-ALA"], "Gi1/0/7",  7,  "W1-PLC-ALA-02 — PLC station A2"),
        # ALB line — 5 drops → W1-SW-ACC-ALB
        ("WP-W1-GF-ALB-01", SW["W1-SW-ACC-ALB"], "Gi1/0/1",  8,  "W1-IPC-ALB-01 — IPC workstation B1"),
        ("WP-W1-GF-ALB-02", SW["W1-SW-ACC-ALB"], "Gi1/0/2",  9,  "W1-IPC-ALB-02 — IPC workstation B2"),
        ("WP-W1-GF-ALB-03", SW["W1-SW-ACC-ALB"], "Gi1/0/3",  10, "W1-PLC-ALB-01 — PLC station B1"),
        ("WP-W1-GF-ALB-04", SW["W1-SW-ACC-ALB"], "Gi1/0/4",  11, "W1-PLC-ALB-02 — PLC station B2"),
        ("WP-W1-GF-ALB-05", SW["W1-SW-ACC-ALB"], "Gi1/0/5",  12, "W1-PLC-ALB-03 — PLC station B3"),
        # ALC line — 2 drops → W1-SW-ACC-ALC (fix missing patch_port)
        ("WP-W1-GF-ALC-01", SW["W1-SW-ACC-ALC"], "Gi1/0/1",  13, "W1-PLC-ALC-01 — PLC station C1"),
        ("WP-W1-GF-ALC-02", SW["W1-SW-ACC-ALC"], "Gi1/0/2",  14, "W1-PLC-ALC-02 — PLC station C2"),
        # CNC/Robot/KRC via distribution switch
        ("WP-W1-GF-CNC-01", SW["W1-SW-DIST-GF"], "Gi1/0/1",  15, "W1-CNC-01 — CNC milling machine"),
        ("WP-W1-GF-CNC-02", SW["W1-SW-DIST-GF"], "Gi1/0/2",  16, "W1-CNC-02 — CNC milling machine"),
        ("WP-W1-GF-CNC-03", SW["W1-SW-DIST-GF"], "Gi1/0/3",  17, "W1-CNC-03 — CNC milling machine"),
        ("WP-W1-GF-CNC-04", SW["W1-SW-DIST-GF"], "Gi1/0/4",  18, "W1-CNC-04 — CNC milling machine"),
        ("WP-W1-GF-ROB-01", SW["W1-SW-DIST-GF"], "Gi1/0/5",  19, "W1-ROBOT-01 — welding robot arm"),
        ("WP-W1-GF-ROB-02", SW["W1-SW-DIST-GF"], "Gi1/0/6",  20, "W1-ROBOT-02 — welding robot arm"),
        ("WP-W1-GF-ROB-03", SW["W1-SW-DIST-GF"], "Gi1/0/7",  21, "W1-ROBOT-03 — welding robot arm"),
        ("WP-W1-GF-KRC5",   SW["W1-SW-DIST-GF"], "Gi1/0/8",  22, "W1-KRC5-01 — KUKA KRC5 controller"),
        # spare — no switch connection (intentionally unpatched)
        ("WP-W1-GF-SPARE-01", None, None, None, "Spare — unpatched"),
    ]
    for label, sw_id, sw_port, pp_port, desc in gf_assignments:
        if label in port_map:
            updates.append((port_map[label], {"switch_asset_id": sw_id, "switch_port": sw_port,
                                               "patch_port": pp_port, "description": desc}))

    # ── WERK1 FF — office floor via distribution switch ──────────────────────
    ff_assignments = [
        ("WP-W1-FF-IT-01",    SW["W1-SW-DIST-FF"], "Gi1/0/1",  1,  "IT room — server rack drop 1"),
        ("WP-W1-FF-IT-02",    SW["W1-SW-DIST-FF"], "Gi1/0/2",  2,  "IT room — server rack drop 2"),
        ("WP-W1-FF-IT-03",    SW["W1-SW-DIST-FF"], "Gi1/0/3",  3,  "IT room — console/KVM"),
        ("WP-W1-FF-IT-04",    SW["W1-SW-DIST-FF"], "Gi1/0/4",  4,  "IT room — spare patch"),
        ("WP-W1-FF-ENG-01",   SW["W1-SW-DIST-FF"], "Gi1/0/5",  5,  "Engineering — CAD workstation 1"),
        ("WP-W1-FF-ENG-02",   SW["W1-SW-DIST-FF"], "Gi1/0/6",  6,  "Engineering — CAD workstation 2"),
        ("WP-W1-FF-ENG-03",   SW["W1-SW-DIST-FF"], "Gi1/0/7",  7,  "Engineering — CAD workstation 3"),
        ("WP-W1-FF-ENG-04",   SW["W1-SW-DIST-FF"], "Gi1/0/8",  8,  "Engineering — CAD workstation 4"),
        ("WP-W1-FF-ENG-05",   SW["W1-SW-DIST-FF"], "Gi1/0/9",  9,  "Engineering — laptop dock A"),
        ("WP-W1-FF-ENG-06",   SW["W1-SW-DIST-FF"], "Gi1/0/10", 10, "Engineering — laptop dock B"),
        ("WP-W1-FF-MGT-01",   SW["W1-SW-DIST-FF"], "Gi1/0/11", 11, "Management — director desk"),
        ("WP-W1-FF-MGT-02",   SW["W1-SW-DIST-FF"], "Gi1/0/12", 12, "Management — planner desk"),
        ("WP-W1-FF-MGT-03",   SW["W1-SW-DIST-FF"], "Gi1/0/13", 13, "Management — quality lead desk"),
        ("WP-W1-FF-PRN-01",   SW["W1-SW-DIST-FF"], "Gi1/0/14", 14, "Network printer — HP LaserJet"),
        ("WP-W1-FF-CONF-01",  SW["W1-SW-DIST-FF"], "Gi1/0/15", 15, "Conference room — display/codec"),
        ("WP-W1-FF-KVM-01",   SW["W1-SW-DIST-FF"], "Gi1/0/16", 16, "KVM switch — remote management"),
        # spare — intentionally unpatched
        ("WP-W1-FF-SPARE-01", None, None, None, "Spare — reserved for expansion"),
    ]
    for label, sw_id, sw_port, pp_port, desc in ff_assignments:
        if label in port_map:
            updates.append((port_map[label], {"switch_asset_id": sw_id, "switch_port": sw_port,
                                               "patch_port": pp_port, "description": desc}))

    # ── WERK2 GF ─────────────────────────────────────────────────────────────
    w2_assignments = [
        ("WP-W2-GF-STAMP-01", SW["W2-SW-STAMP"], "Gi1/0/1",  1,  "Stamping press #1 — PLC"),
        ("WP-W2-GF-STAMP-02", SW["W2-SW-STAMP"], "Gi1/0/2",  2,  "Stamping press #2 — PLC"),
        ("WP-W2-GF-STAMP-03", SW["W2-SW-STAMP"], "Gi1/0/3",  3,  "Stamping press #3 — HMI"),
        ("WP-W2-GF-WELD-01",  SW["W2-SW-STAMP"], "Gi1/0/4",  4,  "Welding cell A — robot controller"),
        ("WP-W2-GF-WELD-02",  SW["W2-SW-STAMP"], "Gi1/0/5",  5,  "Welding cell B — robot controller"),
        ("WP-W2-GF-WELD-03",  SW["W2-SW-CORE-01"], "Gi1/0/1",6,  "Welding cell C — vision system"),
        ("WP-W2-GF-WELD-04",  SW["W2-SW-CORE-01"], "Gi1/0/2",7,  "Welding cell D — vision system"),
        ("WP-W2-GF-QLAB-01",  SW["W2-SW-CORE-01"], "Gi1/0/3",8,  "Quality lab — CMM measurement PC"),
        ("WP-W2-GF-QLAB-02",  SW["W2-SW-CORE-01"], "Gi1/0/4",9,  "Quality lab — test bench PC"),
        ("WP-W2-GF-QLAB-03",  SW["W2-SW-CORE-01"], "Gi1/0/5",10, "Quality lab — printer"),
        ("WP-W2-GF-SPARE-01", None, None, None, "Spare — unpatched"),
    ]
    for label, sw_id, sw_port, pp_port, desc in w2_assignments:
        if label in port_map:
            updates.append((port_map[label], {"switch_asset_id": sw_id, "switch_port": sw_port,
                                               "patch_port": pp_port, "description": desc}))

    # ── WERK3 GF ─────────────────────────────────────────────────────────────
    w3_assignments = [
        ("WP-W3-GF-WS-01",   SW["W3-SW-CORE-01"], "Gi1/0/1",  1,  "Warehouse workstation 1 — WMS terminal"),
        ("WP-W3-GF-WS-02",   SW["W3-SW-CORE-01"], "Gi1/0/2",  2,  "Warehouse workstation 2 — WMS terminal"),
        ("WP-W3-GF-WS-03",   SW["W3-SW-CORE-01"], "Gi1/0/3",  3,  "Warehouse workstation 3 — packing"),
        ("WP-W3-GF-SCAN-01", SW["W3-SW-CORE-01"], "Gi1/0/4",  4,  "Barcode scanner station 1"),
        ("WP-W3-GF-SCAN-02", SW["W3-SW-CORE-01"], "Gi1/0/5",  5,  "Barcode scanner station 2"),
        ("WP-W3-GF-SCAN-03", SW["W3-SW-CORE-01"], "Gi1/0/6",  6,  "Barcode scanner station 3"),
        ("WP-W3-GF-SCAN-04", SW["W3-SW-CORE-01"], "Gi1/0/7",  7,  "Barcode scanner station 4"),
        ("WP-W3-GF-SCAN-05", SW["W3-SW-CORE-01"], "Gi1/0/8",  8,  "Barcode scanner station 5"),
        ("WP-W3-GF-SCAN-06", SW["W3-SW-CORE-01"], "Gi1/0/9",  9,  "Barcode scanner station 6"),
        ("WP-W3-GF-TERM-01", SW["W3-SW-CORE-01"], "Gi1/0/10", 10, "Forklift terminal 1"),
        ("WP-W3-GF-TERM-02", SW["W3-SW-CORE-01"], "Gi1/0/11", 11, "Forklift terminal 2"),
        ("WP-W3-GF-TERM-03", SW["W3-SW-CORE-01"], "Gi1/0/12", 12, "Loading dock terminal A"),
        ("WP-W3-GF-TERM-04", SW["W3-SW-CORE-01"], "Gi1/0/13", 13, "Loading dock terminal B"),
        ("WP-W3-GF-RTR",     SW["W3-RTR-01"],     "Gi0/0",    14, "W3-RTR-01 — WAN router drop"),
        ("WP-W3-GF-SPARE-01",None, None, None, "Spare — unpatched"),
    ]
    for label, sw_id, sw_port, pp_port, desc in w3_assignments:
        if label in port_map:
            updates.append((port_map[label], {"switch_asset_id": sw_id, "switch_port": sw_port,
                                               "patch_port": pp_port, "description": desc}))

    for pid, data in updates:
        r = patch(f"/api/network/wall-ports/{pid}", data, token)
        if r:
            ok(f"Updated {[d for l,d in [(x,y) for x,y in port_map.items() if y==pid]][0] if port_map else pid[:8]}")

    print(f"  Patched {len(updates)} existing wall ports")


# ── STEP 2: add new patch panels ──────────────────────────────────────────

def add_patch_panels(token):
    print("\n[2] Adding new patch panels...")
    new_panels = {}

    specs = [
        # (key, rack_key, name, u_pos, port_count, cable_type, desc)
        ("PP-W1-CORE-CU-2",  "RACK-W1-CORE",  "PP-W1-CORE-CU-2",  2,  24, "copper",
         "Core rack copper panel 2 — distribution switch uplinks"),
        ("PP-W1-MGMT",       "RACK-W1-CORE",  "PP-W1-MGMT",        3,  24, "copper",
         "Management/IPMI panel — out-of-band management network"),
        ("PP-W1-SRV-2",      "RACK-W1-SRV",   "PP-W1-SRV-2",       2,  24, "copper",
         "Server rack panel 2 — additional server/storage drops"),
        ("PP-W1-GF-PROD-2",  "RACK-W1-GF-01", "PP-W1-GF-PROD-2",   5,  24, "copper",
         "GF IDF copper panel 2 — additional production area drops"),
        ("PP-W1-FF-OFFICE-2","RACK-W1-FF-01", "PP-W1-FF-OFFICE-2", 5,  24, "copper",
         "FF IDF copper panel 2 — additional office/meeting room drops"),
        ("PP-W2-MFG-2",      "RACK-W2-CORE",  "PP-W2-MFG-2",       5,  24, "copper",
         "WERK2 copper panel 2 — additional manufacturing drops"),
        ("PP-W3-WH-2",       "RACK-W3-CORE",  "PP-W3-WH-2",        5,  24, "copper",
         "WERK3 copper panel 2 — additional warehouse drops"),
    ]

    for key, rack_key, name, u_pos, port_count, cable_type, desc in specs:
        r = post("/api/network/patch-panels", {
            "rack_id": RACK[rack_key],
            "name": name,
            "u_position": u_pos,
            "port_count": port_count,
            "cable_type": cable_type,
            "description": desc,
        }, token)
        if r and r.get("data"):
            new_panels[key] = r["data"]["_id"]
            ok(f"{name} (u={u_pos}, {port_count}p {cable_type}) in {rack_key}")
        else:
            print(f"  SKIP {name}")

    return new_panels


# ── STEP 3: add new wall ports ────────────────────────────────────────────

def add_wall_ports(token, new_pp):
    print("\n[3] Adding new wall ports...")
    created = 0

    def wp(label, floor_key, x, y, pp_key, pp_port, sw_key, sw_port, desc):
        nonlocal created
        data = {
            "label": label,
            "floor_id": FLOOR[floor_key],
            "pos_x": x,
            "pos_y": y,
            "patch_panel_id": (new_pp if isinstance(new_pp, dict) else PP).get(pp_key) or PP.get(pp_key),
            "patch_port": pp_port,
            "switch_asset_id": SW.get(sw_key) if sw_key else None,
            "switch_port": sw_port,
            "description": desc,
        }
        r = post("/api/network/wall-ports", data, token)
        if r and r.get("data"):
            created += 1
        else:
            print(f"    FAIL {label}")

    # ── WERK1 Basement — PP-W1-CORE-CU-2 (core rack, extra uplinks) ──────────
    # Positions near server room cluster (east side)
    for i, (sw_asset, sw_p, x, y, desc) in enumerate([
        ("W1-SW-CORE-01", "Te1/1/1",  240, 80,  "Core switch 10G uplink to W2 campus fiber 1"),
        ("W1-SW-CORE-01", "Te1/1/2",  240, 95,  "Core switch 10G uplink to W2 campus fiber 2"),
        ("W1-SW-CORE-01", "Te1/1/3",  240, 110, "Core switch 10G uplink to W3 campus fiber"),
        ("W1-SW-CORE-01", "Gi1/0/9",  240, 125, "W1-SW-ACC-ALA — access switch uplink"),
        ("W1-SW-CORE-01", "Gi1/0/10", 240, 140, "W1-SW-ACC-ALB — access switch uplink"),
        ("W1-SW-CORE-01", "Gi1/0/11", 240, 155, "W1-SW-ACC-ALC — access switch uplink"),
        ("W1-FW-01",      "Gi0/0",    260, 80,  "W1-FW-01 WAN interface"),
        ("W1-FW-01",      "Gi0/1",    260, 95,  "W1-FW-01 DMZ interface"),
        ("W1-RTR-01",     "Gi0/1",    260, 110, "W1-RTR-01 LAN interface"),
        ("W1-RTR-01",     "Gi0/2",    260, 125, "W1-RTR-01 management"),
    ], 1):
        wp(f"WP-W1-BAS-CU2-{i:02d}", "W1-BAS", x, y,
           "PP-W1-CORE-CU-2", i, sw_asset, sw_p, desc)

    # ── WERK1 Basement — PP-W1-MGMT (IPMI/management network) ────────────────
    for i, (sw_asset, sw_p, x, y, desc) in enumerate([
        ("W1-SW-CORE-01", "Gi2/0/1",  280, 80,  "W1-SRV-01 — IPMI out-of-band mgmt"),
        ("W1-SW-CORE-01", "Gi2/0/2",  280, 95,  "W1-SRV-02 — IPMI out-of-band mgmt"),
        ("W1-SW-CORE-01", "Gi2/0/3",  280, 110, "W1-SRV-03 MES — IPMI out-of-band mgmt"),
        ("W1-SW-CORE-01", "Gi2/0/4",  280, 125, "W1-NAS-01 — management port"),
        ("W1-SW-CORE-01", "Gi2/0/5",  280, 140, "W1-RTR-01 — OOB management"),
        ("W1-SW-CORE-01", "Gi2/0/6",  280, 155, "W1-FW-01 — OOB management"),
        (None,            None,        300, 80,  "Spare IPMI port — reserved"),
        (None,            None,        300, 95,  "Spare IPMI port — reserved"),
    ], 1):
        wp(f"WP-W1-BAS-MGMT-{i:02d}", "W1-BAS", x, y,
           "PP-W1-MGMT", i, sw_asset, sw_p, desc)

    # ── WERK1 Basement — PP-W1-SRV-2 (server rack panel 2) ───────────────────
    for i, (sw_asset, sw_p, x, y, desc) in enumerate([
        ("W1-SW-CORE-01", "Gi1/0/12", 200, 175, "W1-SRV-01 — 2nd NIC (redundant)"),
        ("W1-SW-CORE-01", "Gi1/0/13", 200, 190, "W1-SRV-02 — 2nd NIC (redundant)"),
        ("W1-SW-CORE-01", "Gi1/0/14", 200, 205, "W1-SRV-03 MES — 2nd NIC (redundant)"),
        ("W1-SW-CORE-01", "Gi1/0/15", 200, 220, "W1-NAS-01 — 2nd NIC (redundant)"),
        (None,            None,        220, 175, "Spare server drop — unpatched"),
        (None,            None,        220, 190, "Spare server drop — unpatched"),
    ], 1):
        wp(f"WP-W1-BAS-SRV2-{i:02d}", "W1-BAS", x, y,
           "PP-W1-SRV-2", i, sw_asset, sw_p, desc)

    ok(f"Added WERK1 Basement new ports")

    # ── WERK1 Ground Floor — PP-W1-GF-PROD-2 (second production panel) ───────
    # Positions spread around production hall (further east/south)
    gf2_drops = [
        # ALC line — full (only 2 existing, add more)
        ("W1-SW-ACC-ALC", "Gi1/0/3",  440, 155, "W1-PLC-ALC-03 — PLC station C3"),
        ("W1-SW-ACC-ALC", "Gi1/0/4",  440, 170, "W1-HMI-ALA-03 — HMI panel C"),
        ("W1-SW-ACC-ALC", "Gi1/0/5",  440, 185, "W1-PLC-ALC-extra — spare PLC"),
        # CNC overflow
        ("W1-SW-DIST-GF", "Gi1/0/9",  380, 200, "W1-CNC-extra — 5th CNC position"),
        ("W1-SW-DIST-GF", "Gi1/0/10", 380, 215, "Robot teach pendant drop"),
        ("W1-SW-DIST-GF", "Gi1/0/11", 380, 230, "Robot safety controller drop"),
        # Vision/camera drops
        ("W1-SW-DIST-GF", "Gi1/0/12", 340, 200, "Vision system camera 1"),
        ("W1-SW-DIST-GF", "Gi1/0/13", 340, 215, "Vision system camera 2"),
        # AP/infrastructure
        ("W1-SW-DIST-GF", "Gi1/0/14", 300, 245, "W1-AP-GF-01 — WiFi access point 1"),
        ("W1-SW-DIST-GF", "Gi1/0/15", 360, 245, "W1-AP-GF-02 — WiFi access point 2"),
        # CCTV/surveillance
        ("W1-SW-DIST-GF", "Gi1/0/16", 300, 260, "W1-CAM-GF-01 — CCTV camera 1"),
        ("W1-SW-DIST-GF", "Gi1/0/17", 340, 260, "W1-CAM-GF-02 — CCTV camera 2"),
        # Spares
        (None,            None,        420, 245, "Spare — unpatched production drop"),
        (None,            None,        420, 260, "Spare — unpatched production drop"),
    ]
    for i, (sw_asset, sw_p, x, y, desc) in enumerate(gf2_drops, 1):
        wp(f"WP-W1-GF-P2-{i:02d}", "W1-GF", x, y,
           "PP-W1-GF-PROD-2", i, sw_asset, sw_p, desc)

    ok(f"Added WERK1 Ground Floor new ports")

    # ── WERK1 First Floor — PP-W1-FF-OFFICE-2 (second office panel) ──────────
    ff2_drops = [
        # HR/Finance wing
        ("W1-SW-DIST-FF", "Gi1/0/17", 160, 130, "HR office — desk 1"),
        ("W1-SW-DIST-FF", "Gi1/0/18", 160, 145, "HR office — desk 2"),
        ("W1-SW-DIST-FF", "Gi1/0/19", 180, 130, "Finance office — desk 1"),
        ("W1-SW-DIST-FF", "Gi1/0/20", 180, 145, "Finance office — desk 2"),
        # Meeting rooms
        ("W1-SW-DIST-FF", "Gi1/0/21", 200, 155, "Meeting room A — desk/VC"),
        ("W1-SW-DIST-FF", "Gi1/0/22", 220, 155, "Meeting room B — desk/VC"),
        # Reception / lobby
        ("W1-SW-DIST-FF", "Gi1/0/23", 140, 85,  "Reception desk — front office"),
        ("W1-SW-DIST-FF", "Gi1/0/24", 140, 100, "Reception — badge printer"),
        # WiFi APs
        ("W1-SW-DIST-FF", "Gi1/0/25", 180, 80,  "W1-AP-FF-01 — WiFi access point"),
        ("W1-SW-DIST-FF", "Gi1/0/26", 220, 80,  "W1-AP-FF-02 — WiFi access point"),
        # IP cameras
        ("W1-SW-DIST-FF", "Gi1/0/27", 160, 165, "W1-CAM-FF-01 — CCTV camera"),
        ("W1-SW-DIST-FF", "Gi1/0/28", 200, 165, "W1-CAM-FF-02 — CCTV camera"),
        # Spares
        (None,            None,        240, 140, "Spare — unpatched office drop"),
        (None,            None,        240, 155, "Spare — unpatched office drop"),
    ]
    for i, (sw_asset, sw_p, x, y, desc) in enumerate(ff2_drops, 1):
        wp(f"WP-W1-FF-P2-{i:02d}", "W1-FF", x, y,
           "PP-W1-FF-OFFICE-2", i, sw_asset, sw_p, desc)

    ok(f"Added WERK1 First Floor new ports")

    # ── WERK2 GF — PP-W2-MFG-2 (second manufacturing panel) ─────────────────
    w2_drops = [
        ("W2-SW-CORE-01", "Gi1/0/6",  340, 140, "Assembly station A — workstation"),
        ("W2-SW-CORE-01", "Gi1/0/7",  340, 155, "Assembly station B — workstation"),
        ("W2-SW-CORE-01", "Gi1/0/8",  340, 170, "Assembly station C — barcode scanner"),
        ("W2-SW-CORE-01", "Gi1/0/9",  380, 140, "Conveyor control — SCADA PC"),
        ("W2-SW-CORE-01", "Gi1/0/10", 380, 155, "Conveyor control — PLC drop"),
        ("W2-SW-CORE-01", "Gi1/0/11", 380, 170, "Warehouse office — manager PC"),
        ("W2-SW-CORE-01", "Gi1/0/12", 420, 140, "W2-RTR-01 — WAN router drop"),
        ("W2-SW-CORE-01", "Gi1/0/13", 420, 155, "W2-AP-01 — WiFi access point"),
        ("W2-SW-CORE-01", "Gi1/0/14", 420, 170, "W2-CAM-01 — CCTV camera"),
        (None,            None,        460, 140, "Spare — unpatched"),
        (None,            None,        460, 155, "Spare — unpatched"),
    ]
    for i, (sw_asset, sw_p, x, y, desc) in enumerate(w2_drops, 1):
        wp(f"WP-W2-GF-P2-{i:02d}", "W2-GF", x, y,
           "PP-W2-MFG-2", i, sw_asset, sw_p, desc)

    ok(f"Added WERK2 Ground Floor new ports")

    # ── WERK3 GF — PP-W3-WH-2 (second warehouse panel) ───────────────────────
    w3_drops = [
        ("W3-SW-CORE-01", "Gi1/0/15", 260, 160, "High-bay scanner — zone 4"),
        ("W3-SW-CORE-01", "Gi1/0/16", 260, 175, "High-bay scanner — zone 5"),
        ("W3-SW-CORE-01", "Gi1/0/17", 300, 160, "Forklift charging station — dock"),
        ("W3-SW-CORE-01", "Gi1/0/18", 300, 175, "Goods receipt terminal"),
        ("W3-SW-CORE-01", "Gi1/0/19", 300, 190, "Dispatch terminal"),
        ("W3-SW-CORE-01", "Gi1/0/20", 340, 160, "W3-AP-01 — WiFi for forklifts"),
        ("W3-SW-CORE-01", "Gi1/0/21", 340, 175, "W3-AP-02 — WiFi high-bay"),
        ("W3-SW-CORE-01", "Gi1/0/22", 340, 190, "W3-CAM-01 — CCTV entry gate"),
        (None,            None,        380, 160, "Spare — unpatched"),
        (None,            None,        380, 175, "Spare — unpatched"),
    ]
    for i, (sw_asset, sw_p, x, y, desc) in enumerate(w3_drops, 1):
        wp(f"WP-W3-GF-P2-{i:02d}", "W3-GF", x, y,
           "PP-W3-WH-2", i, sw_asset, sw_p, desc)

    ok(f"Added WERK3 Ground Floor new ports")
    print(f"  Created {created} new wall ports")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print("Logging in...")
    token = login()
    print(f"  Token: {token[:30]}...")

    patch_existing_ports(token)
    new_pp = add_patch_panels(token)
    add_wall_ports(token, new_pp)

    # Final summary
    print("\n=== Final state ===")
    rooms    = get_all("/api/network/rooms", token)
    racks    = get_all("/api/network/racks", token)
    panels   = get_all("/api/network/patch-panels", token)
    ports    = get_all("/api/network/wall-ports", token)
    patched  = sum(1 for p in ports if p.get("patch_panel_id"))
    sw_linked = sum(1 for p in ports if p.get("switch_asset_id"))

    print(f"  Rooms:         {len(rooms)}")
    print(f"  Racks:         {len(racks)}")
    print(f"  Patch panels:  {len(panels)}")
    print(f"  Wall ports:    {len(ports)}")
    print(f"  Patched:       {patched}  ({100*patched//len(ports)}%)")
    print(f"  Switch-linked: {sw_linked}  ({100*sw_linked//len(ports)}%)")
    print(f"  Spare/unpatched: {len(ports)-patched}")
    print("\nDone.")

main()
