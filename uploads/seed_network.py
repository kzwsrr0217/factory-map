"""
Seed network infrastructure for Factory Map — WERK campus layout.
Creates: MDF/IDF rooms, racks, patch panels, and wall ports
mapped to existing WERK1/2/3 buildings and their floors/assets.

Network topology:
  WERK1 Basement (MDF-W1) ←─fiber─→ WERK2 GF (MDF-W2)  [campus backbone]
  WERK1 Basement (MDF-W1) ←─fiber─→ WERK3 GF (MDF-W3)  [campus backbone]
  MDF-W1 ←─fiber riser─→ IDF-W1-GF  (WERK1 Ground Floor production)
  MDF-W1 ←─fiber riser─→ IDF-W1-FF  (WERK1 First Floor offices)
  IDF-W1-GF ──copper──→ wall ports   (PLCs, IPCs, HMIs, CNCs)
  IDF-W1-FF ──copper──→ wall ports   (workstations, printers)
  MDF-W2    ──copper──→ wall ports   (WERK2 manufacturing floor)
  MDF-W3    ──copper──→ wall ports   (WERK3 warehouse scanners/terminals)
"""
import json, urllib.request

API = "http://localhost:4000/api"

def http(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{API}{path}", data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())

get   = lambda path, tok:       http("GET",   path, None,  tok)
post  = lambda path, body, tok: http("POST",  path, body,  tok)
patch = lambda path, body, tok: http("PATCH", path, body,  tok)

# ── Auth ──────────────────────────────────────────────────────────────────────
print("Logging in…")
r = post("/auth/login", {"username": "admin", "password": "Admin@1234"}, None)
token = r.get("token") or r.get("data", {}).get("token")
assert token, "Login failed"

# ── Discover existing buildings / floors ──────────────────────────────────────
print("Fetching buildings and floors…")
buildings = get("/buildings", token)["data"]
floors    = get("/floors",    token)["data"]

def building(kw):
    for b in buildings:
        if kw.lower() in b["name"].lower(): return b
    raise ValueError(f"Building not found: {kw}")

def floor_of(bid, kw):
    for f in floors:
        if f["building_id"] == bid and kw.lower() in f["name"].lower(): return f
    raise ValueError(f"Floor '{kw}' not found in building {bid}")

w1 = building("WERK1")
w2 = building("WERK2")
w3 = building("WERK3")

w1_bas = floor_of(w1["_id"], "Basement")    # -1  Server Room
w1_gf  = floor_of(w1["_id"], "Ground")      #  0  Production
w1_ff  = floor_of(w1["_id"], "First")       #  1  Offices
w2_gf  = floor_of(w2["_id"], "Ground")      #  0  Manufacturing
w3_gf  = floor_of(w3["_id"], "Ground")      #  0  Warehouse

print(f"  WERK1 [{w1['_id'][:6]}]: Basement={w1_bas['_id'][:6]} GF={w1_gf['_id'][:6]} FF={w1_ff['_id'][:6]}")
print(f"  WERK2 [{w2['_id'][:6]}]: GF={w2_gf['_id'][:6]}")
print(f"  WERK3 [{w3['_id'][:6]}]: GF={w3_gf['_id'][:6]}")

# ── Network Rooms ─────────────────────────────────────────────────────────────
print("\nCreating network rooms…")

mdf_w1 = post("/network/rooms", {
    "name": "MDF-W1",
    "type": "mdf",
    "building_id": w1["_id"],
    "floor_id": w1_bas["_id"],
    "description": "Main Distribution Frame — WERK1 Basement Server Room. "
                   "Campus core: firewall, core switch, servers, UPS.",
}, token)["data"]

idf_w1_gf = post("/network/rooms", {
    "name": "IDF-W1-GF",
    "type": "idf",
    "building_id": w1["_id"],
    "floor_id": w1_gf["_id"],
    "description": "IDF closet on WERK1 Ground Floor — serves Assembly Line A/B, CNC, and robot cells.",
}, token)["data"]

idf_w1_ff = post("/network/rooms", {
    "name": "IDF-W1-FF",
    "type": "idf",
    "building_id": w1["_id"],
    "floor_id": w1_ff["_id"],
    "description": "IDF closet on WERK1 First Floor — serves IT/Engineering/Management offices.",
}, token)["data"]

mdf_w2 = post("/network/rooms", {
    "name": "MDF-W2",
    "type": "mdf",
    "building_id": w2["_id"],
    "floor_id": w2_gf["_id"],
    "description": "MDF for WERK2 — Component Manufacturing. "
                   "Core switch W2-SW-CORE-01 and uplink to WERK1 MDF via campus fiber.",
    "redundant_pair_id": mdf_w1["_id"],
}, token)["data"]

patch(f"/network/rooms/{mdf_w1['_id']}", {"redundant_pair_id": mdf_w2["_id"]}, token)

mdf_w3 = post("/network/rooms", {
    "name": "MDF-W3",
    "type": "mdf",
    "building_id": w3["_id"],
    "floor_id": w3_gf["_id"],
    "description": "MDF for WERK3 — Warehouse & Logistics. "
                   "Core switch W3-SW-CORE-01; uplink to WERK1 via campus fiber.",
}, token)["data"]

print(f"  Created: MDF-W1, IDF-W1-GF, IDF-W1-FF, MDF-W2, MDF-W3")

# ── Racks ─────────────────────────────────────────────────────────────────────
print("Creating racks…")

# MDF-W1 (Basement) — two racks: core + distribution
rack_mdf_w1_core = post("/network/racks", {
    "name": "RACK-W1-CORE",
    "network_room_id": mdf_w1["_id"],
    "u_count": 42,
    "description": "Core rack: W1-RTR-01, W1-FW-01, W1-SW-CORE-01, W1-UPS-01",
}, token)["data"]

rack_mdf_w1_srv = post("/network/racks", {
    "name": "RACK-W1-SRV",
    "network_room_id": mdf_w1["_id"],
    "u_count": 42,
    "description": "Server rack: W1-SRV-01/02/03, W1-NAS-01, W1-UPS-02",
}, token)["data"]

rack_mdf_w1_fiber = post("/network/racks", {
    "name": "RACK-W1-FIBER",
    "network_room_id": mdf_w1["_id"],
    "u_count": 12,
    "description": "Fiber termination rack: campus backbone + riser fiber panels",
}, token)["data"]

# IDF-W1-GF — one floor distribution rack
rack_idf_gf = post("/network/racks", {
    "name": "RACK-W1-GF-01",
    "network_room_id": idf_w1_gf["_id"],
    "u_count": 12,
    "description": "Production floor distribution: W1-SW-ACC-ALA/ALB/ALC + patch panels",
}, token)["data"]

# IDF-W1-FF — one office distribution rack
rack_idf_ff = post("/network/racks", {
    "name": "RACK-W1-FF-01",
    "network_room_id": idf_w1_ff["_id"],
    "u_count": 12,
    "description": "Office floor distribution: W1-SW-DIST-FF + patch panels",
}, token)["data"]

# MDF-W2 — single rack
rack_mdf_w2 = post("/network/racks", {
    "name": "RACK-W2-CORE",
    "network_room_id": mdf_w2["_id"],
    "u_count": 24,
    "description": "WERK2 core rack: W2-RTR-01, W2-SW-CORE-01, W2-SW-STAMP",
}, token)["data"]

# MDF-W3 — single rack
rack_mdf_w3 = post("/network/racks", {
    "name": "RACK-W3-CORE",
    "network_room_id": mdf_w3["_id"],
    "u_count": 12,
    "description": "WERK3 core rack: W3-RTR-01, W3-SW-CORE-01",
}, token)["data"]

print(f"  Created 7 racks")

# ── Patch Panels ──────────────────────────────────────────────────────────────
print("Creating patch panels…")

# RACK-W1-CORE: server-side copper + inter-IDF uplinks
pp_w1_core_copper = post("/network/patch-panels", {
    "name": "PP-W1-CORE-CU",
    "rack_id": rack_mdf_w1_core["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "Core copper panel — core switch uplinks to distribution racks",
}, token)["data"]

# RACK-W1-SRV: server room drops
pp_w1_srv = post("/network/patch-panels", {
    "name": "PP-W1-SRV",
    "rack_id": rack_mdf_w1_srv["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "Server room copper panel — drops to servers, NAS, router, firewall",
}, token)["data"]

# RACK-W1-FIBER: campus backbone + riser panels
pp_w1_campus_fiber = post("/network/patch-panels", {
    "name": "PP-W1-CAMPUS",
    "rack_id": rack_mdf_w1_fiber["_id"],
    "u_position": 1,
    "port_count": 12,
    "cable_type": "fiber",
    "description": "Campus backbone fiber — LC duplex, ports 1-4 to WERK2, 5-8 to WERK3",
}, token)["data"]

pp_w1_riser_gf = post("/network/patch-panels", {
    "name": "PP-W1-RISER-GF",
    "rack_id": rack_mdf_w1_fiber["_id"],
    "u_position": 3,
    "port_count": 6,
    "cable_type": "fiber",
    "description": "Fiber riser to IDF-W1-GF (production floor closet)",
}, token)["data"]

pp_w1_riser_ff = post("/network/patch-panels", {
    "name": "PP-W1-RISER-FF",
    "rack_id": rack_mdf_w1_fiber["_id"],
    "u_position": 5,
    "port_count": 6,
    "cable_type": "fiber",
    "description": "Fiber riser to IDF-W1-FF (office floor closet)",
}, token)["data"]

# IDF-W1-GF: production floor drops + fiber uplink
pp_w1_gf_prod = post("/network/patch-panels", {
    "name": "PP-W1-GF-PROD",
    "rack_id": rack_idf_gf["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "WERK1 Ground Floor drops — PLCs, IPCs, HMIs, CNC, robots",
}, token)["data"]

pp_w1_gf_fiber = post("/network/patch-panels", {
    "name": "PP-W1-GF-FIBER",
    "rack_id": rack_idf_gf["_id"],
    "u_position": 3,
    "port_count": 6,
    "cable_type": "fiber",
    "description": "Fiber uplink to MDF-W1 Basement (RACK-W1-FIBER port 1-2)",
}, token)["data"]

# IDF-W1-FF: office drops + fiber uplink
pp_w1_ff_office = post("/network/patch-panels", {
    "name": "PP-W1-FF-OFFICE",
    "rack_id": rack_idf_ff["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "WERK1 First Floor drops — IT desks, engineering workstations, management",
}, token)["data"]

pp_w1_ff_fiber = post("/network/patch-panels", {
    "name": "PP-W1-FF-FIBER",
    "rack_id": rack_idf_ff["_id"],
    "u_position": 3,
    "port_count": 6,
    "cable_type": "fiber",
    "description": "Fiber uplink to MDF-W1 Basement (RACK-W1-FIBER port 3-4)",
}, token)["data"]

# MDF-W2: manufacturing floor drops + campus fiber
pp_w2_mfg = post("/network/patch-panels", {
    "name": "PP-W2-MFG",
    "rack_id": rack_mdf_w2["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "WERK2 manufacturing drops — stamping PLCs, welding robots, Q-lab",
}, token)["data"]

pp_w2_fiber = post("/network/patch-panels", {
    "name": "PP-W2-FIBER",
    "rack_id": rack_mdf_w2["_id"],
    "u_position": 3,
    "port_count": 12,
    "cable_type": "fiber",
    "description": "Campus fiber uplink to MDF-W1 + riser to W2 First Floor",
}, token)["data"]

# MDF-W3: warehouse drops + campus fiber
pp_w3_wh = post("/network/patch-panels", {
    "name": "PP-W3-WH",
    "rack_id": rack_mdf_w3["_id"],
    "u_position": 1,
    "port_count": 24,
    "cable_type": "copper",
    "description": "WERK3 Warehouse drops — scanners, terminals, workstations",
}, token)["data"]

pp_w3_fiber = post("/network/patch-panels", {
    "name": "PP-W3-FIBER",
    "rack_id": rack_mdf_w3["_id"],
    "u_position": 3,
    "port_count": 6,
    "cable_type": "fiber",
    "description": "Campus fiber uplink to MDF-W1",
}, token)["data"]

print(f"  Created 13 patch panels")

# ── Wall Ports ────────────────────────────────────────────────────────────────
# Positions are placed near existing asset coordinates:
#
# WERK1 Ground Floor (w1_gf):
#   ALA PLCs: (170,130) (260,130) (350,130) (440,130)
#   ALA IPCs: (200,170) (310,170) (420,170)
#   ALB PLCs: (170,380) (260,380) (350,380)
#   ALB IPCs: (220,420) (340,420)
#   ALC PLCs: (170,630) (260,630) (350,630)
#   CNC:      (580,180) (650,180) (720,180) (790,180)
#   Robots:   (920,150) (1000,150) (1080,150)
#   Switches: (480,100) (480,350) (480,600)
#
# WERK1 Basement (w1_bas):
#   Router:  (100,100)  Servers: (180,100) (180,150) (280,100)
#   NAS:     (280,150)  Firewall:(100,160) Core-SW: (100,220)
#
# WERK1 First Floor (w1_ff):
#   IT WS:   (140,150) (200,150) (260,150) (320,150)
#   ENG WS:  (480,150) (530,150) (580,150) (630,150) (680,150) (730,150)
#   MGT WS:  (150,350) (220,350) (290,350)
#
# WERK2 Ground Floor (w2_gf):
#   Stamp PLCs/HMI: (160,130) (240,130) (320,130) + HMI (160,180) (240,180)
#   Weld PLCs:      (490,130) (560,130) (630,130) (700,130)
#   Q-Lab WS:       (150,360) (220,360) (290,360)
#
# WERK3 Ground Floor (w3_gf):
#   Scanners: (200,120) (300,120) (400,120) (500,70) (600,70) (700,70)
#   Terminals:(240,400) (380,400) (520,400) (660,400)
#   WS:       (180,100) (260,100) (340,70)

print("Creating wall ports…")
total_wp = 0

def wp_batch(floor_id, patch_panel_id, entries):
    """entries: list of (label, x, y, port_or_None, sw_port_or_None, description)"""
    global total_wp
    for label, x, y, port, sw_port, desc in entries:
        post("/network/wall-ports", {
            "label": label,
            "floor_id": floor_id,
            "pos_x": x,
            "pos_y": y,
            "patch_panel_id": patch_panel_id,
            "patch_port": port,
            "switch_port": sw_port,
            "description": desc,
        }, token)
        total_wp += 1

# ── WERK1 Basement — Server Room drops (pp_w1_srv) ────────────────────────────
wp_batch(w1_bas["_id"], pp_w1_srv["_id"], [
    ("WP-W1-BAS-01", 80,  80,  1,  "Gi1/0/1",  "W1-RTR-01 — core router"),
    ("WP-W1-BAS-02", 80,  140, 2,  "Gi1/0/2",  "W1-FW-01 — perimeter firewall"),
    ("WP-W1-BAS-03", 160, 80,  3,  "Gi1/0/3",  "W1-SRV-01 — application server"),
    ("WP-W1-BAS-04", 160, 130, 4,  "Gi1/0/4",  "W1-SRV-02 — application server"),
    ("WP-W1-BAS-05", 260, 80,  5,  "Gi1/0/5",  "W1-SRV-03 (MES) — MES server"),
    ("WP-W1-BAS-06", 260, 130, 6,  "Gi1/0/6",  "W1-NAS-01 — NAS storage"),
    ("WP-W1-BAS-07", 80,  200, 7,  "Gi1/0/7",  "W1-SW-CORE-01 — core switch mgmt"),
    ("WP-W1-BAS-08", 490, 60,  8,  "Gi1/0/8",  "W1-UPS-02 — UPS mgmt port"),
])

# ── WERK1 Ground Floor — Production drops (pp_w1_gf_prod) ─────────────────────
wp_batch(w1_gf["_id"], pp_w1_gf_prod["_id"], [
    # Assembly Line A — PLCs
    ("WP-W1-GF-ALA-01", 150, 108, 1,  "Gi0/1",  "W1-PLC-ALA-01 — Line A PLC 1"),
    ("WP-W1-GF-ALA-02", 240, 108, 2,  "Gi0/2",  "W1-PLC-ALA-02 — Line A PLC 2"),
    ("WP-W1-GF-ALA-03", 330, 108, 3,  "Gi0/3",  "W1-PLC-ALA-03 — Line A PLC 3"),
    ("WP-W1-GF-ALA-04", 420, 108, 4,  "Gi0/4",  "W1-PLC-ALA-04 — Line A PLC 4"),
    # Assembly Line A — IPCs/HMIs
    ("WP-W1-GF-ALA-05", 180, 190, 5,  "Gi0/5",  "W1-IPC-ALA-01 + W1-HMI-ALA-01"),
    ("WP-W1-GF-ALA-06", 290, 190, 6,  "Gi0/6",  "W1-IPC-ALA-02 + W1-HMI-ALA-02"),
    ("WP-W1-GF-ALA-07", 400, 190, 7,  "Gi0/7",  "W1-IPC-ALA-03 + W1-HMI-ALA-03"),
    # Assembly Line B — PLCs
    ("WP-W1-GF-ALB-01", 150, 358, 8,  "Gi0/8",  "W1-PLC-ALB-01 — Line B PLC 1"),
    ("WP-W1-GF-ALB-02", 240, 358, 9,  "Gi0/9",  "W1-PLC-ALB-02 — Line B PLC 2"),
    ("WP-W1-GF-ALB-03", 330, 358, 10, "Gi0/10", "W1-PLC-ALB-03 — Line B PLC 3"),
    # Assembly Line B — IPCs
    ("WP-W1-GF-ALB-04", 200, 440, 11, "Gi0/11", "W1-IPC-ALB-01 — Line B IPC 1"),
    ("WP-W1-GF-ALB-05", 320, 440, 12, "Gi0/12", "W1-IPC-ALB-02 — Line B IPC 2"),
    # Assembly Line C — PLCs (unpatched spares for now)
    ("WP-W1-GF-ALC-01", 150, 608, None, None,   "W1-PLC-ALC-01 area — spare"),
    ("WP-W1-GF-ALC-02", 240, 608, None, None,   "W1-PLC-ALC-02 area — spare"),
    # CNC area
    ("WP-W1-GF-CNC-01", 558, 158, 13, "Gi0/13", "W1-CNC-01"),
    ("WP-W1-GF-CNC-02", 628, 158, 14, "Gi0/14", "W1-CNC-02"),
    ("WP-W1-GF-CNC-03", 698, 158, 15, "Gi0/15", "W1-CNC-03"),
    ("WP-W1-GF-CNC-04", 768, 158, 16, "Gi0/16", "W1-CNC-04"),
    # Robot cell
    ("WP-W1-GF-ROB-01",  898, 128, 17, "Gi0/17", "W1-ROBOT-01 pendant drop"),
    ("WP-W1-GF-ROB-02",  978, 128, 18, "Gi0/18", "W1-ROBOT-02 pendant drop"),
    ("WP-W1-GF-ROB-03", 1058, 128, 19, "Gi0/19", "W1-ROBOT-03 pendant drop"),
    # KRC5 controller
    ("WP-W1-GF-KRC5",    908, 258, 20, "Gi0/20", "W1-KRC5-01 — robot controller"),
    # Spare east wall
    ("WP-W1-GF-SPARE-01", 850, 450, None, None, "Spare — east wall"),
])

# ── WERK1 First Floor — Office drops (pp_w1_ff_office) ────────────────────────
wp_batch(w1_ff["_id"], pp_w1_ff_office["_id"], [
    # IT desks
    ("WP-W1-FF-IT-01", 118, 168, 1,  "Gi0/1",  "W1-WS-IT-01"),
    ("WP-W1-FF-IT-02", 178, 168, 2,  "Gi0/2",  "W1-WS-IT-02"),
    ("WP-W1-FF-IT-03", 238, 168, 3,  "Gi0/3",  "W1-WS-IT-03"),
    ("WP-W1-FF-IT-04", 298, 168, 4,  "Gi0/4",  "W1-WS-IT-04"),
    # Engineering open-plan
    ("WP-W1-FF-ENG-01", 458, 168, 5,  "Gi0/5",  "W1-WS-ENG-01"),
    ("WP-W1-FF-ENG-02", 508, 168, 6,  "Gi0/6",  "W1-WS-ENG-02"),
    ("WP-W1-FF-ENG-03", 558, 168, 7,  "Gi0/7",  "W1-WS-ENG-03"),
    ("WP-W1-FF-ENG-04", 608, 168, 8,  "Gi0/8",  "W1-WS-ENG-04"),
    ("WP-W1-FF-ENG-05", 658, 168, 9,  "Gi0/9",  "W1-WS-ENG-05"),
    ("WP-W1-FF-ENG-06", 708, 168, 10, "Gi0/10", "W1-WS-ENG-06"),
    # Management cluster
    ("WP-W1-FF-MGT-01", 128, 368, 11, "Gi0/11", "W1-WS-MGT-01"),
    ("WP-W1-FF-MGT-02", 198, 368, 12, "Gi0/12", "W1-WS-MGT-02"),
    ("WP-W1-FF-MGT-03", 268, 368, 13, "Gi0/13", "W1-WS-MGT-03"),
    # Printer
    ("WP-W1-FF-PRN-01", 58,  218, 14, "Gi0/14", "W1-PRN-IT-01"),
    # Conference room display
    ("WP-W1-FF-CONF-01", 478, 368, 15, "Gi0/15", "W1-DISP-CONF-01"),
    # KVM / IT rack area
    ("WP-W1-FF-KVM-01",  68, 148, 16, "Gi0/16", "W1-KVM-IT-01"),
    # Spare
    ("WP-W1-FF-SPARE-01", 800, 400, None, None, "Spare — south wall"),
])

# ── WERK2 Ground Floor — Manufacturing drops (pp_w2_mfg) ──────────────────────
wp_batch(w2_gf["_id"], pp_w2_mfg["_id"], [
    # Stamping line
    ("WP-W2-GF-STAMP-01", 138, 148, 1,  "Gi0/1",  "W2-PLC-STAMP-01 + W2-HMI-STAMP-01"),
    ("WP-W2-GF-STAMP-02", 218, 148, 2,  "Gi0/2",  "W2-PLC-STAMP-02 + W2-HMI-STAMP-02"),
    ("WP-W2-GF-STAMP-03", 298, 148, 3,  "Gi0/3",  "W2-PLC-STAMP-03"),
    # Welding cell
    ("WP-W2-GF-WELD-01",  468, 148, 4,  "Gi0/4",  "W2-PLC-WELD-01 + W2-ROBOT-WELD-01"),
    ("WP-W2-GF-WELD-02",  538, 148, 5,  "Gi0/5",  "W2-PLC-WELD-02 + W2-ROBOT-WELD-02"),
    ("WP-W2-GF-WELD-03",  608, 148, 6,  "Gi0/6",  "W2-PLC-WELD-03 + W2-ROBOT-WELD-03"),
    ("WP-W2-GF-WELD-04",  678, 148, 7,  "Gi0/7",  "W2-PLC-WELD-04"),
    # Quality Lab
    ("WP-W2-GF-QLAB-01",  128, 378, 8,  "Gi0/8",  "W2-WS-QLAB-01"),
    ("WP-W2-GF-QLAB-02",  198, 378, 9,  "Gi0/9",  "W2-WS-QLAB-02"),
    ("WP-W2-GF-QLAB-03",  268, 378, 10, "Gi0/10", "W2-WS-QLAB-03"),
    # Spare
    ("WP-W2-GF-SPARE-01", 800, 300, None, None, "Spare — east wall"),
])

# ── WERK3 Ground Floor — Warehouse drops (pp_w3_wh) ───────────────────────────
wp_batch(w3_gf["_id"], pp_w3_wh["_id"], [
    # Receiving workstations
    ("WP-W3-GF-WS-01",   158, 118, 1,  "Gi0/1",  "W3-WS-01"),
    ("WP-W3-GF-WS-02",   238, 118, 2,  "Gi0/2",  "W3-WS-02"),
    ("WP-W3-GF-WS-03",   318,  88, 3,  "Gi0/3",  "W3-WS-03"),
    # Aisle scanners (handheld cradles)
    ("WP-W3-GF-SCAN-01", 178, 138, 4,  "Gi0/4",  "W3-SCAN-01 cradle"),
    ("WP-W3-GF-SCAN-02", 278, 138, 5,  "Gi0/5",  "W3-SCAN-02 cradle"),
    ("WP-W3-GF-SCAN-03", 378, 138, 6,  "Gi0/6",  "W3-SCAN-03 cradle"),
    ("WP-W3-GF-SCAN-04", 478,  88, 7,  "Gi0/7",  "W3-SCAN-04 cradle"),
    ("WP-W3-GF-SCAN-05", 578,  88, 8,  "Gi0/8",  "W3-SCAN-05 cradle"),
    ("WP-W3-GF-SCAN-06", 678,  88, 9,  "Gi0/9",  "W3-SCAN-06 cradle"),
    # Pick terminals
    ("WP-W3-GF-TERM-01", 218, 418, 10, "Gi0/10", "W3-TERM-01 — pick station"),
    ("WP-W3-GF-TERM-02", 358, 418, 11, "Gi0/11", "W3-TERM-02 — pick station"),
    ("WP-W3-GF-TERM-03", 498, 418, 12, "Gi0/12", "W3-TERM-03 — pick station"),
    ("WP-W3-GF-TERM-04", 638, 418, 13, "Gi0/13", "W3-TERM-04 — pick station"),
    # Network room itself
    ("WP-W3-GF-RTR",     878, 118, 14, "Gi0/14", "W3-RTR-01 — warehouse router"),
    # Spare
    ("WP-W3-GF-SPARE-01", 900, 400, None, None, "Spare — loading dock east"),
])

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n✓ Network infrastructure seed complete!")
print(f"  Rooms:        5  (3 MDF + 2 IDF)")
print(f"  Racks:        7")
print(f"  Patch panels: 13  (8 copper + 5 fiber)")
print(f"  Wall ports:   {total_wp}")
print()
print(f"  MDF-W1 ←redundant pair→ MDF-W2")
print(f"  Topology: WERK1 Basement → fiber risers → WERK1 GF + FF IDFs")
print(f"            WERK1 MDF → campus fiber → WERK2 MDF + WERK3 MDF")
print(f"  All floor drops patched to correct panels with switch port labels")
print(f"  Spare/unpatched ports on ALC, east walls, and loading dock")
