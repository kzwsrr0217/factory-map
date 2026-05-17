"""
seed_asset_ports.py — Assign physical wall ports to assets and wire up the
full logical connection topology for the WERK campus.

Run: python uploads/seed_asset_ports.py
Idempotent: wall port assignments overwrite existing; duplicate connections are skipped.
"""

import json, urllib.request, urllib.error

API = "http://localhost:4000/api"


def http(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def safe_post(path, body, token):
    """POST, return None on 400 (duplicate connection) instead of raising."""
    try:
        return http("POST", path, body, token)
    except urllib.error.HTTPError as e:
        if e.code == 400:
            return None
        raise


get   = lambda path, tok:       http("GET",   path, None,  tok)
post  = lambda path, body, tok: http("POST",  path, body,  tok)
patch = lambda path, body, tok: http("PATCH", path, body,  tok)

# ── Auth ──────────────────────────────────────────────────────────────────────
print("Logging in…")
r = post("/auth/login", {"username": "admin", "password": "Admin@1234"}, None)
token = r.get("token") or r.get("data", {}).get("token")
assert token, "Login failed"

# ── Load assets & wall ports ─────────────────────────────────────────────────
print("Loading assets…")
assets = get("/assets?include_connections=true", token)["data"]
by_name = {a["basic_info"]["display_name"]: a for a in assets}
by_id   = {a["_id"]: a for a in assets}
print(f"  {len(assets)} assets")

print("Loading wall ports…")
floors = get("/floors", token)["data"]
all_wps = []
for fl in floors:
    all_wps.extend(get(f"/network/wall-ports?floor_id={fl['_id']}", token)["data"])
wp_by_label = {wp["label"]: wp for wp in all_wps}
print(f"  {len(all_wps)} wall ports across {len(floors)} floors")


# ── Wall port → asset mapping ─────────────────────────────────────────────────
# Each tuple: (asset display_name, wall port label)
# Assets that share a physical drop get the same port label.
WALL_PORT_MAP = [
    # WERK1 Basement — MDF server room drops
    ("W1-RTR-01",          "WP-W1-BAS-01"),
    ("W1-FW-01",           "WP-W1-BAS-02"),
    ("W1-SRV-01",          "WP-W1-BAS-03"),
    ("W1-SRV-02",          "WP-W1-BAS-04"),
    ("W1-SRV-03 (MES)",    "WP-W1-BAS-05"),
    ("W1-NAS-01",          "WP-W1-BAS-06"),
    ("W1-SW-CORE-01",      "WP-W1-BAS-07"),
    ("W1-UPS-02",          "WP-W1-BAS-08"),

    # WERK1 Ground Floor — Assembly Line A
    ("W1-PLC-ALA-01",      "WP-W1-GF-ALA-01"),
    ("W1-PLC-ALA-02",      "WP-W1-GF-ALA-02"),
    ("W1-PLC-ALA-03",      "WP-W1-GF-ALA-03"),
    ("W1-PLC-ALA-04",      "WP-W1-GF-ALA-04"),
    ("W1-IPC-ALA-01",      "WP-W1-GF-ALA-05"),  # shared drop
    ("W1-HMI-ALA-01",      "WP-W1-GF-ALA-05"),  # shared drop
    ("W1-IPC-ALA-02",      "WP-W1-GF-ALA-06"),
    ("W1-HMI-ALA-02",      "WP-W1-GF-ALA-06"),
    ("W1-IPC-ALA-03",      "WP-W1-GF-ALA-07"),
    ("W1-HMI-ALA-03",      "WP-W1-GF-ALA-07"),

    # WERK1 Ground Floor — Assembly Line B
    ("W1-PLC-ALB-01",      "WP-W1-GF-ALB-01"),
    ("W1-PLC-ALB-02",      "WP-W1-GF-ALB-02"),
    ("W1-PLC-ALB-03",      "WP-W1-GF-ALB-03"),
    ("W1-IPC-ALB-01",      "WP-W1-GF-ALB-04"),
    ("W1-IPC-ALB-02",      "WP-W1-GF-ALB-05"),

    # WERK1 Ground Floor — Assembly Line C (spare/unpatched ports)
    ("W1-PLC-ALC-01",      "WP-W1-GF-ALC-01"),
    ("W1-PLC-ALC-02",      "WP-W1-GF-ALC-02"),

    # WERK1 Ground Floor — CNC area
    ("W1-CNC-01",          "WP-W1-GF-CNC-01"),
    ("W1-CNC-02",          "WP-W1-GF-CNC-02"),
    ("W1-CNC-03",          "WP-W1-GF-CNC-03"),
    ("W1-CNC-04",          "WP-W1-GF-CNC-04"),

    # WERK1 Ground Floor — Robot cell
    ("W1-ROBOT-01",        "WP-W1-GF-ROB-01"),
    ("W1-ROBOT-02",        "WP-W1-GF-ROB-02"),
    ("W1-ROBOT-03",        "WP-W1-GF-ROB-03"),
    ("W1-KRC5-01",         "WP-W1-GF-KRC5"),

    # WERK1 First Floor — IT desks
    ("W1-WS-IT-01",        "WP-W1-FF-IT-01"),
    ("W1-WS-IT-02",        "WP-W1-FF-IT-02"),
    ("W1-WS-IT-03",        "WP-W1-FF-IT-03"),
    ("W1-WS-IT-04",        "WP-W1-FF-IT-04"),

    # WERK1 First Floor — Engineering open plan
    ("W1-WS-ENG-01",       "WP-W1-FF-ENG-01"),
    ("W1-WS-ENG-02",       "WP-W1-FF-ENG-02"),
    ("W1-WS-ENG-03",       "WP-W1-FF-ENG-03"),
    ("W1-WS-ENG-04",       "WP-W1-FF-ENG-04"),
    ("W1-WS-ENG-05",       "WP-W1-FF-ENG-05"),
    ("W1-WS-ENG-06",       "WP-W1-FF-ENG-06"),

    # WERK1 First Floor — Management cluster
    ("W1-WS-MGT-01",       "WP-W1-FF-MGT-01"),
    ("W1-WS-MGT-02",       "WP-W1-FF-MGT-02"),
    ("W1-WS-MGT-03",       "WP-W1-FF-MGT-03"),

    # WERK1 First Floor — misc
    ("W1-PRN-IT-01",       "WP-W1-FF-PRN-01"),
    ("W1-DISP-CONF-01",    "WP-W1-FF-CONF-01"),
    ("W1-KVM-IT-01",       "WP-W1-FF-KVM-01"),

    # WERK2 Ground Floor — Stamping line
    ("W2-PLC-STAMP-01",    "WP-W2-GF-STAMP-01"),
    ("W2-HMI-STAMP-01",    "WP-W2-GF-STAMP-01"),  # shared drop
    ("W2-PLC-STAMP-02",    "WP-W2-GF-STAMP-02"),
    ("W2-HMI-STAMP-02",    "WP-W2-GF-STAMP-02"),  # shared drop
    ("W2-PLC-STAMP-03",    "WP-W2-GF-STAMP-03"),

    # WERK2 Ground Floor — Welding cell
    ("W2-PLC-WELD-01",     "WP-W2-GF-WELD-01"),
    ("W2-ROBOT-WELD-01",   "WP-W2-GF-WELD-01"),  # shared drop
    ("W2-PLC-WELD-02",     "WP-W2-GF-WELD-02"),
    ("W2-ROBOT-WELD-02",   "WP-W2-GF-WELD-02"),
    ("W2-PLC-WELD-03",     "WP-W2-GF-WELD-03"),
    ("W2-ROBOT-WELD-03",   "WP-W2-GF-WELD-03"),
    ("W2-PLC-WELD-04",     "WP-W2-GF-WELD-04"),

    # WERK2 Ground Floor — Quality Lab
    ("W2-WS-QLAB-01",      "WP-W2-GF-QLAB-01"),
    ("W2-WS-QLAB-02",      "WP-W2-GF-QLAB-02"),
    ("W2-WS-QLAB-03",      "WP-W2-GF-QLAB-03"),

    # WERK3 Ground Floor — Workstations
    ("W3-WS-01",           "WP-W3-GF-WS-01"),
    ("W3-WS-02",           "WP-W3-GF-WS-02"),
    ("W3-WS-03",           "WP-W3-GF-WS-03"),

    # WERK3 Ground Floor — Scanners
    ("W3-SCAN-01",         "WP-W3-GF-SCAN-01"),
    ("W3-SCAN-02",         "WP-W3-GF-SCAN-02"),
    ("W3-SCAN-03",         "WP-W3-GF-SCAN-03"),
    ("W3-SCAN-04",         "WP-W3-GF-SCAN-04"),
    ("W3-SCAN-05",         "WP-W3-GF-SCAN-05"),
    ("W3-SCAN-06",         "WP-W3-GF-SCAN-06"),

    # WERK3 Ground Floor — Pick terminals
    ("W3-TERM-01",         "WP-W3-GF-TERM-01"),
    ("W3-TERM-02",         "WP-W3-GF-TERM-02"),
    ("W3-TERM-03",         "WP-W3-GF-TERM-03"),
    ("W3-TERM-04",         "WP-W3-GF-TERM-04"),

    # WERK3 Ground Floor — Router
    ("W3-RTR-01",          "WP-W3-GF-RTR"),
]

print("\n── Assigning wall ports to assets ───────────────────────────────────────")
assigned = skipped = missing = 0
for asset_name, wp_label in WALL_PORT_MAP:
    asset = by_name.get(asset_name)
    wp    = wp_by_label.get(wp_label)
    if not asset:
        print(f"  ! asset not found: {asset_name}")
        missing += 1
        continue
    if not wp:
        print(f"  ! wall port not found: {wp_label}")
        missing += 1
        continue
    if asset.get("wall_port_id") == wp["_id"]:
        skipped += 1
        continue
    try:
        patch(f"/assets/{asset['_id']}", {"wall_port_id": wp["_id"]}, token)
        print(f"  ✓ {asset_name:<32} → {wp_label}")
        assigned += 1
    except Exception as e:
        print(f"  ✗ {asset_name}: {e}")
        missing += 1

print(f"\n  Assigned: {assigned}  Already set: {skipped}  Failed/missing: {missing}")


# ── Logical connection topology ────────────────────────────────────────────────
# Format: (source_name, target_name, connection_type, bidirectional)
# All ethernet unless noted. Bidirectional=True everywhere (both peers know each other).
CONNECTIONS = [
    # ── WERK1 Ground Floor — devices to access switches ────────────────────────
    ("W1-PLC-ALA-01",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-PLC-ALA-02",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-PLC-ALA-03",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-PLC-ALA-04",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-IPC-ALA-01",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-HMI-ALA-01",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-IPC-ALA-02",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-HMI-ALA-02",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-IPC-ALA-03",   "W1-SW-ACC-ALA",   "ethernet", True),
    ("W1-HMI-ALA-03",   "W1-SW-ACC-ALA",   "ethernet", True),

    ("W1-PLC-ALB-01",   "W1-SW-ACC-ALB",   "ethernet", True),
    ("W1-PLC-ALB-02",   "W1-SW-ACC-ALB",   "ethernet", True),
    ("W1-PLC-ALB-03",   "W1-SW-ACC-ALB",   "ethernet", True),
    ("W1-IPC-ALB-01",   "W1-SW-ACC-ALB",   "ethernet", True),
    ("W1-IPC-ALB-02",   "W1-SW-ACC-ALB",   "ethernet", True),

    ("W1-PLC-ALC-01",   "W1-SW-ACC-ALC",   "ethernet", True),
    ("W1-PLC-ALC-02",   "W1-SW-ACC-ALC",   "ethernet", True),
    ("W1-PLC-ALC-03",   "W1-SW-ACC-ALC",   "ethernet", True),

    # access switches → floor distribution switch
    ("W1-SW-ACC-ALA",   "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-SW-ACC-ALB",   "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-SW-ACC-ALC",   "W1-SW-DIST-GF",   "ethernet", True),

    # CNC + robot cell → distribution switch
    ("W1-CNC-01",       "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CNC-02",       "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CNC-03",       "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CNC-04",       "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-ROBOT-01",     "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-ROBOT-02",     "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-ROBOT-03",     "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-KRC5-01",      "W1-SW-DIST-GF",   "ethernet", True),

    # APs + cameras → distribution switch
    ("W1-AP-GF-01",     "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-AP-GF-02",     "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CAM-GF-01",    "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CAM-GF-02",    "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CAM-GF-03",    "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CAM-GF-04",    "W1-SW-DIST-GF",   "ethernet", True),
    ("W1-CAM-GF-05",    "W1-SW-DIST-GF",   "ethernet", True),

    # GF distribution → core (fiber riser)
    ("W1-SW-DIST-GF",   "W1-SW-CORE-01",   "fiber",    True),

    # ── WERK1 First Floor — devices to distribution switch ─────────────────────
    ("W1-WS-IT-01",     "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-IT-02",     "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-IT-03",     "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-IT-04",     "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-01",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-02",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-03",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-04",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-05",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-ENG-06",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-MGT-01",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-MGT-02",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-WS-MGT-03",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-PRN-IT-01",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-DISP-CONF-01", "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-KVM-IT-01",    "W1-SW-DIST-FF",   "ethernet", True),
    ("W1-AP-FF-01",     "W1-SW-DIST-FF",   "ethernet", True),

    # FF distribution → core (fiber riser)
    ("W1-SW-DIST-FF",   "W1-SW-CORE-01",   "fiber",    True),

    # ── WERK1 Basement — server room ──────────────────────────────────────────
    ("W1-SRV-01",       "W1-SW-CORE-01",   "ethernet", True),
    ("W1-SRV-02",       "W1-SW-CORE-01",   "ethernet", True),
    ("W1-SRV-03 (MES)", "W1-SW-CORE-01",   "ethernet", True),
    ("W1-NAS-01",       "W1-SW-CORE-01",   "ethernet", True),
    ("W1-UPS-02",       "W1-SW-CORE-01",   "ethernet", True),   # mgmt port

    # core switch → router → firewall
    ("W1-SW-CORE-01",   "W1-RTR-01",       "ethernet", True),
    ("W1-RTR-01",       "W1-FW-01",        "ethernet", True),

    # UPS power connections (power type — tracks what's protected)
    ("W1-UPS-01",       "W1-SW-CORE-01",   "power",    False),
    ("W1-UPS-01",       "W1-SRV-01",       "power",    False),
    ("W1-UPS-01",       "W1-SRV-02",       "power",    False),
    ("W1-UPS-01",       "W1-SRV-03 (MES)", "power",    False),
    ("W1-UPS-01",       "W1-NAS-01",       "power",    False),
    ("W1-UPS-02",       "W1-SW-DIST-GF",   "power",    False),
    ("W1-UPS-02",       "W1-SW-DIST-FF",   "power",    False),

    # NAS → servers (dependency: servers back up to NAS)
    ("W1-SRV-01",       "W1-NAS-01",       "dependency", False),
    ("W1-SRV-02",       "W1-NAS-01",       "dependency", False),
    ("W1-SRV-03 (MES)", "W1-NAS-01",       "dependency", False),

    # ── WERK1 campus uplinks ────────────────────────────────────────────────────
    ("W1-SW-CORE-01",   "W2-SW-CORE-01",   "fiber",    True),
    ("W1-SW-CORE-01",   "W3-SW-CORE-01",   "fiber",    True),

    # ── WERK2 Ground Floor ─────────────────────────────────────────────────────
    ("W2-PLC-STAMP-01", "W2-SW-STAMP",     "ethernet", True),
    ("W2-HMI-STAMP-01", "W2-SW-STAMP",     "ethernet", True),
    ("W2-PLC-STAMP-02", "W2-SW-STAMP",     "ethernet", True),
    ("W2-HMI-STAMP-02", "W2-SW-STAMP",     "ethernet", True),
    ("W2-PLC-STAMP-03", "W2-SW-STAMP",     "ethernet", True),
    ("W2-SW-STAMP",     "W2-SW-CORE-01",   "ethernet", True),

    ("W2-PLC-WELD-01",  "W2-SW-CORE-01",   "ethernet", True),
    ("W2-ROBOT-WELD-01","W2-SW-CORE-01",   "ethernet", True),
    ("W2-PLC-WELD-02",  "W2-SW-CORE-01",   "ethernet", True),
    ("W2-ROBOT-WELD-02","W2-SW-CORE-01",   "ethernet", True),
    ("W2-PLC-WELD-03",  "W2-SW-CORE-01",   "ethernet", True),
    ("W2-ROBOT-WELD-03","W2-SW-CORE-01",   "ethernet", True),
    ("W2-PLC-WELD-04",  "W2-SW-CORE-01",   "ethernet", True),

    ("W2-WS-QLAB-01",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-QLAB-02",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-QLAB-03",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-PLAN-01",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-PLAN-02",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-PLAN-03",   "W2-SW-CORE-01",   "ethernet", True),
    ("W2-WS-PLAN-04",   "W2-SW-CORE-01",   "ethernet", True),

    ("W2-RTR-01",       "W2-SW-CORE-01",   "ethernet", True),

    # ── WERK3 Ground Floor ─────────────────────────────────────────────────────
    ("W3-WS-01",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-WS-02",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-WS-03",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-01",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-02",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-03",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-04",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-05",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-SCAN-06",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-TERM-01",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-TERM-02",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-TERM-03",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-TERM-04",      "W3-SW-CORE-01",   "ethernet", True),
    ("W3-AP-01",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-AP-02",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-AP-03",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-AP-04",        "W3-SW-CORE-01",   "ethernet", True),
    ("W3-CAM-01",       "W3-SW-CORE-01",   "ethernet", True),
    ("W3-CAM-02",       "W3-SW-CORE-01",   "ethernet", True),
    ("W3-CAM-03",       "W3-SW-CORE-01",   "ethernet", True),
    ("W3-CAM-04",       "W3-SW-CORE-01",   "ethernet", True),
    ("W3-RTR-01",       "W3-SW-CORE-01",   "ethernet", True),
]


def add_conn(src_id, dst_id, conn_type, bidir, token):
    """Add one direction; return True if created, False if already existed."""
    result = safe_post(f"/assets/{src_id}/connections", {
        "connected_asset_id": dst_id,
        "connection_type": conn_type,
        "bidirectional": bidir,
        "strength": "normal",
    }, token)
    return result is not None


print("\n── Adding logical connections ────────────────────────────────────────────")
created = already = missing_conn = 0
for src_name, dst_name, conn_type, bidir in CONNECTIONS:
    src = by_name.get(src_name)
    dst = by_name.get(dst_name)
    if not src:
        print(f"  ! src not found: {src_name}")
        missing_conn += 1
        continue
    if not dst:
        print(f"  ! dst not found: {dst_name}")
        missing_conn += 1
        continue

    made = add_conn(src["_id"], dst["_id"], conn_type, bidir, token)
    if bidir:
        add_conn(dst["_id"], src["_id"], conn_type, bidir, token)

    if made:
        print(f"  ✓ {src_name}  →{'↔' if bidir else '→'}  {dst_name}  [{conn_type}]")
        created += 1
    else:
        already += 1

print(f"\n  Created: {created}  Already existed: {already}  Missing assets: {missing_conn}")

print("\n✓ Seed complete!")
print(f"  Wall port assignments: {assigned} new, {skipped} skipped")
print(f"  Logical connections:   {created} new, {already} skipped")
