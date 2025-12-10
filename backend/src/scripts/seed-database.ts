import mongoose from 'mongoose';
import Building from '../models/Building';
import Floor from '../models/Floor';
import WorkArea from '../models/WorkArea';
import Section from '../models/Section';
import Workstation from '../models/Workstation';
import Asset from '../models/Asset';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongodb:27017/factory-map';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await Promise.all([
      Building.deleteMany({}),
      Floor.deleteMany({}),
      WorkArea.deleteMany({}),
      Section.deleteMany({}),
      Workstation.deleteMany({}),
      Asset.deleteMany({}),
    ]);
    console.log('✅ Existing data cleared');

    // ==================== BUILDING 1: Main Production Facility ====================
    console.log('🏢 Creating Building 1: Main Production Facility...');
    const building1 = await Building.create({
      name: 'Main Production Facility',
      address: '1234 Industrial Parkway, Manufacturing District',
      metadata: {
        total_area: 15000,
        year_built: 2018,
        num_floors: 3,
      },
    });

    // Floor 0 - Ground Floor (Production)
    const floor0 = await Floor.create({
      building_id: building1._id,
      floor_number: 0,
      name: 'Ground Floor - Main Production',
      metadata: {
        area: 5000,
        ceiling_height: 6.5,
      },
    });

    // Work Area 1: Assembly Line A
    const workarea1 = await WorkArea.create({
      floor_id: floor0._id,
      name: 'Assembly Line A',
      type: 'Production',
      coordinates: { x: 100, y: 150 },
      dimensions: { width: 350, height: 200 },
      metadata: {
        supervisor: 'John Martinez',
        capacity: 25,
      },
    });

    // Sections in Assembly Line A
    const section1 = await Section.create({
      workarea_id: workarea1._id,
      name: 'Pre-Assembly',
      shift_schedule: '3-shift',
      capacity: 8,
      coordinates: { x: 120, y: 180 },
    });

    const section2 = await Section.create({
      workarea_id: workarea1._id,
      name: 'Main Assembly',
      shift_schedule: '3-shift',
      capacity: 12,
      coordinates: { x: 250, y: 180 },
    });

    const section3 = await Section.create({
      workarea_id: workarea1._id,
      name: 'Final Assembly',
      shift_schedule: '3-shift',
      capacity: 5,
      coordinates: { x: 380, y: 180 },
    });

    // Workstations in sections
    const workstations1 = await Workstation.insertMany([
      { section_id: section1._id, name: 'WS-A1', type: 'Workbench', status: 'active', coordinates: { x: 130, y: 200 } },
      { section_id: section1._id, name: 'WS-A2', type: 'Workbench', status: 'active', coordinates: { x: 180, y: 200 } },
      { section_id: section2._id, name: 'WS-B1', type: 'Assembly Station', status: 'active', coordinates: { x: 260, y: 200 } },
      { section_id: section2._id, name: 'WS-B2', type: 'Assembly Station', status: 'active', coordinates: { x: 310, y: 200 } },
      { section_id: section3._id, name: 'WS-C1', type: 'Inspection', status: 'active', coordinates: { x: 390, y: 200 } },
    ]);

    // Work Area 2: Quality Control
    const workarea2 = await WorkArea.create({
      floor_id: floor0._id,
      name: 'Quality Control',
      type: 'Testing',
      coordinates: { x: 550, y: 150 },
      dimensions: { width: 280, height: 200 },
      metadata: {
        supervisor: 'Sarah Chen',
        capacity: 12,
      },
    });

    const section4 = await Section.create({
      workarea_id: workarea2._id,
      name: 'Incoming Inspection',
      shift_schedule: 'Day shift',
      capacity: 5,
      coordinates: { x: 570, y: 180 },
    });

    const section5 = await Section.create({
      workarea_id: workarea2._id,
      name: 'Final Testing',
      shift_schedule: 'Day shift',
      capacity: 7,
      coordinates: { x: 690, y: 180 },
    });

    const workstations2 = await Workstation.insertMany([
      { section_id: section4._id, name: 'QC-01', type: 'Test Station', status: 'active', coordinates: { x: 580, y: 200 } },
      { section_id: section4._id, name: 'QC-02', type: 'Test Station', status: 'active', coordinates: { x: 630, y: 200 } },
      { section_id: section5._id, name: 'QC-03', type: 'Test Station', status: 'active', coordinates: { x: 700, y: 200 } },
      { section_id: section5._id, name: 'QC-04', type: 'Test Station', status: 'maintenance', coordinates: { x: 750, y: 200 } },
    ]);

    // Work Area 3: Packaging
    const workarea3 = await WorkArea.create({
      floor_id: floor0._id,
      name: 'Packaging & Shipping',
      type: 'Logistics',
      coordinates: { x: 100, y: 400 },
      dimensions: { width: 730, height: 180 },
      metadata: {
        supervisor: 'Mike Johnson',
        capacity: 15,
      },
    });

    const section6 = await Section.create({
      workarea_id: workarea3._id,
      name: 'Packaging',
      shift_schedule: '2-shift',
      capacity: 10,
      coordinates: { x: 150, y: 450 },
    });

    const section7 = await Section.create({
      workarea_id: workarea3._id,
      name: 'Shipping Prep',
      shift_schedule: 'Day shift',
      capacity: 5,
      coordinates: { x: 500, y: 450 },
    });

