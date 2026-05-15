/**
 * seed-mssql.ts — Comprehensive factory demo seeder.
 *
 * Run with: `npx ts-node src/scripts/seed-mssql.ts`
 *
 * Creates:
 *   - 3 users (admin, operator, viewer)
 *   - 3 buildings: WERK1 (Main Production), WERK2 (Component Manufacturing), WERK3 (Warehouse)
 *   - Full location hierarchy: floors → work areas → sections → workstations
 *   - 118 assets covering every type (router, firewall, switch, server, PLC, HMI,
 *     workstation, laptop, CNC, robot, UPS, camera, printer, scanner, display…)
 *   - 89 connection edges forming a realistic network topology:
 *     Router → Firewall → Core Switch → Distribution → Access → End devices
 *   - 75 software records, maintenance schedules, and per-asset custom fields
 *
 * WARNING: Deletes ALL existing data. Never run against production.
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';
import { AssetSoftware } from '../entities/AssetSoftware.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { User } from '../entities/User.entity';

// ── helpers ────────────────────────────────────────────────────────────────────
const d = (daysOffset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + daysOffset);
  return dt;
};

const mac = (prefix: string, n: number) =>
  `${prefix}:${String(n).padStart(2, '0')}:${(n * 3 % 256).toString(16).padStart(2, '0').toUpperCase()}`;

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server');

  const buildingRepo    = AppDataSource.getRepository(Building);
  const floorRepo       = AppDataSource.getRepository(Floor);
  const waRepo          = AppDataSource.getRepository(WorkArea);
  const sectionRepo     = AppDataSource.getRepository(Section);
  const wsRepo          = AppDataSource.getRepository(Workstation);
  const assetRepo       = AppDataSource.getRepository(Asset);
  const softwareRepo    = AppDataSource.getRepository(AssetSoftware);
  const connectionRepo  = AppDataSource.getRepository(AssetConnection);
  const userRepo        = AppDataSource.getRepository(User);

  // ── 1. Clear data ────────────────────────────────────────────────────────────
  console.log('🗑️  Clearing existing data...');
  const delIfExists = async (table: string) => {
    await AppDataSource.query(
      `IF OBJECT_ID(N'${table}', N'U') IS NOT NULL DELETE FROM [${table}]`,
    );
  };
  await delIfExists('asset_software');
  await delIfExists('asset_connections');
  await delIfExists('assets');
  await delIfExists('workstations');
  await delIfExists('sections');
  await delIfExists('work_areas');
  await delIfExists('floors');
  await delIfExists('buildings');
  await delIfExists('audit_logs');
  await delIfExists('alert_logs');
  await delIfExists('active_sessions');
  await delIfExists('users');
  console.log('   ✓ Cleared');

  // ── 2. Users ─────────────────────────────────────────────────────────────────
  console.log('👤 Creating users...');
  const admin = userRepo.create({ username: 'admin', password: 'Admin@1234', role: 'admin', email: 'admin@factory.local', active: true });
  await userRepo.save(admin);
  const operator = userRepo.create({ username: 'operator', password: 'Operator@1234', role: 'operator', email: 'operator@factory.local', active: true });
  await userRepo.save(operator);
  const viewer = userRepo.create({ username: 'viewer', password: 'Viewer@1234', role: 'viewer', email: 'viewer@factory.local', active: true });
  await userRepo.save(viewer);
  console.log('   admin / Admin@1234 · operator / Operator@1234 · viewer / Viewer@1234');

  // ────────────────────────────────────────────────────────────────────────────
  // WERK1 — Main Production Facility
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🏭 Creating WERK1 — Main Production Facility...');
  const w1 = buildingRepo.create({
    name: 'WERK1 — Main Production',
    address: 'Industriestraße 1, 45678 Musterstadt',
    metadata: { total_area_m2: 18000, year_built: 2012, manager: 'Klaus Weber', floors: 3 },
  });
  await buildingRepo.save(w1);

  // Basement (-1): Server room + electrical
  const w1_bsmt = floorRepo.create({ building_id: w1.id, floor_number: -1, name: 'Basement — Server Room' });
  await floorRepo.save(w1_bsmt);

  const wa_srv = waRepo.create({ floor_id: w1_bsmt.id, name: 'Server Room', type: 'IT Infrastructure', coord_x: 50, coord_y: 50, dim_width: 400, dim_height: 250 });
  await waRepo.save(wa_srv);
  const wa_elec = waRepo.create({ floor_id: w1_bsmt.id, name: 'Electrical Room', type: 'Electrical', coord_x: 500, coord_y: 50, dim_width: 200, dim_height: 150 });
  await waRepo.save(wa_elec);

  const sec_rack = sectionRepo.create({ workarea_id: wa_srv.id, name: 'Rack A — Core', coord_x: 70, coord_y: 70, capacity: 12 });
  await sectionRepo.save(sec_rack);
  const sec_rack_b = sectionRepo.create({ workarea_id: wa_srv.id, name: 'Rack B — Storage', coord_x: 200, coord_y: 70, capacity: 12 });
  await sectionRepo.save(sec_rack_b);

  // Ground floor (0): Production
  const w1_gf = floorRepo.create({ building_id: w1.id, floor_number: 0, name: 'Ground Floor — Production' });
  await floorRepo.save(w1_gf);

  const wa_ala = waRepo.create({ floor_id: w1_gf.id, name: 'Assembly Line A', type: 'Production', coord_x: 50, coord_y: 50, dim_width: 450, dim_height: 200 });
  await waRepo.save(wa_ala);
  const wa_alb = waRepo.create({ floor_id: w1_gf.id, name: 'Assembly Line B', type: 'Production', coord_x: 50, coord_y: 300, dim_width: 450, dim_height: 200 });
  await waRepo.save(wa_alb);
  const wa_alc = waRepo.create({ floor_id: w1_gf.id, name: 'Assembly Line C', type: 'Production', coord_x: 50, coord_y: 550, dim_width: 450, dim_height: 200 });
  await waRepo.save(wa_alc);
  const wa_cnc = waRepo.create({ floor_id: w1_gf.id, name: 'CNC Machining', type: 'CNC', coord_x: 550, coord_y: 50, dim_width: 300, dim_height: 300 });
  await waRepo.save(wa_cnc);
  const wa_paint = waRepo.create({ floor_id: w1_gf.id, name: 'Painting & Coating', type: 'Painting', coord_x: 550, coord_y: 400, dim_width: 300, dim_height: 250 });
  await waRepo.save(wa_paint);
  const wa_robot = waRepo.create({ floor_id: w1_gf.id, name: 'Robotics Cell', type: 'Automation', coord_x: 900, coord_y: 50, dim_width: 250, dim_height: 350 });
  await waRepo.save(wa_robot);

  const sec_ala1 = sectionRepo.create({ workarea_id: wa_ala.id, name: 'Shift A', coord_x: 70, coord_y: 70, capacity: 8, shift_schedule: 'Day' });
  await sectionRepo.save(sec_ala1);
  const sec_ala2 = sectionRepo.create({ workarea_id: wa_ala.id, name: 'Shift B', coord_x: 200, coord_y: 70, capacity: 8, shift_schedule: 'Afternoon' });
  await sectionRepo.save(sec_ala2);
  const sec_alb1 = sectionRepo.create({ workarea_id: wa_alb.id, name: 'Shift A', coord_x: 70, coord_y: 320, capacity: 8, shift_schedule: 'Day' });
  await sectionRepo.save(sec_alb1);
  const sec_cnc = sectionRepo.create({ workarea_id: wa_cnc.id, name: 'CNC Bay 1', coord_x: 570, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_cnc);

  const ws_ala1 = wsRepo.create({ section_id: sec_ala1.id, name: 'WS-ALA-001', type: 'operator', coord_x: 90, coord_y: 90, status: 'active' });
  await wsRepo.save(ws_ala1);
  const ws_ala2 = wsRepo.create({ section_id: sec_ala1.id, name: 'WS-ALA-002', type: 'operator', coord_x: 150, coord_y: 90, status: 'active' });
  await wsRepo.save(ws_ala2);
  const ws_ala3 = wsRepo.create({ section_id: sec_ala2.id, name: 'WS-ALA-003', type: 'hmi', coord_x: 220, coord_y: 90, status: 'active' });
  await wsRepo.save(ws_ala3);
  const ws_cnc1 = wsRepo.create({ section_id: sec_cnc.id, name: 'WS-CNC-001', type: 'cnc', coord_x: 590, coord_y: 90, status: 'active' });
  await wsRepo.save(ws_cnc1);

  // 1st floor: IT + Engineering + Management
  const w1_ff = floorRepo.create({ building_id: w1.id, floor_number: 1, name: 'First Floor — Offices' });
  await floorRepo.save(w1_ff);

  const wa_it = waRepo.create({ floor_id: w1_ff.id, name: 'IT Department', type: 'Office', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 200 });
  await waRepo.save(wa_it);
  const wa_eng = waRepo.create({ floor_id: w1_ff.id, name: 'Engineering', type: 'Office', coord_x: 400, coord_y: 50, dim_width: 300, dim_height: 200 });
  await waRepo.save(wa_eng);
  const wa_mgmt = waRepo.create({ floor_id: w1_ff.id, name: 'Management', type: 'Office', coord_x: 50, coord_y: 300, dim_width: 250, dim_height: 150 });
  await waRepo.save(wa_mgmt);
  const wa_conf = waRepo.create({ floor_id: w1_ff.id, name: 'Conference Room A', type: 'Conference', coord_x: 350, coord_y: 300, dim_width: 200, dim_height: 150 });
  await waRepo.save(wa_conf);

  const sec_it = sectionRepo.create({ workarea_id: wa_it.id, name: 'IT Helpdesk', coord_x: 70, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_it);
  const sec_eng = sectionRepo.create({ workarea_id: wa_eng.id, name: 'CAD Workstations', coord_x: 420, coord_y: 70, capacity: 6 });
  await sectionRepo.save(sec_eng);

  for (let i = 1; i <= 4; i++) {
    const ws = wsRepo.create({ section_id: sec_it.id, name: `WS-IT-00${i}`, type: 'standard', coord_x: 70 + i * 55, coord_y: 90, status: 'active' });
    await wsRepo.save(ws);
  }
  for (let i = 1; i <= 6; i++) {
    const ws = wsRepo.create({ section_id: sec_eng.id, name: `WS-ENG-00${i}`, type: 'cad', coord_x: 420 + i * 45, coord_y: 90, status: 'active' });
    await wsRepo.save(ws);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // WERK2 — Component Manufacturing
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🏭 Creating WERK2 — Component Manufacturing...');
  const w2 = buildingRepo.create({
    name: 'WERK2 — Component Manufacturing',
    address: 'Industriestraße 5, 45678 Musterstadt',
    metadata: { total_area_m2: 9500, year_built: 2016, manager: 'Anna Müller' },
  });
  await buildingRepo.save(w2);

  const w2_gf = floorRepo.create({ building_id: w2.id, floor_number: 0, name: 'Ground Floor — Manufacturing' });
  await floorRepo.save(w2_gf);
  const w2_ff = floorRepo.create({ building_id: w2.id, floor_number: 1, name: 'First Floor — Planning & Maintenance' });
  await floorRepo.save(w2_ff);

  const wa_stamp = waRepo.create({ floor_id: w2_gf.id, name: 'Stamping Press', type: 'Production', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 200 });
  await waRepo.save(wa_stamp);
  const wa_weld = waRepo.create({ floor_id: w2_gf.id, name: 'Welding Station', type: 'Production', coord_x: 400, coord_y: 50, dim_width: 300, dim_height: 200 });
  await waRepo.save(wa_weld);
  const wa_qlab = waRepo.create({ floor_id: w2_gf.id, name: 'Quality Lab', type: 'QA', coord_x: 50, coord_y: 300, dim_width: 250, dim_height: 150 });
  await waRepo.save(wa_qlab);
  const wa_plan = waRepo.create({ floor_id: w2_ff.id, name: 'Planning Office', type: 'Office', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 150 });
  await waRepo.save(wa_plan);
  const wa_maint = waRepo.create({ floor_id: w2_ff.id, name: 'Maintenance Workshop', type: 'Maintenance', coord_x: 400, coord_y: 50, dim_width: 300, dim_height: 150 });
  await waRepo.save(wa_maint);

  const sec_stamp = sectionRepo.create({ workarea_id: wa_stamp.id, name: 'Press Bay', coord_x: 70, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_stamp);
  const sec_weld = sectionRepo.create({ workarea_id: wa_weld.id, name: 'Weld Bay 1', coord_x: 420, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_weld);

  // ────────────────────────────────────────────────────────────────────────────
  // WERK3 — Warehouse & Logistics
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🏭 Creating WERK3 — Warehouse & Logistics...');
  const w3 = buildingRepo.create({
    name: 'WERK3 — Warehouse & Logistics',
    address: 'Logistikweg 3, 45678 Musterstadt',
    metadata: { total_area_m2: 12000, year_built: 2019, manager: 'Stefan Braun' },
  });
  await buildingRepo.save(w3);

  const w3_gf = floorRepo.create({ building_id: w3.id, floor_number: 0, name: 'Ground Floor — Warehouse' });
  await floorRepo.save(w3_gf);

  const wa_recv = waRepo.create({ floor_id: w3_gf.id, name: 'Receiving Dock', type: 'Logistics', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 150 });
  await waRepo.save(wa_recv);
  const wa_stor = waRepo.create({ floor_id: w3_gf.id, name: 'Storage Racks A-F', type: 'Storage', coord_x: 50, coord_y: 250, dim_width: 600, dim_height: 300 });
  await waRepo.save(wa_stor);
  const wa_ship = waRepo.create({ floor_id: w3_gf.id, name: 'Shipping Dock', type: 'Logistics', coord_x: 700, coord_y: 50, dim_width: 250, dim_height: 200 });
  await waRepo.save(wa_ship);

  const sec_recv = sectionRepo.create({ workarea_id: wa_recv.id, name: 'Inbound', coord_x: 70, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_recv);
  const sec_ship = sectionRepo.create({ workarea_id: wa_ship.id, name: 'Outbound', coord_x: 720, coord_y: 70, capacity: 4 });
  await sectionRepo.save(sec_ship);

  // ────────────────────────────────────────────────────────────────────────────
  // ASSETS — helper to create and save
  // ────────────────────────────────────────────────────────────────────────────
  console.log('💾 Creating assets...');
  const A: Record<string, Asset> = {};

  const mkAsset = async (key: string, data: Partial<Asset>) => {
    const e = assetRepo.create({ source_of_truth: 'local', sync_status: 'never', ...data });
    await assetRepo.save(e);
    A[key] = e;
    return e;
  };

  // ── WERK1 Basement: Network core & servers ──────────────────────────────────
  await mkAsset('router', {
    display_name: 'W1-RTR-01', asset_tag: 'NET-W1-RTR-01', serial_number: 'SN-RTR-001',
    manufacturer: 'Cisco', model: 'ISR 4451-X', asset_type: 'router', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.1', hostname: 'W1-RTR-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:01', is_placed: true, loc_x: 100, loc_y: 100,
    physical_condition: 'good', environment: 'datacenter', tags: ['network', 'core', 'production'],
    maint_last_date: d(-90), maint_next_date: d(275), maint_interval_days: 365,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-RTR-001',
    itsm_guid: 'guid-rtr-001', sync_status: 'success', last_synced: d(-1),
    object_id: 'OBJ-RTR-001', remote_access_tool: 'SSH', backup_tool: 'Cisco IOS backup',
  });

  await mkAsset('fw', {
    display_name: 'W1-FW-01', asset_tag: 'NET-W1-FW-01', serial_number: 'SN-FW-001',
    manufacturer: 'Fortinet', model: 'FortiGate 200F', asset_type: 'firewall', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.2', hostname: 'W1-FW-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:02', is_placed: true, loc_x: 100, loc_y: 160,
    physical_condition: 'good', environment: 'datacenter', tags: ['network', 'security', 'firewall'],
    maint_last_date: d(-180), maint_next_date: d(185), maint_interval_days: 365,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-FW-001',
    itsm_guid: 'guid-fw-001', sync_status: 'success', last_synced: d(-1),
    fortiedr_active: true, remote_access_tool: 'FortiManager', backup_tool: 'FortiBackup',
  });

  await mkAsset('core_sw', {
    display_name: 'W1-SW-CORE-01', asset_tag: 'NET-W1-CSW-01', serial_number: 'SN-CSW-001',
    manufacturer: 'Cisco', model: 'Catalyst 9300-48P', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.3', hostname: 'W1-SW-CORE-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:03', is_placed: true, loc_x: 100, loc_y: 220,
    physical_condition: 'good', environment: 'datacenter', tags: ['network', 'switch', 'core'],
    maint_last_date: d(-30), maint_next_date: d(335), maint_interval_days: 365,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-CSW-001',
    itsm_guid: 'guid-csw-001', sync_status: 'success', last_synced: d(-1),
  });

  await mkAsset('ups1', {
    display_name: 'W1-UPS-01', asset_tag: 'ELE-W1-UPS-01', serial_number: 'SN-UPS-001',
    manufacturer: 'APC', model: 'Smart-UPS 5000', asset_type: 'ups', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.10', hostname: 'W1-UPS-01', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:10', is_placed: true, loc_x: 250, loc_y: 100,
    physical_condition: 'good', tags: ['power', 'ups'],
    maint_last_date: d(-60), maint_next_date: d(30), maint_interval_days: 90,
    notes: 'Battery replacement due soon — schedule Q2',
  });

  await mkAsset('ups2', {
    display_name: 'W1-UPS-02', asset_tag: 'ELE-W1-UPS-02', serial_number: 'SN-UPS-002',
    manufacturer: 'APC', model: 'Smart-UPS 3000', asset_type: 'ups', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_elec.id,
    ip_address: '10.0.0.11', hostname: 'W1-UPS-02', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:11', is_placed: true, loc_x: 520, loc_y: 80,
    physical_condition: 'fair', tags: ['power', 'ups'],
    maint_last_date: d(-120), maint_next_date: d(-30), maint_interval_days: 90,
    notes: 'OVERDUE — schedule maintenance immediately',
  });

  // Servers in rack A
  await mkAsset('srv01', {
    display_name: 'W1-SRV-01', asset_tag: 'SRV-W1-001', serial_number: 'SN-SRV-001',
    manufacturer: 'Dell', model: 'PowerEdge R750', asset_type: 'server', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.20', hostname: 'W1-SRV-01', vlan: 'SERVERS', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:20', is_placed: true, loc_x: 180, loc_y: 100,
    cpu: 'Intel Xeon Gold 5317 (2×)', ram: '256GB DDR4 ECC', storage: '8×2TB NVMe RAID-6',
    physical_condition: 'good', environment: 'datacenter', tags: ['server', 'production', 'active-directory'],
    maint_last_date: d(-45), maint_next_date: d(135), maint_interval_days: 180,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-SRV-001',
    itsm_guid: 'guid-srv-001', sync_status: 'success', last_synced: d(-1),
    os_type: 'Windows Server', os_version: '2022 Standard',
    remote_access_tool: 'VMware ESXi / iDRAC', backup_tool: 'Veeam',
    backup_status: 'success', winupdate_date: d(-14), fortiedr_active: true,
    object_id: 'OBJ-SRV-001',
  });

  await mkAsset('srv02', {
    display_name: 'W1-SRV-02', asset_tag: 'SRV-W1-002', serial_number: 'SN-SRV-002',
    manufacturer: 'Dell', model: 'PowerEdge R750', asset_type: 'server', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack.id,
    ip_address: '10.0.0.21', hostname: 'W1-SRV-02', vlan: 'SERVERS', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:21', is_placed: true, loc_x: 180, loc_y: 150,
    cpu: 'Intel Xeon Gold 5317 (2×)', ram: '128GB DDR4 ECC', storage: '4×1TB SSD RAID-5',
    physical_condition: 'good', environment: 'datacenter', tags: ['server', 'scada', 'historian'],
    maint_last_date: d(-45), maint_next_date: d(135), maint_interval_days: 180,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-SRV-002',
    itsm_guid: 'guid-srv-002', sync_status: 'success', last_synced: d(-1),
    os_type: 'Windows Server', os_version: '2019 Datacenter',
    remote_access_tool: 'iDRAC', backup_tool: 'Veeam', backup_status: 'success',
    winupdate_date: d(-7), fortiedr_active: true, object_id: 'OBJ-SRV-002',
  });

  await mkAsset('srv03', {
    display_name: 'W1-SRV-03 (MES)', asset_tag: 'SRV-W1-003', serial_number: 'SN-SRV-003',
    manufacturer: 'HPE', model: 'ProLiant DL380 Gen11', asset_type: 'server', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack_b.id,
    ip_address: '10.0.0.22', hostname: 'W1-SRV-MES', vlan: 'SERVERS', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:22', is_placed: true, loc_x: 280, loc_y: 100,
    cpu: 'Intel Xeon Silver 4416+', ram: '192GB DDR5 ECC', storage: '6×960GB SSD RAID-5',
    physical_condition: 'good', environment: 'datacenter', tags: ['server', 'mes'],
    maint_last_date: d(-90), maint_next_date: d(90), maint_interval_days: 180,
    is_managed: true, source_of_truth: 'itsm', hardware_asset_id: 'ITSM-SRV-003',
    itsm_guid: 'guid-srv-003', sync_status: 'success', last_synced: d(-1),
    os_type: 'Windows Server', os_version: '2022 Standard',
    remote_access_tool: 'iLO', backup_tool: 'Veeam', backup_status: 'success',
    winupdate_date: d(-21), fortiedr_active: true,
  });

  await mkAsset('nas', {
    display_name: 'W1-NAS-01', asset_tag: 'SRV-W1-NAS-01', serial_number: 'SN-NAS-001',
    manufacturer: 'Synology', model: 'RS2423+', asset_type: 'server', status: 'active',
    building_id: w1.id, floor_id: w1_bsmt.id, workarea_id: wa_srv.id, section_id: sec_rack_b.id,
    ip_address: '10.0.0.25', hostname: 'W1-NAS-01', vlan: 'SERVERS', dhcp_static: 'static',
    mac_address: 'AA:BB:01:00:00:25', is_placed: true, loc_x: 280, loc_y: 150,
    cpu: 'AMD Ryzen V1500B', ram: '32GB', storage: '12×16TB HDD RAID-6',
    physical_condition: 'good', tags: ['storage', 'backup', 'nas'],
    maint_last_date: d(-30), maint_next_date: d(150), maint_interval_days: 180,
    backup_tool: 'Synology Hyper Backup', backup_status: 'success',
  });

  // Distribution switch — ground floor production
  await mkAsset('dsw_gf', {
    display_name: 'W1-SW-DIST-GF', asset_tag: 'NET-W1-DSW-GF', serial_number: 'SN-DSW-GF',
    manufacturer: 'Cisco', model: 'Catalyst 9200-48T', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id,
    ip_address: '10.1.0.1', hostname: 'W1-SW-DIST-GF', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:01:01:00:01', is_placed: true, loc_x: 800, loc_y: 400,
    physical_condition: 'good', tags: ['network', 'switch', 'distribution'],
    maint_last_date: d(-60), maint_next_date: d(305), maint_interval_days: 365,
  });

  // Access switches — one per production line
  await mkAsset('asw_ala', {
    display_name: 'W1-SW-ACC-ALA', asset_tag: 'NET-W1-ASW-ALA', serial_number: 'SN-ASW-ALA',
    manufacturer: 'Cisco', model: 'Catalyst 1000-24T', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_ala.id,
    ip_address: '10.1.1.1', hostname: 'W1-SW-ACC-ALA', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:01:01:01:01', is_placed: true, loc_x: 480, loc_y: 100,
    physical_condition: 'good', tags: ['network', 'switch', 'access'],
  });

  await mkAsset('asw_alb', {
    display_name: 'W1-SW-ACC-ALB', asset_tag: 'NET-W1-ASW-ALB', serial_number: 'SN-ASW-ALB',
    manufacturer: 'Cisco', model: 'Catalyst 1000-24T', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_alb.id,
    ip_address: '10.1.1.2', hostname: 'W1-SW-ACC-ALB', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:01:01:01:02', is_placed: true, loc_x: 480, loc_y: 350,
    physical_condition: 'good', tags: ['network', 'switch', 'access'],
  });

  await mkAsset('asw_alc', {
    display_name: 'W1-SW-ACC-ALC', asset_tag: 'NET-W1-ASW-ALC', serial_number: 'SN-ASW-ALC',
    manufacturer: 'Cisco', model: 'Catalyst 1000-24T', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_alc.id,
    ip_address: '10.1.1.3', hostname: 'W1-SW-ACC-ALC', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:01:01:01:03', is_placed: true, loc_x: 480, loc_y: 600,
    physical_condition: 'good', tags: ['network', 'switch', 'access'],
  });

  // Access switch — office floor
  await mkAsset('dsw_ff', {
    display_name: 'W1-SW-DIST-FF', asset_tag: 'NET-W1-DSW-FF', serial_number: 'SN-DSW-FF',
    manufacturer: 'Cisco', model: 'Catalyst 9200-48P', asset_type: 'switch', status: 'active',
    building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_it.id,
    ip_address: '10.1.2.1', hostname: 'W1-SW-DIST-FF', vlan: 'OFFICE', dhcp_static: 'static',
    mac_address: 'AA:BB:01:02:00:01', is_placed: true, loc_x: 320, loc_y: 100,
    physical_condition: 'good', tags: ['network', 'switch', 'office'],
    maint_last_date: d(-60), maint_next_date: d(305), maint_interval_days: 365,
  });

  // Wi-Fi APs
  await mkAsset('ap_gf1', {
    display_name: 'W1-AP-GF-01', asset_tag: 'NET-W1-AP-GF-01', serial_number: 'SN-AP-GF-01',
    manufacturer: 'Cisco', model: 'Catalyst 9120AXI', asset_type: 'access_point', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id,
    ip_address: '10.1.3.1', hostname: 'W1-AP-GF-01', vlan: 'WIFI', dhcp_static: 'static',
    mac_address: 'AA:BB:01:03:01:01', is_placed: true, loc_x: 300, loc_y: 400,
    tags: ['wifi', 'ap'], maint_last_date: d(-180), maint_next_date: d(185), maint_interval_days: 365,
  });

  await mkAsset('ap_gf2', {
    display_name: 'W1-AP-GF-02', asset_tag: 'NET-W1-AP-GF-02', serial_number: 'SN-AP-GF-02',
    manufacturer: 'Cisco', model: 'Catalyst 9120AXI', asset_type: 'access_point', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id,
    ip_address: '10.1.3.2', hostname: 'W1-AP-GF-02', vlan: 'WIFI', dhcp_static: 'static',
    mac_address: 'AA:BB:01:03:01:02', is_placed: true, loc_x: 700, loc_y: 400,
    tags: ['wifi', 'ap'],
  });

  await mkAsset('ap_ff1', {
    display_name: 'W1-AP-FF-01', asset_tag: 'NET-W1-AP-FF-01', serial_number: 'SN-AP-FF-01',
    manufacturer: 'Cisco', model: 'Catalyst 9115AXI', asset_type: 'access_point', status: 'active',
    building_id: w1.id, floor_id: w1_ff.id,
    ip_address: '10.1.3.10', hostname: 'W1-AP-FF-01', vlan: 'WIFI', dhcp_static: 'static',
    mac_address: 'AA:BB:01:03:02:01', is_placed: true, loc_x: 350, loc_y: 250,
    tags: ['wifi', 'ap'],
  });

  // Production PLCs — Assembly Line A
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`plc_ala_${i}`, {
      display_name: `W1-PLC-ALA-0${i}`, asset_tag: `PLC-ALA-0${i}`, serial_number: `SN-PLC-ALA-0${i}`,
      manufacturer: 'Siemens', model: 'S7-1515-2 PN', asset_type: 'plc', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_ala.id,
      section_id: i <= 2 ? sec_ala1.id : sec_ala2.id,
      ip_address: `10.1.1.1${i}`, hostname: `W1-PLC-ALA-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:11', i), is_placed: true, loc_x: 80 + i * 90, loc_y: 130,
      physical_condition: 'good', tags: ['plc', 'siemens', 'production'],
      maint_last_date: d(-30 * i), maint_next_date: d(150 + 30 * i), maint_interval_days: 180,
      is_managed: true, source_of_truth: 'itsm', hardware_asset_id: `ITSM-PLC-ALA-0${i}`,
      itsm_guid: `guid-plc-ala-0${i}`, sync_status: 'success', last_synced: d(-1),
      object_id: `OBJ-PLC-ALA-0${i}`,
    });
  }

  // HMIs — Assembly Line A
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`hmi_ala_${i}`, {
      display_name: `W1-HMI-ALA-0${i}`, asset_tag: `HMI-ALA-0${i}`, serial_number: `SN-HMI-ALA-0${i}`,
      manufacturer: 'Siemens', model: 'SIMATIC HMI TP1500', asset_type: 'hmi', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_ala.id,
      section_id: i <= 2 ? sec_ala1.id : sec_ala2.id,
      workstation_id: i === 1 ? ws_ala1.id : i === 2 ? ws_ala2.id : ws_ala3.id,
      ip_address: `10.1.1.2${i}`, hostname: `W1-HMI-ALA-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:12', i), is_placed: true, loc_x: 100 + i * 110, loc_y: 100,
      physical_condition: 'good', tags: ['hmi', 'siemens', 'production'],
      maint_last_date: d(-60), maint_next_date: d(120), maint_interval_days: 180,
    });
  }

  // IPC operator workstations — Assembly Line A
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`ws_ala_${i}`, {
      display_name: `W1-IPC-ALA-0${i}`, asset_tag: `IPC-ALA-0${i}`, serial_number: `SN-IPC-ALA-0${i}`,
      manufacturer: 'Siemens', model: 'SIMATIC IPC547G', asset_type: 'workstation', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_ala.id,
      section_id: i <= 2 ? sec_ala1.id : sec_ala2.id,
      workstation_id: i === 1 ? ws_ala1.id : i === 2 ? ws_ala2.id : ws_ala3.id,
      ip_address: `10.1.1.3${i}`, hostname: `W1-IPC-ALA-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:13', i), is_placed: true, loc_x: 90 + i * 110, loc_y: 170,
      cpu: 'Intel Core i7-11700E', ram: '16GB', storage: '512GB SSD',
      os_type: 'Windows 10 IoT', os_version: '2021 LTSC',
      physical_condition: 'good', tags: ['ipc', 'workstation', 'production'],
      maint_last_date: d(-90), maint_next_date: d(90), maint_interval_days: 180,
      is_managed: true, source_of_truth: 'itsm', hardware_asset_id: `ITSM-IPC-ALA-0${i}`,
      itsm_guid: `guid-ipc-ala-0${i}`, sync_status: 'success', last_synced: d(-1),
      fortiedr_active: true, remote_access_tool: 'TightVNC', backup_tool: 'Veeam Agent',
    });
  }

  // Assembly Line B — similar setup
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`plc_alb_${i}`, {
      display_name: `W1-PLC-ALB-0${i}`, asset_tag: `PLC-ALB-0${i}`, serial_number: `SN-PLC-ALB-0${i}`,
      manufacturer: 'Siemens', model: 'S7-1200 CPU 1215C', asset_type: 'plc', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_alb.id, section_id: sec_alb1.id,
      ip_address: `10.1.2.1${i}`, hostname: `W1-PLC-ALB-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:21', i), is_placed: true, loc_x: 80 + i * 90, loc_y: 380,
      physical_condition: 'good', tags: ['plc', 'siemens'],
      maint_last_date: d(-60), maint_next_date: d(120), maint_interval_days: 180,
    });
  }

  for (let i = 1; i <= 2; i++) {
    await mkAsset(`ws_alb_${i}`, {
      display_name: `W1-IPC-ALB-0${i}`, asset_tag: `IPC-ALB-0${i}`, serial_number: `SN-IPC-ALB-0${i}`,
      manufacturer: 'Beckhoff', model: 'CX5140', asset_type: 'workstation', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_alb.id, section_id: sec_alb1.id,
      ip_address: `10.1.2.2${i}`, hostname: `W1-IPC-ALB-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:22', i), is_placed: true, loc_x: 100 + i * 120, loc_y: 420,
      cpu: 'Intel Core i7-3612QE', ram: '16GB', storage: '240GB SSD',
      os_type: 'Windows 10 IoT', os_version: '2021 LTSC',
      physical_condition: 'good', tags: ['ipc', 'beckhoff'],
      maint_last_date: d(-45), maint_next_date: d(135), maint_interval_days: 180,
      fortiedr_active: true,
    });
  }

  // Assembly Line C — different manufacturer
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`plc_alc_${i}`, {
      display_name: `W1-PLC-ALC-0${i}`, asset_tag: `PLC-ALC-0${i}`, serial_number: `SN-PLC-ALC-0${i}`,
      manufacturer: 'Allen-Bradley', model: 'ControlLogix 5580', asset_type: 'plc', status: i < 3 ? 'active' : 'maintenance',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_alc.id,
      ip_address: `10.1.3.1${i}`, hostname: `W1-PLC-ALC-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:31', i), is_placed: true, loc_x: 80 + i * 90, loc_y: 630,
      physical_condition: i < 3 ? 'good' : 'fair', tags: ['plc', 'allen-bradley'],
      maint_last_date: d(-20), maint_next_date: d(i === 3 ? -5 : 160), maint_interval_days: 180,
      maint_notes: i === 3 ? 'Firmware update required — halted for maintenance window' : null,
    });
  }

  // CNC machines
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`cnc_${i}`, {
      display_name: `W1-CNC-0${i}`, asset_tag: `CNC-W1-0${i}`, serial_number: `SN-CNC-0${i}`,
      manufacturer: 'Fanuc', model: 'ROBODRILL α-D21MiB5', asset_type: 'cnc', status: i < 4 ? 'active' : 'inactive',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_cnc.id, section_id: sec_cnc.id,
      workstation_id: i === 1 ? ws_cnc1.id : undefined,
      ip_address: `10.1.4.1${i}`, hostname: `W1-CNC-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:41', i), is_placed: true, loc_x: 580 + (i - 1) * 70, loc_y: 180,
      physical_condition: i < 3 ? 'good' : 'fair',
      tags: ['cnc', 'fanuc', 'machining'],
      maint_last_date: d(-30 * i), maint_next_date: d(150 - 30 * i), maint_interval_days: 180,
      notes: i === 4 ? 'Spindle bearing replacement pending — taken offline' : null,
    });
  }

  // Robot cells
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`robot_${i}`, {
      display_name: `W1-ROBOT-0${i}`, asset_tag: `ROB-W1-0${i}`, serial_number: `SN-ROB-0${i}`,
      manufacturer: 'KUKA', model: 'KR 210 R3100', asset_type: 'robot', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_robot.id,
      ip_address: `10.1.5.1${i}`, hostname: `W1-ROBOT-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:51', i), is_placed: true, loc_x: 920 + (i - 1) * 80, loc_y: 150,
      physical_condition: 'good', tags: ['robot', 'kuka', 'automation'],
      maint_last_date: d(-14), maint_next_date: d(76), maint_interval_days: 90,
    });
  }

  // KUKA robot controller
  await mkAsset('krc5', {
    display_name: 'W1-KRC5-01', asset_tag: 'KRC-W1-01', serial_number: 'SN-KRC5-01',
    manufacturer: 'KUKA', model: 'KRC5 Controller', asset_type: 'workstation', status: 'active',
    building_id: w1.id, floor_id: w1_gf.id, workarea_id: wa_robot.id,
    ip_address: '10.1.5.2', hostname: 'W1-KRC5-01', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:01:51:02:00', is_placed: true, loc_x: 930, loc_y: 280,
    cpu: 'Intel Core i7', ram: '16GB', storage: '256GB SSD',
    os_type: 'Windows 10 IoT', os_version: '2019 LTSC',
    physical_condition: 'good', tags: ['kuka', 'robot-controller'],
    maint_last_date: d(-14), maint_next_date: d(76), maint_interval_days: 90,
  });

  // Cameras (IP)
  for (let i = 1; i <= 5; i++) {
    await mkAsset(`cam_gf_${i}`, {
      display_name: `W1-CAM-GF-0${i}`, asset_tag: `CAM-GF-0${i}`, serial_number: `SN-CAM-GF-0${i}`,
      manufacturer: 'Axis', model: 'P3245-V', asset_type: 'camera', status: 'active',
      building_id: w1.id, floor_id: w1_gf.id,
      ip_address: `10.1.6.${i}`, hostname: `W1-CAM-GF-0${i}`, vlan: 'CAMERAS', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:61', i), is_placed: true, loc_x: 100 + i * 150, loc_y: 50,
      physical_condition: 'good', tags: ['camera', 'security', 'axis'],
    });
  }

  // Office floor equipment
  await mkAsset('it_printer1', {
    display_name: 'W1-PRN-IT-01', asset_tag: 'PRN-IT-01', serial_number: 'SN-PRN-IT-01',
    manufacturer: 'HP', model: 'LaserJet Enterprise M507dn', asset_type: 'printer', status: 'active',
    building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_it.id, section_id: sec_it.id,
    ip_address: '10.1.2.50', hostname: 'W1-PRN-IT-01', vlan: 'OFFICE', dhcp_static: 'static',
    mac_address: 'AA:BB:01:02:50:01', is_placed: true, loc_x: 80, loc_y: 200,
    tags: ['printer', 'office'], maint_last_date: d(-120), maint_next_date: d(60), maint_interval_days: 180,
  });

  await mkAsset('it_display', {
    display_name: 'W1-KVM-IT-01', asset_tag: 'KVM-IT-01', serial_number: 'SN-KVM-IT-01',
    manufacturer: 'Dell', model: 'UltraSharp 49 U4924DW', asset_type: 'display', status: 'active',
    building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_it.id, section_id: sec_it.id,
    is_placed: true, loc_x: 90, loc_y: 130, physical_condition: 'good', tags: ['display', 'kvm'],
  });

  // IT workstations
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`it_ws_${i}`, {
      display_name: `W1-WS-IT-0${i}`, asset_tag: `WS-IT-0${i}`, serial_number: `SN-WS-IT-0${i}`,
      manufacturer: 'Dell', model: 'Precision 3660', asset_type: 'workstation', status: 'active',
      building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_it.id, section_id: sec_it.id,
      ip_address: `10.1.2.10${i}`, hostname: `W1-WS-IT-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:02:10', i), is_placed: true, loc_x: 80 + i * 60, loc_y: 150,
      cpu: 'Intel Core i9-13900', ram: '32GB', storage: '1TB NVMe',
      os_type: 'Windows 11', os_version: '23H2',
      physical_condition: 'good', tags: ['workstation', 'it', 'office'],
      maint_last_date: d(-30), maint_next_date: d(150), maint_interval_days: 180,
      is_managed: true, source_of_truth: 'itsm', hardware_asset_id: `ITSM-WS-IT-0${i}`,
      itsm_guid: `guid-ws-it-0${i}`, sync_status: 'success', last_synced: d(-1),
      fortiedr_active: true, remote_access_tool: 'TeamViewer', backup_tool: 'Veeam Agent',
      backup_status: 'success', winupdate_date: d(-7),
    });
  }

  // Engineering CAD workstations
  for (let i = 1; i <= 6; i++) {
    await mkAsset(`eng_ws_${i}`, {
      display_name: `W1-WS-ENG-0${i}`, asset_tag: `WS-ENG-0${i}`, serial_number: `SN-WS-ENG-0${i}`,
      manufacturer: 'HP', model: 'Z6 G5 Workstation', asset_type: 'workstation', status: i < 6 ? 'active' : 'maintenance',
      building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_eng.id, section_id: sec_eng.id,
      ip_address: `10.1.2.11${i}`, hostname: `W1-WS-ENG-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:02:11', i), is_placed: true, loc_x: 430 + i * 50, loc_y: 150,
      cpu: 'Intel Xeon W3-2435', ram: '64GB', storage: '2TB NVMe + 4TB HDD', gpu: 'NVIDIA RTX 4000 SFF',
      os_type: 'Windows 11', os_version: '23H2',
      physical_condition: i < 6 ? 'good' : 'fair', tags: ['workstation', 'engineering', 'cad'],
      maint_last_date: d(-30 * i), maint_next_date: d(150 - 20 * i), maint_interval_days: 180,
      fortiedr_active: true, backup_tool: 'Veeam Agent', backup_status: 'success',
      person_full_name: ['Hans Schmidt', 'Maria Kovacs', 'Peter Fischer', 'Julia Weber', 'Thomas Bauer', null][i - 1],
    });
  }

  // Laptops
  for (let i = 1; i <= 5; i++) {
    await mkAsset(`laptop_${i}`, {
      display_name: `W1-LAP-0${i}`, asset_tag: `LAP-W1-0${i}`, serial_number: `SN-LAP-W1-0${i}`,
      manufacturer: 'Lenovo', model: 'ThinkPad T14s Gen 4', asset_type: 'laptop', status: 'active',
      building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_it.id,
      ip_address: null, hostname: `W1-LAP-0${i}`, vlan: 'WIFI', dhcp_static: 'dhcp',
      mac_address: mac('AA:BB:01:04', i), is_placed: false, loc_x: 0, loc_y: 0,
      cpu: 'AMD Ryzen 7 PRO 7840U', ram: '32GB', storage: '1TB NVMe',
      os_type: 'Windows 11', os_version: '23H2',
      physical_condition: 'good', tags: ['laptop', 'mobile'],
      is_managed: true, source_of_truth: 'itsm', hardware_asset_id: `ITSM-LAP-0${i}`,
      itsm_guid: `guid-lap-0${i}`, sync_status: 'success', last_synced: d(-1),
      fortiedr_active: true, remote_access_tool: 'TeamViewer', backup_tool: 'Veeam Agent',
      backup_status: 'success', winupdate_date: d(-3),
      person_full_name: ['Anna Müller', 'Klaus Weber', 'Stefan Braun', 'Christine Vogel', 'Michael Schröder'][i - 1],
    });
  }

  // Management PCs
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`mgmt_ws_${i}`, {
      display_name: `W1-WS-MGT-0${i}`, asset_tag: `WS-MGT-0${i}`, serial_number: `SN-WS-MGT-0${i}`,
      manufacturer: 'Apple', model: 'Mac mini M2 Pro', asset_type: 'workstation', status: 'active',
      building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_mgmt.id,
      ip_address: `10.1.2.15${i}`, hostname: `W1-WS-MGT-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:01:02:15', i), is_placed: true, loc_x: 80 + i * 70, loc_y: 350,
      cpu: 'Apple M2 Pro', ram: '32GB', storage: '512GB SSD',
      os_type: 'macOS', os_version: 'Sonoma 14.4',
      physical_condition: 'good', tags: ['workstation', 'management', 'mac'],
      is_managed: true, source_of_truth: 'itsm', hardware_asset_id: `ITSM-WS-MGT-0${i}`,
      itsm_guid: `guid-ws-mgt-0${i}`, sync_status: 'success', last_synced: d(-1),
    });
  }

  // Conference room display
  await mkAsset('conf_display', {
    display_name: 'W1-DISP-CONF-01', asset_tag: 'DISP-CONF-01', serial_number: 'SN-DISP-CONF-01',
    manufacturer: 'Samsung', model: 'QB98B 98" 4K', asset_type: 'display', status: 'active',
    building_id: w1.id, floor_id: w1_ff.id, workarea_id: wa_conf.id,
    ip_address: '10.1.2.200', hostname: 'W1-DISP-CONF-01', vlan: 'OFFICE', dhcp_static: 'static',
    mac_address: 'AA:BB:01:02:C8:01', is_placed: true, loc_x: 400, loc_y: 330,
    tags: ['display', 'conference'],
  });

  // Retired asset with lifecycle chain (will link later)
  await mkAsset('retired_ws', {
    display_name: 'W1-WS-OBS-01 (RETIRED)', asset_tag: 'OBS-001', serial_number: 'SN-OBS-001',
    manufacturer: 'HP', model: 'Compaq 8200', asset_type: 'workstation', status: 'retired',
    building_id: w1.id, floor_id: w1_gf.id, is_placed: false, loc_x: 0, loc_y: 0,
    physical_condition: 'poor', tags: ['retired', 'decomissioned'],
    notes: 'Replaced by W1-IPC-ALA-01 — returned to IT for recycling',
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WERK2 assets
  // ────────────────────────────────────────────────────────────────────────────
  console.log('   WERK2 assets...');

  await mkAsset('w2_router', {
    display_name: 'W2-RTR-01', asset_tag: 'NET-W2-RTR-01', serial_number: 'SN-W2-RTR-01',
    manufacturer: 'Cisco', model: 'ISR 1101', asset_type: 'router', status: 'active',
    building_id: w2.id, floor_id: w2_gf.id,
    ip_address: '10.2.0.1', hostname: 'W2-RTR-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:02:00:00:01', is_placed: true, loc_x: 600, loc_y: 100,
    tags: ['network', 'router'], maint_last_date: d(-180), maint_next_date: d(185), maint_interval_days: 365,
  });

  await mkAsset('w2_sw_core', {
    display_name: 'W2-SW-CORE-01', asset_tag: 'NET-W2-CSW-01', serial_number: 'SN-W2-CSW-01',
    manufacturer: 'HP', model: 'Aruba 2930F-48G', asset_type: 'switch', status: 'active',
    building_id: w2.id, floor_id: w2_gf.id,
    ip_address: '10.2.0.2', hostname: 'W2-SW-CORE-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:02:00:00:02', is_placed: true, loc_x: 600, loc_y: 160,
    tags: ['network', 'switch', 'core'],
  });

  await mkAsset('w2_sw_stamp', {
    display_name: 'W2-SW-STAMP', asset_tag: 'NET-W2-SW-STAMP', serial_number: 'SN-W2-SW-STAMP',
    manufacturer: 'HP', model: 'Aruba 1930-24G', asset_type: 'switch', status: 'active',
    building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_stamp.id,
    ip_address: '10.2.1.1', hostname: 'W2-SW-STAMP', vlan: 'PROD', dhcp_static: 'static',
    mac_address: 'AA:BB:02:01:01:01', is_placed: true, loc_x: 330, loc_y: 100,
    tags: ['network', 'switch'],
  });

  // Stamping press PLCs + IPCs
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`w2_plc_stamp_${i}`, {
      display_name: `W2-PLC-STAMP-0${i}`, asset_tag: `PLC-STAMP-0${i}`, serial_number: `SN-PLC-STAMP-0${i}`,
      manufacturer: 'Omron', model: 'NX1P2-9024DT', asset_type: 'plc', status: 'active',
      building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_stamp.id, section_id: sec_stamp.id,
      ip_address: `10.2.1.1${i}`, hostname: `W2-PLC-STAMP-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:11', i), is_placed: true, loc_x: 80 + i * 80, loc_y: 130,
      physical_condition: 'good', tags: ['plc', 'omron', 'stamping'],
      maint_last_date: d(-60), maint_next_date: d(120), maint_interval_days: 180,
    });
  }

  for (let i = 1; i <= 2; i++) {
    await mkAsset(`w2_hmi_stamp_${i}`, {
      display_name: `W2-HMI-STAMP-0${i}`, asset_tag: `HMI-STAMP-0${i}`, serial_number: `SN-HMI-STAMP-0${i}`,
      manufacturer: 'Omron', model: 'NA5-15W101', asset_type: 'hmi', status: 'active',
      building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_stamp.id, section_id: sec_stamp.id,
      ip_address: `10.2.1.2${i}`, hostname: `W2-HMI-STAMP-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:12', i), is_placed: true, loc_x: 80 + i * 80, loc_y: 180,
      physical_condition: 'good', tags: ['hmi', 'omron'],
    });
  }

  // Welding PLCs + robots
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`w2_plc_weld_${i}`, {
      display_name: `W2-PLC-WELD-0${i}`, asset_tag: `PLC-WELD-0${i}`, serial_number: `SN-PLC-WELD-0${i}`,
      manufacturer: 'Siemens', model: 'S7-1500F CPU 1517F', asset_type: 'plc', status: 'active',
      building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_weld.id, section_id: sec_weld.id,
      ip_address: `10.2.2.1${i}`, hostname: `W2-PLC-WELD-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:21', i), is_placed: true, loc_x: 420 + i * 70, loc_y: 130,
      physical_condition: 'good', tags: ['plc', 'siemens', 'welding', 'safety'],
      maint_last_date: d(-45), maint_next_date: d(135), maint_interval_days: 180,
    });
  }

  for (let i = 1; i <= 3; i++) {
    await mkAsset(`w2_robot_weld_${i}`, {
      display_name: `W2-ROBOT-WELD-0${i}`, asset_tag: `ROB-WELD-0${i}`, serial_number: `SN-ROB-WELD-0${i}`,
      manufacturer: 'ABB', model: 'IRB 1600-10/1.45', asset_type: 'robot', status: 'active',
      building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_weld.id, section_id: sec_weld.id,
      ip_address: `10.2.2.2${i}`, hostname: `W2-ROBOT-WELD-0${i}`, vlan: 'PROD', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:22', i), is_placed: true, loc_x: 420 + i * 70, loc_y: 200,
      physical_condition: 'good', tags: ['robot', 'abb', 'welding'],
      maint_last_date: d(-14), maint_next_date: d(76), maint_interval_days: 90,
    });
  }

  // Quality lab
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`w2_qlab_ws_${i}`, {
      display_name: `W2-WS-QLAB-0${i}`, asset_tag: `WS-QLAB-0${i}`, serial_number: `SN-WS-QLAB-0${i}`,
      manufacturer: 'Dell', model: 'OptiPlex 7090', asset_type: 'workstation', status: 'active',
      building_id: w2.id, floor_id: w2_gf.id, workarea_id: wa_qlab.id,
      ip_address: `10.2.3.1${i}`, hostname: `W2-WS-QLAB-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:31', i), is_placed: true, loc_x: 80 + i * 70, loc_y: 360,
      cpu: 'Intel Core i7-11700', ram: '16GB', storage: '512GB SSD',
      os_type: 'Windows 11', os_version: '23H2',
      physical_condition: 'good', tags: ['workstation', 'quality'],
      fortiedr_active: true,
    });
  }

  // Planning office + maintenance workshop
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`w2_plan_ws_${i}`, {
      display_name: `W2-WS-PLAN-0${i}`, asset_tag: `WS-PLAN-0${i}`, serial_number: `SN-WS-PLAN-0${i}`,
      manufacturer: 'Lenovo', model: 'ThinkCentre M90q', asset_type: 'workstation', status: 'active',
      building_id: w2.id, floor_id: w2_ff.id, workarea_id: wa_plan.id,
      ip_address: `10.2.4.1${i}`, hostname: `W2-WS-PLAN-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:02:41', i), is_placed: true, loc_x: 80 + i * 60, loc_y: 100,
      cpu: 'Intel Core i5-13600', ram: '16GB', storage: '512GB SSD',
      os_type: 'Windows 11', os_version: '23H2',
      physical_condition: 'good', tags: ['workstation', 'planning'],
      fortiedr_active: true,
    });
  }

  for (let i = 1; i <= 3; i++) {
    await mkAsset(`w2_maint_lap_${i}`, {
      display_name: `W2-LAP-MAINT-0${i}`, asset_tag: `LAP-MAINT-0${i}`, serial_number: `SN-LAP-MAINT-0${i}`,
      manufacturer: 'Panasonic', model: 'Toughbook CF-33', asset_type: 'laptop', status: 'active',
      building_id: w2.id, floor_id: w2_ff.id, workarea_id: wa_maint.id,
      ip_address: null, hostname: `W2-LAP-MAINT-0${i}`, vlan: 'WIFI', dhcp_static: 'dhcp',
      mac_address: mac('AA:BB:02:51', i), is_placed: false, loc_x: 0, loc_y: 0,
      cpu: 'Intel Core i5-10310U', ram: '16GB', storage: '512GB SSD',
      os_type: 'Windows 10', os_version: '22H2',
      physical_condition: 'good', tags: ['laptop', 'ruggedized', 'maintenance'],
      maint_last_date: d(-90), maint_next_date: d(90), maint_interval_days: 180,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // WERK3 assets
  // ────────────────────────────────────────────────────────────────────────────
  console.log('   WERK3 assets...');

  await mkAsset('w3_router', {
    display_name: 'W3-RTR-01', asset_tag: 'NET-W3-RTR-01', serial_number: 'SN-W3-RTR-01',
    manufacturer: 'Cisco', model: 'ISR 1101', asset_type: 'router', status: 'active',
    building_id: w3.id, floor_id: w3_gf.id,
    ip_address: '10.3.0.1', hostname: 'W3-RTR-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:03:00:00:01', is_placed: true, loc_x: 900, loc_y: 100,
    tags: ['network', 'router'],
  });

  await mkAsset('w3_sw_core', {
    display_name: 'W3-SW-CORE-01', asset_tag: 'NET-W3-CSW-01', serial_number: 'SN-W3-CSW-01',
    manufacturer: 'Cisco', model: 'Catalyst 1000-48T', asset_type: 'switch', status: 'active',
    building_id: w3.id, floor_id: w3_gf.id,
    ip_address: '10.3.0.2', hostname: 'W3-SW-CORE-01', vlan: 'MGMT', dhcp_static: 'static',
    mac_address: 'AA:BB:03:00:00:02', is_placed: true, loc_x: 900, loc_y: 160,
    tags: ['network', 'switch'],
  });

  // Barcode scanners / handhelds
  for (let i = 1; i <= 6; i++) {
    await mkAsset(`w3_scanner_${i}`, {
      display_name: `W3-SCAN-0${i}`, asset_tag: `SCAN-W3-0${i}`, serial_number: `SN-SCAN-W3-0${i}`,
      manufacturer: 'Zebra', model: 'TC73 Touch Computer', asset_type: 'scanner', status: i < 5 ? 'active' : 'inactive',
      building_id: w3.id, floor_id: w3_gf.id,
      workarea_id: i <= 3 ? wa_recv.id : wa_ship.id,
      section_id: i <= 3 ? sec_recv.id : sec_ship.id,
      ip_address: null, hostname: `W3-SCAN-0${i}`, vlan: 'WIFI', dhcp_static: 'dhcp',
      mac_address: mac('AA:BB:03:11', i), is_placed: true, loc_x: 100 + i * 100, loc_y: i <= 3 ? 120 : 70,
      physical_condition: i < 5 ? 'good' : 'fair', tags: ['scanner', 'zebra', 'warehouse'],
      maint_last_date: d(-180), maint_next_date: d(185), maint_interval_days: 365,
    });
  }

  // Warehouse terminals (docking stations)
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`w3_terminal_${i}`, {
      display_name: `W3-TERM-0${i}`, asset_tag: `TERM-W3-0${i}`, serial_number: `SN-TERM-W3-0${i}`,
      manufacturer: 'Zebra', model: 'VC8300 Vehicle-Mounted Computer', asset_type: 'terminal', status: 'active',
      building_id: w3.id, floor_id: w3_gf.id, workarea_id: wa_stor.id,
      ip_address: `10.3.1.2${i}`, hostname: `W3-TERM-0${i}`, vlan: 'WIFI', dhcp_static: 'static',
      mac_address: mac('AA:BB:03:12', i), is_placed: true, loc_x: 100 + i * 140, loc_y: 400,
      physical_condition: 'good', tags: ['terminal', 'zebra', 'forklift'],
    });
  }

  // Warehouse workstations
  for (let i = 1; i <= 3; i++) {
    await mkAsset(`w3_ws_${i}`, {
      display_name: `W3-WS-0${i}`, asset_tag: `WS-W3-0${i}`, serial_number: `SN-WS-W3-0${i}`,
      manufacturer: 'Dell', model: 'OptiPlex 3090', asset_type: 'workstation', status: 'active',
      building_id: w3.id, floor_id: w3_gf.id,
      workarea_id: i <= 2 ? wa_recv.id : wa_ship.id,
      section_id: i <= 2 ? sec_recv.id : sec_ship.id,
      ip_address: `10.3.1.1${i}`, hostname: `W3-WS-0${i}`, vlan: 'OFFICE', dhcp_static: 'static',
      mac_address: mac('AA:BB:03:21', i), is_placed: true, loc_x: 100 + i * 80, loc_y: i <= 2 ? 100 : 70,
      cpu: 'Intel Core i5-11500', ram: '8GB', storage: '256GB SSD',
      os_type: 'Windows 10', os_version: '22H2',
      physical_condition: 'good', tags: ['workstation', 'warehouse'],
      fortiedr_active: true,
    });
  }

  // Wi-Fi APs warehouse
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`w3_ap_${i}`, {
      display_name: `W3-AP-0${i}`, asset_tag: `AP-W3-0${i}`, serial_number: `SN-AP-W3-0${i}`,
      manufacturer: 'Cisco', model: 'Catalyst 9130AXI', asset_type: 'access_point', status: 'active',
      building_id: w3.id, floor_id: w3_gf.id,
      ip_address: `10.3.2.${i}`, hostname: `W3-AP-0${i}`, vlan: 'WIFI', dhcp_static: 'static',
      mac_address: mac('AA:BB:03:31', i), is_placed: true, loc_x: 200 + i * 200, loc_y: 50,
      tags: ['wifi', 'ap', 'warehouse'],
    });
  }

  // Cameras
  for (let i = 1; i <= 4; i++) {
    await mkAsset(`w3_cam_${i}`, {
      display_name: `W3-CAM-0${i}`, asset_tag: `CAM-W3-0${i}`, serial_number: `SN-CAM-W3-0${i}`,
      manufacturer: 'Bosch', model: 'FLEXIDOME IP 4000i', asset_type: 'camera', status: 'active',
      building_id: w3.id, floor_id: w3_gf.id,
      ip_address: `10.3.3.${i}`, hostname: `W3-CAM-0${i}`, vlan: 'CAMERAS', dhcp_static: 'static',
      mac_address: mac('AA:BB:03:41', i), is_placed: true, loc_x: 200 + i * 200, loc_y: 540,
      tags: ['camera', 'security', 'bosch'],
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Lifecycle chain: retired_ws → ws_ala_1
  // ────────────────────────────────────────────────────────────────────────────
  A['retired_ws'].successor_id = A['ws_ala_1'].id;
  A['ws_ala_1'].predecessor_id = A['retired_ws'].id;
  await assetRepo.save([A['retired_ws'], A['ws_ala_1']]);

  // ────────────────────────────────────────────────────────────────────────────
  // SOFTWARE
  // ────────────────────────────────────────────────────────────────────────────
  console.log('📦 Adding software...');
  const sw = async (assetKey: string, entries: { name: string; vendor: string; version: string; source?: string }[]) => {
    for (const s of entries) {
      await softwareRepo.save(softwareRepo.create({
        asset_id: A[assetKey].id, display_name: s.name, vendor: s.vendor, version: s.version, source: s.source ?? 'manual',
      }));
    }
  };

  await sw('srv01', [
    { name: 'Windows Server 2022 Standard', vendor: 'Microsoft', version: '21H2', source: 'itsm' },
    { name: 'Active Directory Domain Services', vendor: 'Microsoft', version: '21H2', source: 'itsm' },
    { name: 'VMware ESXi', vendor: 'VMware', version: '8.0 U2', source: 'manual' },
    { name: 'Veeam Backup & Replication', vendor: 'Veeam', version: '12.1', source: 'manual' },
    { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
  ]);

  await sw('srv02', [
    { name: 'Windows Server 2019 Datacenter', vendor: 'Microsoft', version: '1809', source: 'itsm' },
    { name: 'Wonderware Historian', vendor: 'AVEVA', version: '2020 R2', source: 'manual' },
    { name: 'Siemens WinCC SCADA', vendor: 'Siemens', version: '7.5 SP2', source: 'manual' },
    { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
    { name: 'SQL Server 2019', vendor: 'Microsoft', version: '15.0', source: 'itsm' },
  ]);

  await sw('srv03', [
    { name: 'Windows Server 2022 Standard', vendor: 'Microsoft', version: '21H2', source: 'itsm' },
    { name: 'SAP MII (Manufacturing Intelligence)', vendor: 'SAP', version: '15.4', source: 'manual' },
    { name: 'SQL Server 2022', vendor: 'Microsoft', version: '16.0', source: 'itsm' },
    { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
  ]);

  await sw('nas', [
    { name: 'Synology DSM', vendor: 'Synology', version: '7.2.1', source: 'manual' },
    { name: 'Hyper Backup', vendor: 'Synology', version: '4.0', source: 'manual' },
    { name: 'Active Backup for Business', vendor: 'Synology', version: '2.7', source: 'manual' },
  ]);

  await sw('ws_ala_1', [
    { name: 'Windows 10 IoT Enterprise 2021 LTSC', vendor: 'Microsoft', version: '19044', source: 'itsm' },
    { name: 'Siemens TIA Portal', vendor: 'Siemens', version: 'V18', source: 'manual' },
    { name: 'Siemens WinCC Runtime', vendor: 'Siemens', version: '7.5', source: 'manual' },
    { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
    { name: 'TightVNC Server', vendor: 'TightVNC', version: '2.8.81', source: 'manual' },
  ]);

  await sw('ws_ala_2', [
    { name: 'Windows 10 IoT Enterprise 2021 LTSC', vendor: 'Microsoft', version: '19044', source: 'itsm' },
    { name: 'Siemens TIA Portal', vendor: 'Siemens', version: 'V18', source: 'manual' },
    { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
  ]);

  for (let i = 1; i <= 4; i++) {
    await sw(`it_ws_${i}`, [
      { name: 'Windows 11 Pro', vendor: 'Microsoft', version: '23H2', source: 'itsm' },
      { name: 'Microsoft 365 Apps', vendor: 'Microsoft', version: '2402', source: 'itsm' },
      { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
      { name: 'TeamViewer Host', vendor: 'TeamViewer', version: '15.52', source: 'manual' },
      { name: 'Veeam Agent for Windows', vendor: 'Veeam', version: '6.1', source: 'manual' },
    ]);
  }

  for (let i = 1; i <= 6; i++) {
    await sw(`eng_ws_${i}`, [
      { name: 'Windows 11 Pro', vendor: 'Microsoft', version: '23H2', source: 'itsm' },
      { name: 'SolidWorks 2024', vendor: 'Dassault Systèmes', version: 'SP3', source: 'manual' },
      { name: 'AutoCAD 2025', vendor: 'Autodesk', version: '25.0', source: 'manual' },
      { name: 'Microsoft 365 Apps', vendor: 'Microsoft', version: '2402', source: 'itsm' },
      { name: 'FortiEDR Collector', vendor: 'Fortinet', version: '6.2.1', source: 'itsm' },
    ]);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CONNECTIONS — network topology
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🔗 Creating network connections...');

  const connect = async (
    fromKey: string,
    toKey: string,
    type: string,
    label?: string,
    port?: string,
  ) => {
    const conn = connectionRepo.create({
      asset_id: A[fromKey].id,
      connected_asset_id: A[toKey].id,
      connection_type: type,
      label: label ?? undefined,
      bidirectional: true,
      strength: 'normal',
      patch_panel: port ? { switch_port: port } : undefined,
    });
    await connectionRepo.save(conn);
  };

  // WAN backbone: router → firewall → core switch
  await connect('router', 'fw', 'ethernet', 'WAN uplink', 'GE0/0/0');
  await connect('fw', 'core_sw', 'ethernet', 'LAN trunk', 'GE1/0/1');

  // Core switch → distribution switches (fiber uplinks)
  await connect('core_sw', 'dsw_gf', 'fiber', 'GF distribution uplink');
  await connect('core_sw', 'dsw_ff', 'fiber', 'FF distribution uplink');

  // Core switch → servers and NAS
  await connect('core_sw', 'srv01', 'ethernet', 'iDRAC + data', 'GE1/0/10');
  await connect('core_sw', 'srv02', 'ethernet', 'iDRAC + data', 'GE1/0/11');
  await connect('core_sw', 'srv03', 'ethernet', 'iDRAC + data', 'GE1/0/12');
  await connect('core_sw', 'nas', 'ethernet', 'Data / backup', 'GE1/0/13');

  // Distribution GF → access switches per line
  await connect('dsw_gf', 'asw_ala', 'ethernet', 'Line A access', 'GE0/0/1');
  await connect('dsw_gf', 'asw_alb', 'ethernet', 'Line B access', 'GE0/0/2');
  await connect('dsw_gf', 'asw_alc', 'ethernet', 'Line C access', 'GE0/0/3');

  // Distribution FF → office devices
  await connect('dsw_ff', 'it_printer1', 'ethernet', undefined, 'GE0/0/10');

  // APs → distribution switches
  await connect('dsw_gf', 'ap_gf1', 'ethernet', 'PoE AP 1');
  await connect('dsw_gf', 'ap_gf2', 'ethernet', 'PoE AP 2');
  await connect('dsw_ff', 'ap_ff1', 'ethernet', 'PoE AP office');

  // Line A devices → access switch
  for (let i = 1; i <= 4; i++) await connect(`plc_ala_${i}`, 'asw_ala', 'ethernet', `PLC ${i} uplink`);
  for (let i = 1; i <= 3; i++) await connect(`hmi_ala_${i}`, 'asw_ala', 'ethernet', `HMI ${i} uplink`);
  for (let i = 1; i <= 3; i++) await connect(`ws_ala_${i}`, 'asw_ala', 'ethernet', `IPC ${i} uplink`);

  // Line B
  for (let i = 1; i <= 3; i++) await connect(`plc_alb_${i}`, 'asw_alb', 'ethernet', `PLC ${i}`);
  for (let i = 1; i <= 2; i++) await connect(`ws_alb_${i}`, 'asw_alb', 'ethernet', `IPC ${i}`);

  // Line C
  for (let i = 1; i <= 3; i++) await connect(`plc_alc_${i}`, 'asw_alc', 'ethernet', `PLC ${i}`);

  // CNC machines → distribution GF directly (heavy traffic)
  for (let i = 1; i <= 4; i++) await connect(`cnc_${i}`, 'dsw_gf', 'ethernet', `CNC ${i}`);

  // Robots → distribution GF
  for (let i = 1; i <= 3; i++) await connect(`robot_${i}`, 'krc5', 'ethernet', `Robot ${i} → controller`);
  await connect('krc5', 'dsw_gf', 'ethernet', 'KRC5 uplink');

  // IT workstations → FF distribution
  for (let i = 1; i <= 4; i++) await connect(`it_ws_${i}`, 'dsw_ff', 'ethernet', `IT desk ${i}`);
  for (let i = 1; i <= 6; i++) await connect(`eng_ws_${i}`, 'dsw_ff', 'ethernet', `Eng desk ${i}`);
  for (let i = 1; i <= 3; i++) await connect(`mgmt_ws_${i}`, 'dsw_ff', 'ethernet', `Mgmt desk ${i}`);
  await connect('conf_display', 'dsw_ff', 'ethernet', 'Conference display');

  // WERK2 topology
  await connect('w2_router', 'w2_sw_core', 'ethernet', 'LAN trunk');
  await connect('w2_sw_core', 'w2_sw_stamp', 'ethernet', 'Stamping area access');
  for (let i = 1; i <= 3; i++) await connect(`w2_plc_stamp_${i}`, 'w2_sw_stamp', 'ethernet', `Stamp PLC ${i}`);
  for (let i = 1; i <= 2; i++) await connect(`w2_hmi_stamp_${i}`, 'w2_sw_stamp', 'ethernet', `Stamp HMI ${i}`);
  for (let i = 1; i <= 4; i++) await connect(`w2_plc_weld_${i}`, 'w2_sw_core', 'ethernet', `Weld PLC ${i}`);
  for (let i = 1; i <= 3; i++) await connect(`w2_robot_weld_${i}`, 'w2_sw_core', 'ethernet', `Weld robot ${i}`);

  // WERK3 topology
  await connect('w3_router', 'w3_sw_core', 'ethernet', 'LAN trunk');
  for (let i = 1; i <= 4; i++) await connect(`w3_ap_${i}`, 'w3_sw_core', 'ethernet', `PoE AP ${i}`);
  for (let i = 1; i <= 3; i++) await connect(`w3_ws_${i}`, 'w3_sw_core', 'ethernet', `WH desk ${i}`);
  // Scanners and terminals → wifi (represented as wifi connection type)
  for (let i = 1; i <= 6; i++) await connect(`w3_scanner_${i}`, `w3_ap_${((i - 1) % 4) + 1}`, 'wifi', `Scanner ${i}`);
  for (let i = 1; i <= 4; i++) await connect(`w3_terminal_${i}`, `w3_ap_${((i - 1) % 4) + 1}`, 'wifi', `Terminal ${i}`);

  // Cross-building WAN links (WAN/fiber between buildings)
  await connect('router', 'w2_router', 'fiber', 'WERK1↔WERK2 WAN');
  await connect('router', 'w3_router', 'fiber', 'WERK1↔WERK3 WAN');

  const assetCount  = await assetRepo.count();
  const connCount   = await connectionRepo.count();
  const softCount   = await softwareRepo.count();
  console.log('\n✅ Seed complete!');
  console.log(`   Assets    : ${assetCount}`);
  console.log(`   Connections: ${connCount}`);
  console.log(`   Software   : ${softCount}`);
  console.log('   Users      : admin / Admin@1234 · operator / Operator@1234 · viewer / Viewer@1234');

  await AppDataSource.destroy();
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
