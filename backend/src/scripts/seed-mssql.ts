/**
 * seed-mssql.ts — Factory Map demo seed.
 *
 * Run inside the backend container:
 *   docker exec factory-map-backend npx ts-node src/scripts/seed-mssql.ts
 *
 * Creates a complete test environment that exercises every feature:
 *   Users · Buildings/Floors/WorkAreas/Sections
 *   Network rooms · Racks · Patch panels · Wall ports
 *   Rack-mounted assets (switch, servers, UPS) with U positions
 *   Floor assets (workstations, HMIs, laptops) connected to wall ports
 *   AssetConnections with source_port/target_port between rack devices
 *   Maintenance dates and custom fields
 *
 * WARNING: Deletes ALL existing data. Never run against production.
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Building }       from '../entities/Building.entity';
import { Floor }          from '../entities/Floor.entity';
import { WorkArea }       from '../entities/WorkArea.entity';
import { Section }        from '../entities/Section.entity';
import { Asset }          from '../entities/Asset.entity';
import { AssetSoftware }  from '../entities/AssetSoftware.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { User }           from '../entities/User.entity';
import { NetworkRoom }    from '../entities/NetworkRoom.entity';
import { NetworkRack }    from '../entities/NetworkRack.entity';
import { PatchPanel }     from '../entities/PatchPanel.entity';
import { WallPort }       from '../entities/WallPort.entity';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server');

  // ── 1. Clear all tables ────────────────────────────────────────────────────
  console.log('\n🗑️  Clearing existing data...');
  const del = (t: string) =>
    AppDataSource.query(`IF OBJECT_ID(N'${t}',N'U') IS NOT NULL DELETE FROM [${t}]`);
  await del('asset_software');
  await del('asset_connections');
  await del('wall_ports');
  await del('patch_panels');
  await del('network_racks');
  await del('network_rooms');
  await del('assets');
  await del('workstations');
  await del('sections');
  await del('work_areas');
  await del('floors');
  await del('buildings');
  await del('audit_logs');
  await del('alert_logs');
  await del('scheduled_alerts');
  await del('active_sessions');
  await del('users');
  console.log('   ✓ Cleared');

  const bRepo   = AppDataSource.getRepository(Building);
  const fRepo   = AppDataSource.getRepository(Floor);
  const waRepo  = AppDataSource.getRepository(WorkArea);
  const secRepo = AppDataSource.getRepository(Section);
  const aRepo   = AppDataSource.getRepository(Asset);
  const swRepo  = AppDataSource.getRepository(AssetSoftware);
  const cRepo   = AppDataSource.getRepository(AssetConnection);
  const uRepo   = AppDataSource.getRepository(User);
  const nrRepo  = AppDataSource.getRepository(NetworkRoom);
  const rkRepo  = AppDataSource.getRepository(NetworkRack);
  const ppRepo  = AppDataSource.getRepository(PatchPanel);
  const wpRepo  = AppDataSource.getRepository(WallPort);

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log('\n👤 Creating users...');
  const admin    = await uRepo.save(uRepo.create({ username: 'admin',    password: 'Admin@1234',    role: 'admin',    email: 'admin@factory.local',    active: true }));
  const operator = await uRepo.save(uRepo.create({ username: 'operator', password: 'Operator@1234', role: 'operator', email: 'operator@factory.local', active: true }));
  await uRepo.save(uRepo.create({ username: 'viewer', password: 'Viewer@1234', role: 'viewer', email: 'viewer@factory.local', active: true }));
  console.log('   admin/Admin@1234 · operator/Operator@1234 · viewer/Viewer@1234');

  // ── 3. Building ────────────────────────────────────────────────────────────
  console.log('\n🏭 Creating WERK1...');
  const werk1 = await bRepo.save(bRepo.create({
    name: 'WERK1 — Main Production',
    address: 'Industriestraße 1, 45678 Musterstadt',
    metadata: { total_area_m2: 8000, year_built: 2015, manager: 'Klaus Weber', floors: 2 },
  }));

  // ── 4. Floors ──────────────────────────────────────────────────────────────
  console.log('\n🏢 Creating floors...');
  const basement = await fRepo.save(fRepo.create({
    building_id: werk1.id, name: 'Basement — Server Room', floor_number: 0,
    svg_background: null,
  }));
  const groundFloor = await fRepo.save(fRepo.create({
    building_id: werk1.id, name: 'Ground Floor — Production', floor_number: 1,
    svg_background: null,
  }));
  const firstFloor = await fRepo.save(fRepo.create({
    building_id: werk1.id, name: 'First Floor — Management', floor_number: 2,
    svg_background: null,
  }));

  // ── 5. Work Areas ──────────────────────────────────────────────────────────
  console.log('\n📐 Creating work areas...');
  const wa_serverRoom = await waRepo.save(waRepo.create({
    floor_id: basement.id, name: 'Main Server Room',
    type: 'server_room', coord_x: 50, coord_y: 50, dim_width: 400, dim_height: 300,
  }));
  const wa_assemblyA = await waRepo.save(waRepo.create({
    floor_id: groundFloor.id, name: 'Assembly Line A',
    type: 'Production', coord_x: 50, coord_y: 50, dim_width: 420, dim_height: 220,
  }));
  const wa_assemblyB = await waRepo.save(waRepo.create({
    floor_id: groundFloor.id, name: 'Assembly Line B',
    type: 'Production', coord_x: 50, coord_y: 320, dim_width: 420, dim_height: 220,
  }));
  const wa_itOffice = await waRepo.save(waRepo.create({
    floor_id: groundFloor.id, name: 'IT / Control Office',
    type: 'Office', coord_x: 530, coord_y: 50, dim_width: 280, dim_height: 200,
  }));
  const wa_mgmt = await waRepo.save(waRepo.create({
    floor_id: firstFloor.id, name: 'Management Office',
    type: 'Office', coord_x: 50, coord_y: 50, dim_width: 380, dim_height: 220,
  }));
  const wa_conf = await waRepo.save(waRepo.create({
    floor_id: firstFloor.id, name: 'Conference Room',
    type: 'Meeting', coord_x: 50, coord_y: 320, dim_width: 260, dim_height: 180,
  }));

  // ── 6. Sections ────────────────────────────────────────────────────────────
  console.log('\n📦 Creating sections...');
  const sec_a1 = await secRepo.save(secRepo.create({ workarea_id: wa_assemblyA.id, name: 'Station A1', coord_x: 60, coord_y: 60, capacity: 4 }));
  const sec_a2 = await secRepo.save(secRepo.create({ workarea_id: wa_assemblyA.id, name: 'Station A2', coord_x: 240, coord_y: 60, capacity: 4 }));
  const sec_b1 = await secRepo.save(secRepo.create({ workarea_id: wa_assemblyB.id, name: 'Station B1', coord_x: 60, coord_y: 330, capacity: 4 }));
  const sec_b2 = await secRepo.save(secRepo.create({ workarea_id: wa_assemblyB.id, name: 'Station B2', coord_x: 240, coord_y: 330, capacity: 4 }));

  // ── 7. Network Infrastructure ──────────────────────────────────────────────
  console.log('\n🌐 Creating network infrastructure...');

  // Network room in the basement
  const idf01 = await nrRepo.save(nrRepo.create({
    name: 'IDF-01 — Main Server Room',
    type: 'mdf',
    building_id: werk1.id,
    floor_id: basement.id,
    description: 'Main distribution frame, core infrastructure',
  }));

  // Ground floor IDF (small closet)
  const idf02 = await nrRepo.save(nrRepo.create({
    name: 'IDF-02 — Ground Floor Closet',
    type: 'idf',
    building_id: werk1.id,
    floor_id: groundFloor.id,
    description: 'Intermediate distribution, production floor',
  }));

  // Racks
  const rack01 = await rkRepo.save(rkRepo.create({
    name: 'RACK-01 — Core',
    network_room_id: idf01.id,
    u_count: 42,
    description: 'Core network and servers',
  }));
  const rack02 = await rkRepo.save(rkRepo.create({
    name: 'RACK-02 — Floor IDF',
    network_room_id: idf02.id,
    u_count: 12,
    description: 'Access switches for production floor',
  }));

  // Patch panels
  const pp01 = await ppRepo.save(ppRepo.create({
    name: 'PP-01',
    rack_id: rack01.id,
    u_position: 7,
    port_count: 24,
    cable_type: 'copper',
    description: 'Ground floor drops',
  }));
  const pp02 = await ppRepo.save(ppRepo.create({
    name: 'PP-02',
    rack_id: rack01.id,
    u_position: 8,
    port_count: 24,
    cable_type: 'copper',
    description: 'First floor drops',
  }));
  const pp03 = await ppRepo.save(ppRepo.create({
    name: 'PP-03',
    rack_id: rack02.id,
    u_position: 1,
    port_count: 12,
    cable_type: 'copper',
    description: 'Floor IDF patch panel',
  }));

  // ── 8. Rack-mounted assets ─────────────────────────────────────────────────
  console.log('\n🗄️  Creating rack-mounted assets...');

  const mkRack = (
    name: string, type: string, rack_id: string,
    u_position: number, rack_u_size: number,
    extra: Partial<Asset> = {}
  ) => aRepo.create({
    building_id: werk1.id, floor_id: basement.id,
    rack_id, u_position, rack_u_size,
    display_name: name, asset_type: type,
    status: 'active', is_placed: true,
    loc_x: 0, loc_y: 0,
    ...extra,
  });

  const coreSwitch = await aRepo.save(mkRack(
    'Core-Switch-01', 'switch', rack01.id, 1, 2,
    { manufacturer: 'Cisco', model: 'Catalyst 2960-X', mac_address: 'AA:BB:CC:00:01:01', ip_address: '10.0.0.1', vlan: 'VLAN1' }
  ));
  const server01 = await aRepo.save(mkRack(
    'Server-01 (Prod)', 'server', rack01.id, 4, 2,
    { manufacturer: 'Dell', model: 'PowerEdge R750', serial_number: 'SRV0001', cpu: 'Intel Xeon Silver 4316', ram: '128 GB', storage: '4 × 1.8 TB SAS', os_type: 'Linux', os_version: 'Ubuntu 22.04 LTS', ip_address: '10.0.0.10' }
  ));
  const server02 = await aRepo.save(mkRack(
    'Server-02 (Dev)', 'server', rack01.id, 7, 2,
    { manufacturer: 'Dell', model: 'PowerEdge R650', serial_number: 'SRV0002', cpu: 'Intel Xeon Bronze 3206R', ram: '64 GB', storage: '2 × 900 GB SAS', os_type: 'Linux', os_version: 'Debian 12', ip_address: '10.0.0.11' }
  ));
  const nas01 = await aRepo.save(mkRack(
    'NAS-01 (Backup)', 'nas', rack01.id, 10, 2,
    { manufacturer: 'Synology', model: 'RS1619xs+', serial_number: 'NAS0001', storage: '4 × 8 TB HDD', ip_address: '10.0.0.20' }
  ));
  const ups01 = await aRepo.save(mkRack(
    'UPS-01', 'ups', rack01.id, 40, 2,
    { manufacturer: 'APC', model: 'Smart-UPS 3000VA', serial_number: 'UPS0001' }
  ));
  const accessSwitch01 = await aRepo.save(aRepo.create({
    building_id: werk1.id, floor_id: groundFloor.id,
    rack_id: rack02.id, u_position: 2, rack_u_size: 1,
    display_name: 'Access-Switch-01', asset_type: 'switch',
    manufacturer: 'Cisco', model: 'Catalyst 2960', ip_address: '10.0.0.2',
    status: 'active', is_placed: true, loc_x: 0, loc_y: 0,
  }));

  // ── 9. Wall ports ──────────────────────────────────────────────────────────
  console.log('\n🔌 Creating wall ports...');

  const mkWp = (
    label: string, floor_id: string, pos_x: number, pos_y: number,
    patchPanelId: string, patchPort: number,
    switchAssetId: string, switchPort: string,
  ) => wpRepo.create({
    label, floor_id, pos_x, pos_y,
    patch_panel_id: patchPanelId,
    patch_port: patchPort,
    switch_asset_id: switchAssetId,
    switch_port: switchPort,
    description: `Drop → ${patchPanelId} port ${patchPort}`,
  });

  const wp_gf_01 = await wpRepo.save(mkWp('WP-GF-01', groundFloor.id, 120, 90,  pp01.id, 1,  coreSwitch.id, 'Gi1/0/1'));
  const wp_gf_02 = await wpRepo.save(mkWp('WP-GF-02', groundFloor.id, 290, 90,  pp01.id, 2,  coreSwitch.id, 'Gi1/0/2'));
  const wp_gf_03 = await wpRepo.save(mkWp('WP-GF-03', groundFloor.id, 120, 360, pp01.id, 3,  coreSwitch.id, 'Gi1/0/3'));
  const wp_gf_04 = await wpRepo.save(mkWp('WP-GF-04', groundFloor.id, 290, 360, pp01.id, 4,  coreSwitch.id, 'Gi1/0/4'));
  const wp_gf_05 = await wpRepo.save(mkWp('WP-GF-05', groundFloor.id, 580, 90,  pp01.id, 5,  coreSwitch.id, 'Gi1/0/5'));
  const wp_gf_06 = await wpRepo.save(mkWp('WP-GF-06', groundFloor.id, 700, 90,  pp01.id, 6,  coreSwitch.id, 'Gi1/0/6'));

  const wp_ff_01 = await wpRepo.save(mkWp('WP-FF-01', firstFloor.id, 120, 90,  pp02.id, 1,  coreSwitch.id, 'Gi1/0/17'));
  const wp_ff_02 = await wpRepo.save(mkWp('WP-FF-02', firstFloor.id, 290, 90,  pp02.id, 2,  coreSwitch.id, 'Gi1/0/18'));
  const wp_ff_03 = await wpRepo.save(mkWp('WP-FF-03', firstFloor.id, 120, 360, pp02.id, 3,  coreSwitch.id, 'Gi1/0/19'));

  // ── 10. Floor assets ───────────────────────────────────────────────────────
  console.log('\n💻 Creating floor assets...');

  const mkFloor = (
    name: string, type: string, floorId: string, workareaId: string | null, sectionId: string | null,
    x: number, y: number, wallPortId: string | null,
    extra: Partial<Asset> = {}
  ) => aRepo.create({
    building_id: werk1.id, floor_id: floorId,
    workarea_id: workareaId, section_id: sectionId,
    display_name: name, asset_type: type,
    status: 'active', is_placed: true,
    loc_x: x, loc_y: y,
    wall_port_id: wallPortId,
    ...extra,
  });

  // Assembly Line A — Station A1
  const pc_a1_1 = await aRepo.save(mkFloor(
    'PC-A1-001', 'workstation', groundFloor.id, wa_assemblyA.id, sec_a1.id, 100, 100, wp_gf_01.id,
    { manufacturer: 'HP', model: 'EliteDesk 800 G6', serial_number: 'WS001', mac_address: 'AA:BB:CC:00:02:01', ip_address: '10.0.1.101', asset_tag: 'TAG-0101', maint_next_date: day(15), maint_interval_days: 180, assigned_person_name: 'Franz Müller' }
  ));
  const hmi_a1 = await aRepo.save(mkFloor(
    'HMI-A1-001', 'hmi', groundFloor.id, wa_assemblyA.id, sec_a1.id, 180, 100, null,
    { manufacturer: 'Siemens', model: 'SIMATIC HMI TP1200', serial_number: 'HMI001', ip_address: '10.0.1.150', asset_tag: 'TAG-0102', maint_next_date: day(45) }
  ));

  // Assembly Line A — Station A2
  const pc_a2_1 = await aRepo.save(mkFloor(
    'PC-A2-001', 'workstation', groundFloor.id, wa_assemblyA.id, sec_a2.id, 280, 100, wp_gf_02.id,
    { manufacturer: 'HP', model: 'EliteDesk 800 G6', serial_number: 'WS002', mac_address: 'AA:BB:CC:00:02:02', ip_address: '10.0.1.102', asset_tag: 'TAG-0103', maint_next_date: day(30), maint_interval_days: 180 }
  ));
  const plc_a2 = await aRepo.save(mkFloor(
    'PLC-A2-001', 'plc', groundFloor.id, wa_assemblyA.id, sec_a2.id, 360, 100, null,
    { manufacturer: 'Siemens', model: 'S7-1500', serial_number: 'PLC001', ip_address: '10.0.1.200', asset_tag: 'TAG-0104', maint_next_date: day(-5) }
  ));

  // Assembly Line B
  const pc_b1 = await aRepo.save(mkFloor(
    'PC-B1-001', 'workstation', groundFloor.id, wa_assemblyB.id, sec_b1.id, 100, 370, wp_gf_03.id,
    { manufacturer: 'Lenovo', model: 'ThinkCentre M90q', serial_number: 'WS003', mac_address: 'AA:BB:CC:00:02:03', ip_address: '10.0.1.103', asset_tag: 'TAG-0201', maint_next_date: day(60) }
  ));
  const pc_b2 = await aRepo.save(mkFloor(
    'PC-B2-001', 'workstation', groundFloor.id, wa_assemblyB.id, sec_b2.id, 280, 370, wp_gf_04.id,
    { manufacturer: 'Lenovo', model: 'ThinkCentre M90q', serial_number: 'WS004', mac_address: 'AA:BB:CC:00:02:04', ip_address: '10.0.1.104', asset_tag: 'TAG-0202' }
  ));
  const robot_b = await aRepo.save(mkFloor(
    'ROBOT-B-001', 'robot', groundFloor.id, wa_assemblyB.id, null, 200, 420, null,
    { manufacturer: 'KUKA', model: 'KR AGILUS KR 6 R700', serial_number: 'ROB001', ip_address: '10.0.1.250', asset_tag: 'TAG-0203', maint_next_date: day(-30), maint_interval_days: 90 }
  ));

  // IT Office
  const pc_it = await aRepo.save(mkFloor(
    'PC-IT-001', 'laptop', groundFloor.id, wa_itOffice.id, null, 580, 100, wp_gf_05.id,
    { manufacturer: 'Dell', model: 'Latitude 5540', serial_number: 'LT001', mac_address: 'AA:BB:CC:00:03:01', ip_address: '10.0.1.50', asset_tag: 'TAG-0301', os_type: 'Windows', os_version: 'Windows 11 Pro', assigned_person_name: 'Anna Schmidt' }
  ));
  const printer_it = await aRepo.save(mkFloor(
    'Printer-IT-001', 'printer', groundFloor.id, wa_itOffice.id, null, 700, 150, wp_gf_06.id,
    { manufacturer: 'HP', model: 'LaserJet Pro MFP M428fdn', serial_number: 'PRT001', ip_address: '10.0.1.60', asset_tag: 'TAG-0302' }
  ));

  // First floor
  const pc_mgmt1 = await aRepo.save(mkFloor(
    'PC-MGMT-001', 'workstation', firstFloor.id, wa_mgmt.id, null, 100, 100, wp_ff_01.id,
    { manufacturer: 'Apple', model: 'Mac mini M2', serial_number: 'MM001', mac_address: 'AA:BB:CC:00:04:01', ip_address: '10.0.2.101', asset_tag: 'TAG-0401', os_type: 'macOS', os_version: 'Ventura 13.6', assigned_person_name: 'Petra Koch' }
  ));
  const pc_mgmt2 = await aRepo.save(mkFloor(
    'PC-MGMT-002', 'laptop', firstFloor.id, wa_mgmt.id, null, 250, 100, wp_ff_02.id,
    { manufacturer: 'Lenovo', model: 'ThinkPad X1 Carbon', serial_number: 'LT002', mac_address: 'AA:BB:CC:00:04:02', ip_address: '10.0.2.102', asset_tag: 'TAG-0402', os_type: 'Windows', os_version: 'Windows 11 Pro', assigned_person_name: 'Markus Bauer' }
  ));
  const display_conf = await aRepo.save(mkFloor(
    'Display-CONF-001', 'display', firstFloor.id, wa_conf.id, null, 120, 370, wp_ff_03.id,
    { manufacturer: 'Samsung', model: '65" Smart Signage QM65B', serial_number: 'DSP001', asset_tag: 'TAG-0501' }
  ));

  // ── 11. Software ───────────────────────────────────────────────────────────
  console.log('\n📦 Adding software...');
  const sw = (assetId: string, name: string, version: string) =>
    swRepo.create({ asset_id: assetId, display_name: name, version, source: 'local', license_type: 'commercial', install_date: day(-90) });
  await swRepo.save([
    sw(pc_a1_1.id, 'Windows 11 Pro', '22H2'),
    sw(pc_a1_1.id, 'SAP GUI', '7.70'),
    sw(pc_a1_1.id, 'Siemens TIA Portal', 'V18'),
    sw(pc_a2_1.id, 'Windows 11 Pro', '22H2'),
    sw(pc_a2_1.id, 'SAP GUI', '7.70'),
    sw(pc_it.id, 'Windows 11 Pro', '22H2'),
    sw(pc_it.id, 'Visual Studio Code', '1.85'),
    sw(pc_it.id, 'Cisco Packet Tracer', '8.2'),
    sw(server01.id, 'Ubuntu Server', '22.04 LTS'),
    sw(server01.id, 'Docker Engine', '25.0'),
    sw(server02.id, 'Debian', '12 Bookworm'),
    sw(server02.id, 'PostgreSQL', '16'),
  ]);

  // ── 12. Asset connections (with ports) ────────────────────────────────────
  console.log('\n🔗 Creating asset connections...');

  const conn = (
    fromId: string, toId: string,
    type: string,
    srcPort: string | null, dstPort: string | null,
    label?: string,
  ) => cRepo.create({
    asset_id: fromId,
    connected_asset_id: toId,
    connection_type: type,
    bidirectional: true,
    strength: 'normal',
    source_port: srcPort,
    target_port: dstPort,
    label: label ?? null,
  });

  // Core switch → servers (intra-rack patch cables)
  await cRepo.save(conn(coreSwitch.id, server01.id,       'ethernet',  'Gi0/1',  'eth0', 'prod link'));
  await cRepo.save(conn(coreSwitch.id, server02.id,       'ethernet',  'Gi0/2',  'eth0', 'dev link'));
  await cRepo.save(conn(coreSwitch.id, nas01.id,          'ethernet',  'Gi0/3',  'eth0', 'backup'));
  await cRepo.save(conn(coreSwitch.id, accessSwitch01.id, 'ethernet',  'Gi0/24', 'Gi0/1', 'floor uplink'));
  await cRepo.save(conn(server01.id,   server02.id,       'ethernet',  'eth1',   'eth1',  'storage VLAN'));
  await cRepo.save(conn(server01.id,   nas01.id,          'ethernet',  'eth2',   'eth1',  'backup replication'));
  await cRepo.save(conn(ups01.id,      server01.id,       'power',     null,     null,    'UPS feed'));
  await cRepo.save(conn(ups01.id,      server02.id,       'power',     null,     null,    'UPS feed'));
  await cRepo.save(conn(ups01.id,      coreSwitch.id,     'power',     null,     null,    'UPS feed'));

  // Floor device → switch (via access-switch in IDF-02)
  await cRepo.save(conn(pc_a1_1.id,   coreSwitch.id,     'ethernet',  'eth0',   'Gi1/0/1', 'via WP-GF-01'));
  await cRepo.save(conn(pc_a2_1.id,   coreSwitch.id,     'ethernet',  'eth0',   'Gi1/0/2', 'via WP-GF-02'));
  await cRepo.save(conn(pc_b1.id,     coreSwitch.id,     'ethernet',  'eth0',   'Gi1/0/3', 'via WP-GF-03'));
  await cRepo.save(conn(pc_b2.id,     coreSwitch.id,     'ethernet',  'eth0',   'Gi1/0/4', 'via WP-GF-04'));
  await cRepo.save(conn(pc_it.id,     coreSwitch.id,     'ethernet',  'eth0',   'Gi1/0/5', 'via WP-GF-05'));

  // PLC → HMI
  await cRepo.save(conn(plc_a2.id,    hmi_a1.id,         'ethernet',  'X1',     'eth0',    'PLC-HMI link'));

  // Management → servers (logical)
  await cRepo.save(conn(pc_mgmt1.id,  server01.id,       'network',   null,     null,      'RDP access'));
  await cRepo.save(conn(pc_it.id,     server02.id,       'network',   null,     null,      'SSH admin'));

  // ── 13. Summary ────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Building : WERK1 — Main Production');
  console.log('  Floors   : Basement · Ground Floor · First Floor');
  console.log('  Rooms    : IDF-01 (MDF basement) · IDF-02 (ground IDF)');
  console.log('  Racks    : RACK-01 (42U, core) · RACK-02 (12U, floor)');
  console.log('  Panels   : PP-01 (24p, ground drops) · PP-02 (24p, 1st floor) · PP-03 (12p, floor IDF)');
  console.log('  Wall ports: 6 × ground floor · 3 × first floor');
  console.log('  Rack assets: Core-Switch-01 (U1) · Server-01 (U4) · Server-02 (U7) · NAS-01 (U10) · UPS-01 (U40) · Access-Switch-01');
  console.log('  Floor assets: 11 (workstations, HMI, PLC, robot, laptop, printer, display, Mac)');
  console.log('  Connections: 18 with source_port/target_port');
  console.log('  Users    : admin/Admin@1234 · operator/Operator@1234 · viewer/Viewer@1234');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n🔍 Trace example: PC-A1-001 → WP-GF-01 → PP-01 port 1 → RACK-01 → IDF-01 → Core-Switch-01 Gi1/0/1');

  await AppDataSource.destroy();
}

seed().catch(e => { console.error(e); process.exit(1); });
