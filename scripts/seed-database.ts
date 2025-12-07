/**
 * Database Seed Script
 * Populates the database with test data
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
// In Docker: env vars are provided by docker-compose
// Locally: load from .env file
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.join(__dirname, '../../../.env') });
}

// Import models
import Building from '../models/Building';
import Floor from '../models/Floor';
import WorkArea from '../models/WorkArea';
import Section from '../models/Section';
import Workstation from '../models/Workstation';
import Asset from '../models/Asset';

// Determine MongoDB URI
const getMongoURI = (): string => {
  // If MONGODB_URI is set, use it
  if (process.env.MONGODB_URI) {
    // If running in Docker, replace localhost with mongo
    if (process.env.DOCKER_ENV === 'true') {
      return process.env.MONGODB_URI.replace('localhost', 'mongo');
    }
    return process.env.MONGODB_URI;
  }
  
  // Fallback defaults
  return process.env.DOCKER_ENV === 'true'
    ? 'mongodb://mongo:27017/factorymap'
    : 'mongodb://localhost:27017/factorymap';
};

const MONGODB_URI = getMongoURI();

console.log(`🔗 Connecting to: ${MONGODB_URI}`);

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}


/**
 * Clear all collections
 */
async function clearDatabase() {
  console.log('\n🗑️  Clearing existing data...');
  
  await Asset.deleteMany({});
  await Workstation.deleteMany({});
  await Section.deleteMany({});
  await WorkArea.deleteMany({});
  await Floor.deleteMany({});
  await Building.deleteMany({});
  
  console.log('✅ Database cleared');
}

/**
 * Seed the database
 */