// Packaging workstations - HOZZÁAD az assets creation ELŐTT
const workstations3 = await Workstation.insertMany([
  { section_id: section6._id, name: 'PKG-1', type: 'Packing Station', status: 'active', coordinates: { x: 170, y: 480 } },
  { section_id: section6._id, name: 'PKG-2', type: 'Packing Station', status: 'active', coordinates: { x: 250, y: 480 } },
  { section_id: section6._id, name: 'PKG-3', type: 'Packing Station', status: 'active', coordinates: { x: 330, y: 480 } },
  { section_id: section7._id, name: 'SHIP-1', type: 'Loading Dock', status: 'active', coordinates: { x: 520, y: 480 } },
  { section_id: section7._id, name: 'SHIP-2', type: 'Loading Dock', status: 'active', coordinates: { x: 650, y: 480 } },
]);

console.log(`✅ Created ${workstations3.length} workstations for Packaging`); // ← ADD THIS LINE

    // Assets for Ground Floor
    const assets1 = await Asset.insertMany([
      // Assembly Line A assets
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor0._id,
          workarea_id: workarea1._id,
          section_id: section1._id,
          workstation_id: workstations1[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-001', sync_status: 'success' },
        basic_info: {
          display_name: 'Assembly PC-01',
          asset_tag: 'AST-001',
          serial_number: 'SN-2024-001',
          model: 'OptiPlex 7090',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        location: {
          coordinates: { x: 140, y: 210 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-101', full_name: 'Alice Thompson' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor0._id,
          workarea_id: workarea1._id,
          section_id: section1._id,
          workstation_id: workstations1[1]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-002', sync_status: 'success' },
        basic_info: {
          display_name: 'Assembly PC-02',
          asset_tag: 'AST-002',
          serial_number: 'SN-2024-002',
          model: 'OptiPlex 7090',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        location: {
          coordinates: { x: 190, y: 210 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-102', full_name: 'Bob Williams' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor0._id,
          workarea_id: workarea1._id,
          section_id: section2._id,
          workstation_id: workstations1[2]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-003', sync_status: 'success' },
        basic_info: {
          display_name: 'Assembly PC-03',
          asset_tag: 'AST-003',
          serial_number: 'SN-2024-003',
          model: 'ThinkCentre M720',
          manufacturer: 'Lenovo',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        location: {
          coordinates: { x: 270, y: 210 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-103', full_name: 'Carol Davis' },
      },
      // Quality Control assets
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor0._id,
          workarea_id: workarea2._id,
          section_id: section4._id,
          workstation_id: workstations2[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-010', sync_status: 'success' },
        basic_info: {
          display_name: 'QC-Testing-01',
          asset_tag: 'AST-010',
          serial_number: 'SN-2024-010',
          model: 'Precision 3650',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        location: {
          coordinates: { x: 590, y: 210 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-201', full_name: 'David Martinez' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor0._id,
          workarea_id: workarea2._id,
          section_id: section4._id,
          workstation_id: workstations2[1]._id,
        },
        itsm: { is_managed: false },
        basic_info: {
          display_name: 'QC-Testing-02',
          asset_tag: 'AST-011',
          serial_number: 'SN-2024-011',
          model: 'Precision 3650',
          manufacturer: 'Dell',
          status: 'Active',
        },
        location: {
          coordinates: { x: 640, y: 210 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-202', full_name: 'Emma Wilson' },
      },
    ]);

    console.log(`✅ Created Ground Floor with ${assets1.length} assets`);

    // Floor 1 - First Floor (Office & Engineering)
    const floor1 = await Floor.create({
      building_id: building1._id,
      floor_number: 1,
      name: 'First Floor - Engineering & Administration',
      metadata: {
        area: 5000,
        ceiling_height: 3.5,
      },
    });

    // Work Area 4: Engineering Office
    const workarea4 = await WorkArea.create({
      floor_id: floor1._id,
      name: 'Engineering Department',
      type: 'Office',
      coordinates: { x: 100, y: 150 },
      dimensions: { width: 400, height: 250 },
      metadata: {
        supervisor: 'Lisa Anderson',
        capacity: 30,
      },
    });

    const section8 = await Section.create({
      workarea_id: workarea4._id,
      name: 'Mechanical Engineering',
      shift_schedule: 'Day shift',
      capacity: 15,
      coordinates: { x: 150, y: 200 },
    });

    const section9 = await Section.create({
      workarea_id: workarea4._id,
      name: 'Electrical Engineering',
      shift_schedule: 'Day shift',
      capacity: 15,
      coordinates: { x: 350, y: 200 },
    });

    const workstations4 = await Workstation.insertMany([
      { section_id: section8._id, name: 'DESK-E01', type: 'Engineering Desk', status: 'active', coordinates: { x: 170, y: 230 } },
      { section_id: section8._id, name: 'DESK-E02', type: 'Engineering Desk', status: 'active', coordinates: { x: 220, y: 230 } },
      { section_id: section8._id, name: 'DESK-E03', type: 'Engineering Desk', status: 'active', coordinates: { x: 270, y: 230 } },
      { section_id: section9._id, name: 'DESK-E04', type: 'Engineering Desk', status: 'active', coordinates: { x: 370, y: 230 } },
      { section_id: section9._id, name: 'DESK-E05', type: 'Engineering Desk', status: 'active', coordinates: { x: 420, y: 230 } },
    ]);

    // Work Area 5: Administration
    const workarea5 = await WorkArea.create({
      floor_id: floor1._id,
      name: 'Administration',
      type: 'Office',
      coordinates: { x: 550, y: 150 },
      dimensions: { width: 280, height: 250 },
      metadata: {
        supervisor: 'Jennifer Brown',
        capacity: 20,
      },
    });

    const section10 = await Section.create({
      workarea_id: workarea5._id,
      name: 'HR & Finance',
      shift_schedule: 'Day shift',
      capacity: 10,
      coordinates: { x: 600, y: 200 },
    });

    const section11 = await Section.create({
      workarea_id: workarea5._id,
      name: 'Executive Offices',
      shift_schedule: 'Day shift',
      capacity: 10,
      coordinates: { x: 720, y: 200 },
    });

    const workstations5 = await Workstation.insertMany([
      { section_id: section10._id, name: 'DESK-A01', type: 'Office Desk', status: 'active', coordinates: { x: 620, y: 230 } },
      { section_id: section10._id, name: 'DESK-A02', type: 'Office Desk', status: 'active', coordinates: { x: 670, y: 230 } },
      { section_id: section11._id, name: 'EXEC-01', type: 'Executive Office', status: 'active', coordinates: { x: 740, y: 230 } },
    ]);

    // Assets for First Floor
    const assets2 = await Asset.insertMany([
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor1._id,
          workarea_id: workarea4._id,
          section_id: section8._id,
          workstation_id: workstations4[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-020', sync_status: 'success' },
        basic_info: {
          display_name: 'ENG-WS-01',
          asset_tag: 'AST-020',
          serial_number: 'SN-2024-020',
          model: 'Precision 5820',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        technical_specs: {
          cpu: 'Intel Xeon W-2245',
          ram: '64GB DDR4',
          storage: '1TB NVMe SSD',
          gpu: 'NVIDIA Quadro RTX 4000',
        },
        location: {
          coordinates: { x: 180, y: 240 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-301', full_name: 'Frank Garcia' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor1._id,
          workarea_id: workarea4._id,
          section_id: section8._id,
          workstation_id: workstations4[1]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-021', sync_status: 'success' },
        basic_info: {
          display_name: 'ENG-WS-02',
          asset_tag: 'AST-021',
          serial_number: 'SN-2024-021',
          model: 'Precision 5820',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        technical_specs: {
          cpu: 'Intel Xeon W-2245',
          ram: '64GB DDR4',
          storage: '1TB NVMe SSD',
          gpu: 'NVIDIA Quadro RTX 4000',
        },
        location: {
          coordinates: { x: 230, y: 240 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-302', full_name: 'Grace Lee' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor1._id,
          workarea_id: workarea5._id,
          section_id: section10._id,
          workstation_id: workstations5[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-030', sync_status: 'success' },
        basic_info: {
          display_name: 'ADMIN-PC-01',
          asset_tag: 'AST-030',
          serial_number: 'SN-2024-030',
          model: 'OptiPlex 7090',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '11 Pro',
        },
        location: {
          coordinates: { x: 630, y: 240 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-401', full_name: 'Hannah Taylor' },
      },
    ]);

    console.log(`✅ Created First Floor with ${assets2.length} assets`);

    // Floor 2 - Second Floor (Storage & Maintenance)
    const floor2 = await Floor.create({
      building_id: building1._id,
      floor_number: 2,
      name: 'Second Floor - Storage & Maintenance',
      metadata: {
        area: 5000,
        ceiling_height: 5.0,
      },
    });

    // Work Area 6: Main Storage
    const workarea6 = await WorkArea.create({
      floor_id: floor2._id,
      name: 'Main Storage',
      type: 'Storage',
      coordinates: { x: 100, y: 150 },
      dimensions: { width: 730, height: 200 },
      metadata: {
        supervisor: 'Kevin White',
        capacity: 8,
      },
    });

    const section12 = await Section.create({
      workarea_id: workarea6._id,
      name: 'Raw Materials',
      shift_schedule: 'Day shift',
      capacity: 4,
      coordinates: { x: 200, y: 200 },
    });

    const section13 = await Section.create({
      workarea_id: workarea6._id,
      name: 'Finished Goods',
      shift_schedule: 'Day shift',
      capacity: 4,
      coordinates: { x: 550, y: 200 },
    });

    const workstations6 = await Workstation.insertMany([
      { section_id: section12._id, name: 'STRG-01', type: 'Storage Station', status: 'active', coordinates: { x: 220, y: 230 } },
      { section_id: section13._id, name: 'STRG-02', type: 'Storage Station', status: 'active', coordinates: { x: 570, y: 230 } },
    ]);

    // Work Area 7: Maintenance
    const workarea7 = await WorkArea.create({
      floor_id: floor2._id,
      name: 'Maintenance Workshop',
      type: 'Maintenance',
      coordinates: { x: 100, y: 400 },
      dimensions: { width: 400, height: 180 },
      metadata: {
        supervisor: 'Larry Rodriguez',
        capacity: 10,
      },
    });

    const section14 = await Section.create({
      workarea_id: workarea7._id,
      name: 'Equipment Repair',
      shift_schedule: '2-shift',
      capacity: 10,
      coordinates: { x: 250, y: 450 },
    });

    const workstations7 = await Workstation.insertMany([
      { section_id: section14._id, name: 'MAINT-01', type: 'Repair Bench', status: 'active', coordinates: { x: 270, y: 480 } },
      { section_id: section14._id, name: 'MAINT-02', type: 'Repair Bench', status: 'active', coordinates: { x: 360, y: 480 } },
    ]);

    // Assets for Second Floor
    const assets3 = await Asset.insertMany([
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor2._id,
          workarea_id: workarea6._id,
          section_id: section12._id,
          workstation_id: workstations6[0]._id,
        },
        itsm: { is_managed: false },
        basic_info: {
          display_name: 'Storage-Terminal-01',
          asset_tag: 'AST-040',
          serial_number: 'SN-2024-040',
          model: 'Tablet T14',
          manufacturer: 'Lenovo',
          status: 'Active',
        },
        location: {
          coordinates: { x: 230, y: 240 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-501', full_name: 'Ivan Petrov' },
      },
      {
        hierarchy: {
          building_id: building1._id,
          floor_id: floor2._id,
          workarea_id: workarea7._id,
          section_id: section14._id,
          workstation_id: workstations7[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-050', sync_status: 'success' },
        basic_info: {
          display_name: 'Maintenance-PC-01',
          asset_tag: 'AST-050',
          serial_number: 'SN-2024-050',
          model: 'OptiPlex 7090',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Windows',
          os_version: '10 Pro',
        },
        location: {
          coordinates: { x: 280, y: 490 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-601', full_name: 'Julia Kim' },
      },
    ]);

    console.log(`✅ Created Second Floor with ${assets3.length} assets`);

    // ==================== BUILDING 2: Research & Development Center ====================
    console.log('🏢 Creating Building 2: Research & Development Center...');
    const building2 = await Building.create({
      name: 'Research & Development Center',
      address: '5678 Innovation Boulevard, Tech Park',
      metadata: {
        total_area: 8000,
        year_built: 2020,
        num_floors: 2,
      },
    });

    // Floor 0 - R&D Labs
    const floor3 = await Floor.create({
      building_id: building2._id,
      floor_number: 0,
      name: 'Ground Floor - Research Labs',
      metadata: {
        area: 4000,
        ceiling_height: 4.0,
      },
    });

    // Work Area 8: Electronics Lab
    const workarea8 = await WorkArea.create({
      floor_id: floor3._id,
      name: 'Electronics Research Lab',
      type: 'Laboratory',
      coordinates: { x: 150, y: 200 },
      dimensions: { width: 350, height: 200 },
      metadata: {
        supervisor: 'Dr. Maria Santos',
        capacity: 15,
      },
    });

    const section15 = await Section.create({
      workarea_id: workarea8._id,
      name: 'Circuit Design',
      shift_schedule: 'Day shift',
      capacity: 8,
      coordinates: { x: 200, y: 250 },
    });

    const section16 = await Section.create({
      workarea_id: workarea8._id,
      name: 'PCB Fabrication',
      shift_schedule: 'Day shift',
      capacity: 7,
      coordinates: { x: 380, y: 250 },
    });

    const workstations8 = await Workstation.insertMany([
      { section_id: section15._id, name: 'LAB-E01', type: 'Research Workstation', status: 'active', coordinates: { x: 220, y: 280 } },
      { section_id: section15._id, name: 'LAB-E02', type: 'Research Workstation', status: 'active', coordinates: { x: 290, y: 280 } },
      { section_id: section16._id, name: 'LAB-E03', type: 'Fabrication Station', status: 'active', coordinates: { x: 400, y: 280 } },
    ]);

    // Work Area 9: Software Lab
    const workarea9 = await WorkArea.create({
      floor_id: floor3._id,
      name: 'Software Development Lab',
      type: 'Laboratory',
      coordinates: { x: 550, y: 200 },
      dimensions: { width: 300, height: 200 },
      metadata: {
        supervisor: 'Dr. Nathan Park',
        capacity: 20,
      },
    });

    const section17 = await Section.create({
      workarea_id: workarea9._id,
      name: 'Software Engineering',
      shift_schedule: 'Flexible',
      capacity: 20,
      coordinates: { x: 650, y: 250 },
    });

    const workstations9 = await Workstation.insertMany([
      { section_id: section17._id, name: 'DEV-01', type: 'Developer Workstation', status: 'active', coordinates: { x: 600, y: 280 } },
      { section_id: section17._id, name: 'DEV-02', type: 'Developer Workstation', status: 'active', coordinates: { x: 670, y: 280 } },
      { section_id: section17._id, name: 'DEV-03', type: 'Developer Workstation', status: 'active', coordinates: { x: 740, y: 280 } },
    ]);

    // Assets for R&D Building
    const assets4 = await Asset.insertMany([
      {
        hierarchy: {
          building_id: building2._id,
          floor_id: floor3._id,
          workarea_id: workarea8._id,
          section_id: section15._id,
          workstation_id: workstations8[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-100', sync_status: 'success' },
        basic_info: {
          display_name: 'LAB-WS-E01',
          asset_tag: 'AST-100',
          serial_number: 'SN-2024-100',
          model: 'Precision 7920',
          manufacturer: 'Dell',
          status: 'Active',
          os_type: 'Linux',
          os_version: 'Ubuntu 22.04',
        },
        technical_specs: {
          cpu: 'Intel Xeon Gold 6248R',
          ram: '128GB DDR4',
          storage: '2TB NVMe SSD',
          gpu: 'NVIDIA RTX A6000',
        },
        location: {
          coordinates: { x: 230, y: 290 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-701', full_name: 'Oscar Chen' },
      },
      {
        hierarchy: {
          building_id: building2._id,
          floor_id: floor3._id,
          workarea_id: workarea9._id,
          section_id: section17._id,
          workstation_id: workstations9[0]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-110', sync_status: 'success' },
        basic_info: {
          display_name: 'DEV-MacBook-01',
          asset_tag: 'AST-110',
          serial_number: 'SN-2024-110',
          model: 'MacBook Pro 16"',
          manufacturer: 'Apple',
          status: 'Active',
          os_type: 'macOS',
          os_version: 'Sonoma 14.2',
        },
        technical_specs: {
          cpu: 'Apple M3 Max',
          ram: '64GB',
          storage: '2TB SSD',
        },
        location: {
          coordinates: { x: 610, y: 290 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-801', full_name: 'Patricia Wu' },
      },
      {
        hierarchy: {
          building_id: building2._id,
          floor_id: floor3._id,
          workarea_id: workarea9._id,
          section_id: section17._id,
          workstation_id: workstations9[1]._id,
        },
        itsm: { is_managed: true, hardware_id: 'HW-111', sync_status: 'success' },
        basic_info: {
          display_name: 'DEV-MacBook-02',
          asset_tag: 'AST-111',
          serial_number: 'SN-2024-111',
          model: 'MacBook Pro 16"',
          manufacturer: 'Apple',
          status: 'Active',
          os_type: 'macOS',
          os_version: 'Sonoma 14.2',
        },
        technical_specs: {
          cpu: 'Apple M3 Max',
          ram: '64GB',
          storage: '2TB SSD',
        },
        location: {
          coordinates: { x: 680, y: 290 },
          rotation: 0,
          icon_type: 'computer',
        },
        assigned_person: { person_id: 'EMP-802', full_name: 'Quincy Adams' },
      },
    ]);

    console.log(`✅ Created R&D Building with ${assets4.length} assets`);

    // Summary
    console.log('\n📊 Seeding Summary:');
    console.log(`✅ Buildings: 2`);
    console.log(`✅ Floors: 4`);
    console.log(`✅ Work Areas: 9`);
    console.log(`✅ Sections: 17`);
    console.log(`✅ Workstations: ${await Workstation.countDocuments()}`);
    console.log(`✅ Assets: ${await Asset.countDocuments()}`);
    console.log('\n🎉 Seed completed successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();