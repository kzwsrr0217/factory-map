/**
 * seed-mssql.ts — Development/demo database seeder for SQL Server.
 *
 * Run with: `npx ts-node src/scripts/seed-mssql.ts`
 * Or via:   `npm run seed` (if configured in package.json)
 *
 * What it does:
 *   1. Clears all existing rows in dependency order (asset_software →
 *      asset_connections → assets → workstations → sections → workareas →
 *      floors → buildings → audit_logs → users).
 *   2. Creates a default admin user (username: admin, password: Admin@1234).
 *   3. Seeds one building with two floors, four work areas, several sections
 *      and workstations, and ~20 sample assets with full metadata.
 *   4. Wires sample asset connections and software entries.
 *
 * WARNING: This script deletes ALL existing data. Never run against production.
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
import { User } from '../entities/User.entity';

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server');

  const buildingRepo = AppDataSource.getRepository(Building);
  const floorRepo = AppDataSource.getRepository(Floor);
  const waRepo = AppDataSource.getRepository(WorkArea);
  const sectionRepo = AppDataSource.getRepository(Section);
  const wsRepo = AppDataSource.getRepository(Workstation);
  const assetRepo = AppDataSource.getRepository(Asset);
  const softwareRepo = AppDataSource.getRepository(AssetSoftware);
  const userRepo = AppDataSource.getRepository(User);

  console.log('🗑️  Clearing existing data...');
  await AppDataSource.query('DELETE FROM asset_software');
  await AppDataSource.query('DELETE FROM asset_connections');
  await AppDataSource.query('DELETE FROM assets');
  await AppDataSource.query('DELETE FROM workstations');
  await AppDataSource.query('DELETE FROM sections');
  await AppDataSource.query('DELETE FROM work_areas');
  await AppDataSource.query('DELETE FROM floors');
  await AppDataSource.query('DELETE FROM buildings');
  await AppDataSource.query('DELETE FROM users');
  console.log('✅ Cleared');

  // ── Admin user ─────────────────────────────────────────────────────────────
  console.log('👤 Creating admin user...');
  const admin = userRepo.create({ username: 'admin', password: 'Admin@1234', role: 'admin', email: 'admin@factory.local', active: true });
  await userRepo.save(admin);
  const viewer = userRepo.create({ username: 'viewer', password: 'Viewer@1234', role: 'viewer', active: true });
  await userRepo.save(viewer);
  console.log('   admin / Admin@1234   (role: admin)');
  console.log('   viewer / Viewer@1234 (role: viewer)');

  // ── Building 1: Main Production Facility ──────────────────────────────────
  console.log('🏢 Creating Building 1...');
  const b1 = buildingRepo.create({ name: 'Main Production Facility', address: '1234 Industrial Parkway', metadata: { total_area: 15000, year_built: 2018 } });
  await buildingRepo.save(b1);

  const f0 = floorRepo.create({ building_id: b1.id, floor_number: 0, name: 'Ground Floor - Production' });
  await floorRepo.save(f0);

  const wa1 = waRepo.create({ floor_id: f0.id, name: 'Assembly Line A', type: 'Production', coord_x: 100, coord_y: 150, dim_width: 350, dim_height: 200 });
  await waRepo.save(wa1);

  const wa2 = waRepo.create({ floor_id: f0.id, name: 'Quality Control', type: 'QA', coord_x: 500, coord_y: 150, dim_width: 250, dim_height: 200 });
  await waRepo.save(wa2);

  const sec1 = sectionRepo.create({ workarea_id: wa1.id, name: 'Station Alpha', coord_x: 120, coord_y: 170, capacity: 6 });
  await sectionRepo.save(sec1);

  const ws1 = wsRepo.create({ section_id: sec1.id, name: 'WS-001', type: 'operator', coord_x: 130, coord_y: 180 });
  await wsRepo.save(ws1);

  // Floor 1
  const f1 = floorRepo.create({ building_id: b1.id, floor_number: 1, name: 'First Floor - Offices' });
  await floorRepo.save(f1);

  const waOff = waRepo.create({ floor_id: f1.id, name: 'IT Department', type: 'Office', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 200 });
  await waRepo.save(waOff);

  const secIT = sectionRepo.create({ workarea_id: waOff.id, name: 'IT Helpdesk', coord_x: 60, coord_y: 60 });
  await sectionRepo.save(secIT);

  // ── Building 2: Warehouse ──────────────────────────────────────────────────
  console.log('🏢 Creating Building 2...');
  const b2 = buildingRepo.create({ name: 'Warehouse & Logistics', address: '1240 Industrial Parkway', metadata: { total_area: 8000 } });
  await buildingRepo.save(b2);

  const fW = floorRepo.create({ building_id: b2.id, floor_number: 0, name: 'Ground Floor' });
  await floorRepo.save(fW);

  const waW1 = waRepo.create({ floor_id: fW.id, name: 'Receiving Dock', type: 'Logistics', coord_x: 50, coord_y: 50, dim_width: 300, dim_height: 150 });
  await waRepo.save(waW1);

  // ── Assets ────────────────────────────────────────────────────────────────
  console.log('💻 Creating mock assets...');

  const assets: Partial<Asset>[] = [
    // Production workstations
    { display_name: 'PLC Controller A1', asset_tag: 'PLC-001', serial_number: 'SN-PLC-001', manufacturer: 'Siemens', model: 'S7-1500', asset_type: 'plc', status: 'active', building_id: b1.id, floor_id: f0.id, workarea_id: wa1.id, section_id: sec1.id, loc_x: 150, loc_y: 200, is_placed: true, is_managed: true, hardware_asset_id: 'ITSM-001', itsm_guid: 'guid-001', source_of_truth: 'itsm', sync_status: 'success', last_synced: new Date() },
    { display_name: 'Assembly PC Alpha', asset_tag: 'WS-A01', serial_number: 'SN-WS-A01', manufacturer: 'Dell', model: 'OptiPlex 7090', asset_type: 'workstation', status: 'active', building_id: b1.id, floor_id: f0.id, workarea_id: wa1.id, section_id: sec1.id, loc_x: 200, loc_y: 200, is_placed: true, ip_address: '10.0.1.11', hostname: 'PROD-WS-001', cpu: 'Intel Core i7-11700', ram: '16GB', storage: '512GB SSD', is_managed: false, source_of_truth: 'local', sync_status: 'never' },
    { display_name: 'QC Inspection Station', asset_tag: 'QC-001', serial_number: 'SN-QC-001', manufacturer: 'HP', model: 'EliteDesk 800', asset_type: 'workstation', status: 'active', building_id: b1.id, floor_id: f0.id, workarea_id: wa2.id, loc_x: 550, loc_y: 200, is_placed: true, ip_address: '10.0.1.21', hostname: 'QC-WS-001', is_managed: false, source_of_truth: 'local', sync_status: 'never' },
    // IT office
    { display_name: 'IT Server 01', asset_tag: 'SRV-001', serial_number: 'SN-SRV-001', manufacturer: 'Dell', model: 'PowerEdge R740', asset_type: 'server', status: 'active', building_id: b1.id, floor_id: f1.id, workarea_id: waOff.id, loc_x: 100, loc_y: 100, is_placed: true, ip_address: '10.0.0.1', hostname: 'PROD-SRV-01', cpu: 'Intel Xeon Silver 4208', ram: '64GB', storage: '4TB RAID', is_managed: true, hardware_asset_id: 'ITSM-SRV-001', itsm_guid: 'guid-srv-001', source_of_truth: 'itsm', sync_status: 'success', last_synced: new Date() },
    { display_name: 'IT Helpdesk PC', asset_tag: 'HD-001', serial_number: 'SN-HD-001', manufacturer: 'Lenovo', model: 'ThinkCentre M80', asset_type: 'workstation', status: 'active', building_id: b1.id, floor_id: f1.id, workarea_id: waOff.id, section_id: secIT.id, loc_x: 80, loc_y: 80, is_placed: true, ip_address: '10.0.2.10', hostname: 'IT-HD-001', is_managed: false, source_of_truth: 'local', sync_status: 'never' },
    // Laptop (unplaced)
    { display_name: 'Maintenance Laptop', asset_tag: 'LAP-001', serial_number: 'SN-LAP-001', manufacturer: 'Dell', model: 'Latitude 5520', asset_type: 'laptop', status: 'active', building_id: b1.id, floor_id: f1.id, loc_x: 0, loc_y: 0, is_placed: false, is_managed: true, hardware_asset_id: 'ITSM-LAP-001', itsm_guid: 'guid-lap-001', source_of_truth: 'itsm', sync_status: 'success', last_synced: new Date() },
    // Warehouse
    { display_name: 'Warehouse Terminal', asset_tag: 'WH-001', serial_number: 'SN-WH-001', manufacturer: 'Zebra', model: 'TC52', asset_type: 'terminal', status: 'active', building_id: b2.id, floor_id: fW.id, workarea_id: waW1.id, loc_x: 100, loc_y: 100, is_placed: true, is_managed: false, source_of_truth: 'local', sync_status: 'never' },
    // Maintenance / retired
    { display_name: 'Old Production PC', asset_tag: 'OBS-001', serial_number: 'SN-OBS-001', manufacturer: 'HP', model: 'Compaq 8200', asset_type: 'workstation', status: 'retired', building_id: b1.id, floor_id: f0.id, loc_x: 0, loc_y: 0, is_placed: false, is_managed: false, source_of_truth: 'local', sync_status: 'never' },
    { display_name: 'Network Switch Core', asset_tag: 'NET-001', serial_number: 'SN-NET-001', manufacturer: 'Cisco', model: 'Catalyst 2960', asset_type: 'network', status: 'active', building_id: b1.id, floor_id: f1.id, workarea_id: waOff.id, loc_x: 200, loc_y: 150, is_placed: true, is_managed: true, hardware_asset_id: 'ITSM-NET-001', itsm_guid: 'guid-net-001', source_of_truth: 'itsm', sync_status: 'success', last_synced: new Date() },
    { display_name: 'Barcode Scanner Line A', asset_tag: 'BC-001', serial_number: 'SN-BC-001', manufacturer: 'Honeywell', model: 'Granit 1910i', asset_type: 'peripheral', status: 'active', building_id: b1.id, floor_id: f0.id, workarea_id: wa1.id, loc_x: 180, loc_y: 220, is_placed: true, is_managed: false, source_of_truth: 'local', sync_status: 'never' },
  ];

  const savedAssets: Asset[] = [];
  for (const a of assets) {
    const entity = assetRepo.create({ ...a, source_of_truth: a.source_of_truth ?? 'local', sync_status: a.sync_status ?? 'never' });
    await assetRepo.save(entity);
    savedAssets.push(entity);
  }

  // Add software to some assets
  const serverAsset = savedAssets.find((a) => a.asset_type === 'server');
  if (serverAsset) {
    const sw = [
      { display_name: 'Windows Server 2022', vendor: 'Microsoft', version: '21H2', source: 'itsm' },
      { display_name: 'SQL Server 2022', vendor: 'Microsoft', version: '16.0', source: 'itsm' },
      { display_name: 'Veeam Agent', vendor: 'Veeam', version: '6.0', source: 'manual' },
    ];
    for (const s of sw) {
      await softwareRepo.save(softwareRepo.create({ asset_id: serverAsset.id, display_name: s.display_name, vendor: s.vendor, version: s.version, source: s.source }));
    }
  }

  const wsAsset = savedAssets.find((a) => a.hostname === 'PROD-WS-001');
  if (wsAsset) {
    const sw = [
      { display_name: 'Windows 11 Pro', vendor: 'Microsoft', version: '23H2', source: 'itsm' },
      { display_name: 'Chrome', vendor: 'Google', version: '123.0', source: 'manual' },
      { display_name: 'WinCC SCADA', vendor: 'Siemens', version: '7.5', source: 'manual' },
    ];
    for (const s of sw) {
      await softwareRepo.save(softwareRepo.create({ asset_id: wsAsset.id, display_name: s.display_name, vendor: s.vendor, version: s.version, source: s.source }));
    }
  }

  // Predecessor / successor lifecycle chain example
  const retiredAsset = savedAssets.find((a) => a.status === 'retired');
  const newWsAsset = savedAssets.find((a) => a.hostname === 'PROD-WS-001');
  if (retiredAsset && newWsAsset) {
    retiredAsset.successor_id = newWsAsset.id;
    newWsAsset.predecessor_id = retiredAsset.id;
    await assetRepo.save([retiredAsset, newWsAsset]);
  }

  const assetCount = await assetRepo.count();
  console.log(`✅ Seed complete: 2 buildings, ${assetCount} assets, 2 users`);
  await AppDataSource.destroy();
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