async function seed() {
  console.log('\n🌱 Seeding database...\n');

  // ==========================================
  // BUILDING 1: Gyártócsarnok A
  // ==========================================
  
  const building1 = await Building.create({
    name: '1-es Gyártócsarnok',
    address: 'Gyár utca 1., Budapest',
    metadata: {
      total_area: 5000,
      construction_year: 2010,
    },
  });
  console.log(`✅ Building: ${building1.name}`);

  // Floor 1: Földszint
  const floor1_1 = await Floor.create({
    building_id: building1._id,
    floor_number: 0,
    name: 'Földszint',
    map_file: 'building_1_floor_0.svg',
    map_metadata: {
      viewBox: '0 0 1000 800',
      scale: '1:100',
      bounds: [[0, 0], [1000, 800]],
    },
  });
  console.log(`  ✅ Floor: ${floor1_1.name}`);

  // Work Area 1: Tekercselés
  const workarea1_1 = await WorkArea.create({
    floor_id: floor1_1._id,
    name: 'Tekercselés',
    type: 'production',
    svg_zone_id: 'zone_tekercselesz',
    color: '#4CAF50',
    manager: 'Nagy István',
  });
  console.log(`    ✅ Work Area: ${workarea1_1.name}`);

  // Section 1: A sor
  const section1_1_1 = await Section.create({
    workarea_id: workarea1_1._id,
    name: 'Tekercselő sor A',
    coordinates: { x: 150, y: 150 },
    capacity: 10,
    shift_schedule: '3-shift',
  });
  console.log(`      ✅ Section: ${section1_1_1.name}`);

  // Workstations in Section A (5 db)
  const workstations_a = [];
  for (let i = 1; i <= 5; i++) {
    const ws = await Workstation.create({
      section_id: section1_1_1._id,
      name: `TA-0${i}`,
      coordinates: { x: 160 + i * 50, y: 160 },
      rotation: 0,
      type: 'desk',
      status: 'active',
    });
    workstations_a.push(ws);
    console.log(`        ✅ Workstation: ${ws.name}`);
  }

  // Assets for Section A (3 PCs with ITSM, 2 without)
  const asset1 = await Asset.create({
    hierarchy: {
      building_id: building1._id,
      floor_id: floor1_1._id,
      workarea_id: workarea1_1._id,
      section_id: section1_1_1._id,
      workstation_id: workstations_a[0]._id,
    },
    itsm: {
      hardware_id: 'HW-PC-0001',
      is_managed: true,
      last_synced: new Date(),
      sync_status: 'success',
      sync_errors: [],
    },
    basic_info: {
      display_name: 'Művezetői PC #1',
      asset_tag: 'ASSET-2023-0001',
      serial_number: 'DELL-SN-ABC123',
      model: 'Dell OptiPlex 7090',
      manufacturer: 'Dell',
      status: 'Deployed',
      os_type: 'Windows',
      os_version: '11 Pro',
      mac_address: '00:1A:2B:3C:4D:5E',
    },
    technical_specs: {
      cpu: 'Intel i7-11700',
      ram: '16GB DDR4',
      storage: '512GB NVMe SSD',
    },
    network: {
      ip_address: '192.168.1.101',
      hostname: 'PC-TEKERCS-01',
      vlan: 'VLAN-100',
    },
    assigned_person: {
      person_id: 'PERSON-0001',
      full_name: 'Kovács János',
    },
    software: [
      {
        software_id: 'SW-OFFICE-365',
        display_name: 'Microsoft 365',
        source: 'itsm',
      },
    ],
    location: {
      coordinates: { x: 165, y: 165 },
      rotation: 0,
      icon_type: 'desktop',
      description: '1-es épület, Földszint, Tekercselés, A sor, TA-01',
    },
    custom_fields: {
      physical_condition: 'Good',
      environment: 'Production',
      notes: 'Művezetői munkaállomás',
      tags: ['critical', 'supervisor'],
    },
    created_by: 'seed-script',
  });
  console.log(`          ✅ Asset: ${asset1.basic_info.display_name} (ITSM managed)`);

  const asset2 = await Asset.create({
    hierarchy: {
      building_id: building1._id,
      floor_id: floor1_1._id,
      workarea_id: workarea1_1._id,
      section_id: section1_1_1._id,
      workstation_id: workstations_a[1]._id,
    },
    itsm: {
      hardware_id: 'HW-PC-0002',
      is_managed: true,
      last_synced: new Date(),
      sync_status: 'success',
      sync_errors: [],
    },
    basic_info: {
      display_name: 'Tekercselő PC #1',
      asset_tag: 'ASSET-2023-0002',
      serial_number: 'HP-SN-XYZ456',
      model: 'HP EliteDesk 800 G8',
      manufacturer: 'HP',
      status: 'Deployed',
      os_type: 'Windows',
      os_version: '10 Pro',
      mac_address: '00:1A:2B:3C:4D:5F',
    },
    technical_specs: {
      cpu: 'Intel i5-11500',
      ram: '8GB DDR4',
      storage: '256GB SSD',
    },
    network: {
      ip_address: '192.168.1.102',
      hostname: 'PC-TEKERCS-02',
    },
    assigned_person: {
      person_id: 'PERSON-0002',
      full_name: 'Nagy István',
    },
    location: {
      coordinates: { x: 215, y: 165 },
      rotation: 0,
      icon_type: 'desktop',
    },
    created_by: 'seed-script',
  });
  console.log(`          ✅ Asset: ${asset2.basic_info.display_name} (ITSM managed)`);

  // Manual asset (no ITSM)
  const asset3 = await Asset.create({
    hierarchy: {
      building_id: building1._id,
      floor_id: floor1_1._id,
      workarea_id: workarea1_1._id,
      section_id: section1_1_1._id,
      workstation_id: workstations_a[2]._id,
    },
    itsm: {
      hardware_id: null,
      is_managed: false,
      last_synced: null,
      sync_status: 'never',
      sync_errors: [],
    },
    basic_info: {
      display_name: 'Régi Tekercselő PC',
      model: 'Dell OptiPlex 3060',
      manufacturer: 'Dell',
      status: 'In Use',
    },
    technical_specs: {
      cpu: 'Intel i3-8100',
      ram: '4GB DDR4',
      storage: '128GB SSD',
    },
    network: {
      ip_address: '192.168.1.103',
      hostname: 'PC-TEKERCS-03',
    },
    location: {
      coordinates: { x: 265, y: 165 },
      rotation: 0,
      icon_type: 'desktop',
    },
    custom_fields: {
      physical_condition: 'Fair',
      notes: 'Régi gép, frissítés szükséges',
      tags: ['legacy', 'upgrade-needed'],
    },
    created_by: 'seed-script',
  });
  console.log(`          ✅ Asset: ${asset3.basic_info.display_name} (Manual)`);

  // Section 2: B sor
  const section1_1_2 = await Section.create({
    workarea_id: workarea1_1._id,
    name: 'Tekercselő sor B',
    coordinates: { x: 150, y: 300 },
    capacity: 10,
    shift_schedule: '2-shift',
  });
  console.log(`      ✅ Section: ${section1_1_2.name}`);

  // 3 workstations in Section B
  for (let i = 1; i <= 3; i++) {
    const ws = await Workstation.create({
      section_id: section1_1_2._id,
      name: `TB-0${i}`,
      coordinates: { x: 160 + i * 50, y: 310 },
      rotation: 0,
      type: 'desk',
      status: 'active',
    });
    console.log(`        ✅ Workstation: ${ws.name}`);
  }

  // Work Area 2: Motor gyártás
  const workarea1_2 = await WorkArea.create({
    floor_id: floor1_1._id,
    name: 'Motor gyártás',
    type: 'production',
    svg_zone_id: 'zone_motor',
    color: '#2196F3',
    manager: 'Szabó Péter',
  });
  console.log(`    ✅ Work Area: ${workarea1_2.name}`);

  // Section 1: Motor összeszerelés
  const section1_2_1 = await Section.create({
    workarea_id: workarea1_2._id,
    name: 'Motor összeszerelés',
    coordinates: { x: 500, y: 150 },
    capacity: 8,
    shift_schedule: '3-shift',
  });
  console.log(`      ✅ Section: ${section1_2_1.name}`);

  // 4 workstations
  for (let i = 1; i <= 4; i++) {
    const ws = await Workstation.create({
      section_id: section1_2_1._id,
      name: `MA-0${i}`,
      coordinates: { x: 510 + i * 50, y: 160 },
      rotation: 0,
      type: 'workbench',
      status: 'active',
    });
    console.log(`        ✅ Workstation: ${ws.name}`);
  }

  // ==========================================
  // BUILDING 2: Gyártócsarnok B
  // ==========================================

  const building2 = await Building.create({
    name: '2-es Gyártócsarnok',
    address: 'Gyár utca 2., Budapest',
    metadata: {
      total_area: 3000,
      construction_year: 2015,
    },
  });
  console.log(`\n✅ Building: ${building2.name}`);

  // Floor 1: Földszint
  const floor2_1 = await Floor.create({
    building_id: building2._id,
    floor_number: 0,
    name: 'Földszint',
    map_file: 'building_2_floor_0.svg',
    map_metadata: {
      viewBox: '0 0 800 600',
      scale: '1:100',
      bounds: [[0, 0], [800, 600]],
    },
  });
  console.log(`  ✅ Floor: ${floor2_1.name}`);

  // Work Area: Minőségellenőrzés
  const workarea2_1 = await WorkArea.create({
    floor_id: floor2_1._id,
    name: 'Minőségellenőrzés',
    type: 'quality-control',
    svg_zone_id: 'zone_quality',
    color: '#FF9800',
    manager: 'Kiss Éva',
  });
  console.log(`    ✅ Work Area: ${workarea2_1.name}`);

  // Section: QC Labor
  const section2_1_1 = await Section.create({
    workarea_id: workarea2_1._id,
    name: 'QC Labor',
    coordinates: { x: 150, y: 150 },
    capacity: 5,
    shift_schedule: '1-shift',
  });
  console.log(`      ✅ Section: ${section2_1_1.name}`);

  // 3 workstations
  for (let i = 1; i <= 3; i++) {
    const ws = await Workstation.create({
      section_id: section2_1_1._id,
      name: `QC-0${i}`,
      coordinates: { x: 160 + i * 50, y: 160 },
      rotation: 0,
      type: 'lab-bench',
      status: 'active',
    });
    console.log(`        ✅ Workstation: ${ws.name}`);
  }

  // ==========================================
  // SUMMARY
  // ==========================================

  const counts = {
    buildings: await Building.countDocuments(),
    floors: await Floor.countDocuments(),
    workareas: await WorkArea.countDocuments(),
    sections: await Section.countDocuments(),
    workstations: await Workstation.countDocuments(),
    assets: await Asset.countDocuments(),
  };

  console.log('\n✅ Seed completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   Buildings: ${counts.buildings}`);
  console.log(`   Floors: ${counts.floors}`);
  console.log(`   Work Areas: ${counts.workareas}`);
  console.log(`   Sections: ${counts.sections}`);
  console.log(`   Workstations: ${counts.workstations}`);
  console.log(`   Assets: ${counts.assets}`);
  console.log('');
}

/**
 * Main function
 */
async function main() {
  try {
    await connectDB();
    await clearDatabase();
    await seed();
    
    console.log('✅ All done! Disconnecting...\n');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run
main();