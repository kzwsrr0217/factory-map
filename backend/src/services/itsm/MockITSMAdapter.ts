/**
 * MockITSMAdapter.ts — In-memory ITSM adapter for development and demos.
 *
 * Simulates an ITSM API without requiring a real ITSM system. The mock data
 * is Hungarian factory-themed (matching the seed data) so imported assets look
 * realistic during demos.
 *
 * Behaviour:
 *   - All methods add a 200 ms artificial delay (`mockDelay`) to simulate
 *     network latency.
 *   - `searchHardware` searches name, serial, asset_tag, model, and itsm_id.
 *   - `syncAsset` resolves person, software, and tickets in a single call,
 *     returning an `IITSMSyncResult` with success/error envelope.
 *   - `syncAll` returns the full hardware array (no pagination needed in mock).
 *   - `buildTicketUrl` returns a localhost mock-UI link.
 *
 * To add more mock devices: append entries to `this.mockDatabase.hardware`
 * inside `initializeMockData()`.
 */

import { IITSMAdapter } from './IITSMAdapter';
import {
  IITSMHardware,
  IITSMPerson,
  IITSMSoftware,
  IITSMTicket,
  IITSMSyncResult,
} from '../../types/itsm.types';

export class MockITSMAdapter implements IITSMAdapter {
  private mockDelay = 200;

  private mockDatabase = {
    hardware: [] as IITSMHardware[],
    persons: [] as IITSMPerson[],
    software: [] as IITSMSoftware[],
    tickets: [] as IITSMTicket[],
  };

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData(): void {
    this.mockDatabase.persons = [
      { person_id: 'PERSON-GUID-001', full_name: 'Kovács János' },
      { person_id: 'PERSON-GUID-002', full_name: 'Nagy István' },
      { person_id: 'PERSON-GUID-003', full_name: 'Szabó Péter' },
      { person_id: 'PERSON-GUID-004', full_name: 'Horváth Anna' },
      { person_id: 'PERSON-GUID-005', full_name: 'Tóth Mihály' },
      { person_id: 'PERSON-GUID-006', full_name: 'Kiss Eszter' },
      { person_id: 'PERSON-GUID-007', full_name: 'Farkas László' },
    ];

    this.mockDatabase.software = [
      { software_id: 'SW-M365', display_name: 'Microsoft 365', vendor: 'Microsoft', version: '16.0.17328' },
      { software_id: 'SW-AUTOCAD', display_name: 'AutoCAD 2024', vendor: 'Autodesk', version: '2024.1.0' },
      { software_id: 'SW-SOLIDWORKS', display_name: 'SolidWorks 2024', vendor: 'Dassault Systèmes', version: '2024 SP2' },
      { software_id: 'SW-SAP', display_name: 'SAP ERP', vendor: 'SAP', version: '7.55' },
      { software_id: 'SW-TIA', display_name: 'Siemens TIA Portal', vendor: 'Siemens', version: 'V17' },
      { software_id: 'SW-MATLAB', display_name: 'MATLAB R2024a', vendor: 'MathWorks', version: 'R2024a' },
      { software_id: 'SW-LABVIEW', display_name: 'LabVIEW 2024', vendor: 'National Instruments', version: '2024 Q1' },
      { software_id: 'SW-ROBOSTUDIO', display_name: 'ABB RobotStudio', vendor: 'ABB', version: '2024.1' },
    ];

    this.mockDatabase.tickets = [
      { ticket_id: 'INC-2025-00123', itsm_url: 'http://localhost:5000/mock-itsm-ui/ticket/INC-2025-00123' },
      { ticket_id: 'INC-2025-00187', itsm_url: 'http://localhost:5000/mock-itsm-ui/ticket/INC-2025-00187' },
      { ticket_id: 'INC-2025-00241', itsm_url: 'http://localhost:5000/mock-itsm-ui/ticket/INC-2025-00241' },
      { ticket_id: 'REQ-2025-00089', itsm_url: 'http://localhost:5000/mock-itsm-ui/ticket/REQ-2025-00089' },
    ];

    this.mockDatabase.hardware = [
      {
        itsm_guid: 'a1b2c3d4-0001-4e5f-8a9b-000000000001',
        itsm_id: 'HWA10001',
        display_name: 'Művezetői PC #1',
        serial_number: 'DELL-SN-ABC123',
        asset_tag: 'ASSET-2023-0001',
        model: 'Dell OptiPlex 7090',
        manufacturer: 'Dell',
        asset_class: 'Desktop PC',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:1A:2B:3C:4D:5E',
        status: 'Deployed',
        itsm_modified_at: '2025-04-15T08:30:00Z',
        assigned_to_person: 'PERSON-GUID-001',
        assigned_person_name: 'Kovács János',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-M365', 'SW-AUTOCAD'],
        related_tickets: ['INC-2025-00123'],
      },
      {
        itsm_guid: 'a1b2c3d4-0002-4e5f-8a9b-000000000002',
        itsm_id: 'HWA10002',
        display_name: 'Tekercselő PC #1',
        serial_number: 'HP-SN-XYZ456',
        asset_tag: 'ASSET-2023-0002',
        model: 'HP EliteDesk 800 G8',
        manufacturer: 'HP',
        asset_class: 'Desktop PC',
        os_type: 'Windows',
        os_version: '10 Pro',
        mac_address: '00:1A:2B:3C:4D:5F',
        status: 'Deployed',
        itsm_modified_at: '2025-03-22T14:10:00Z',
        assigned_to_person: 'PERSON-GUID-002',
        assigned_person_name: 'Nagy István',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-M365', 'SW-TIA'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0003-4e5f-8a9b-000000000003',
        itsm_id: 'HWA10003',
        display_name: 'CNC Vezérlő PC #1',
        serial_number: 'SIEM-IPC-00321',
        asset_tag: 'ASSET-2022-0003',
        model: 'Siemens IPC677E',
        manufacturer: 'Siemens',
        asset_class: 'Industrial PC',
        os_type: 'Windows',
        os_version: '10 IoT Enterprise',
        mac_address: '00:2C:3D:4E:5F:60',
        status: 'Deployed',
        itsm_modified_at: '2025-01-10T09:00:00Z',
        assigned_to_person: 'PERSON-GUID-002',
        assigned_person_name: 'Nagy István',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-002',
        catalog_item_name: 'Desktop PC - Industrial',
        installed_software: ['SW-TIA'],
        related_tickets: ['INC-2025-00187'],
      },
      {
        itsm_guid: 'a1b2c3d4-0004-4e5f-8a9b-000000000004',
        itsm_id: 'HWA10004',
        display_name: 'Minőségellenőrző Laptop',
        serial_number: 'LNV-T14-00445',
        asset_tag: 'ASSET-2024-0001',
        model: 'Lenovo ThinkPad T14 Gen 4',
        manufacturer: 'Lenovo',
        asset_class: 'Laptop',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:3D:4E:5F:60:71',
        status: 'Deployed',
        itsm_modified_at: '2025-05-01T11:20:00Z',
        assigned_to_person: 'PERSON-GUID-004',
        assigned_person_name: 'Horváth Anna',
        organization_itsm_id: 'ORG-GUID-002',
        organization_name: 'Minőségbiztosítás',
        catalog_item_itsm_id: 'CAT-GUID-003',
        catalog_item_name: 'Laptop - Standard',
        installed_software: ['SW-M365', 'SW-SAP'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0005-4e5f-8a9b-000000000005',
        itsm_id: 'HWA10005',
        display_name: 'Raktár Scanner Workstation',
        serial_number: 'ZBR-WS50-00512',
        asset_tag: 'ASSET-2023-0005',
        model: 'Zebra WS50',
        manufacturer: 'Zebra Technologies',
        asset_class: 'Wearable Computer',
        os_type: 'Android',
        os_version: '10',
        mac_address: '00:4E:5F:60:71:82',
        status: 'Deployed',
        itsm_modified_at: '2024-11-15T16:45:00Z',
        assigned_to_person: 'PERSON-GUID-005',
        assigned_person_name: 'Tóth Mihály',
        organization_itsm_id: 'ORG-GUID-003',
        organization_name: 'Logisztika',
        catalog_item_itsm_id: 'CAT-GUID-006',
        catalog_item_name: 'Mobile Device',
        installed_software: [],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0006-4e5f-8a9b-000000000006',
        itsm_id: 'HWA10006',
        display_name: 'Szerver Rack #1 - PowerEdge',
        serial_number: 'DELL-PE-R740-001',
        asset_tag: 'ASSET-2021-0006',
        model: 'Dell PowerEdge R740',
        manufacturer: 'Dell',
        asset_class: 'Server',
        os_type: 'Windows Server',
        os_version: '2022 Standard',
        mac_address: '00:5F:60:71:82:93',
        status: 'Deployed',
        itsm_modified_at: '2025-02-28T07:15:00Z',
        assigned_to_person: 'PERSON-GUID-007',
        assigned_person_name: 'Farkas László',
        organization_itsm_id: 'ORG-GUID-004',
        organization_name: 'IT',
        catalog_item_itsm_id: 'CAT-GUID-005',
        catalog_item_name: 'Server',
        installed_software: ['SW-SAP'],
        related_tickets: ['INC-2025-00241'],
      },
      {
        itsm_guid: 'a1b2c3d4-0007-4e5f-8a9b-000000000007',
        itsm_id: 'HWA10007',
        display_name: 'Hegesztő Állomás PC',
        serial_number: 'BCK-C6030-00701',
        asset_tag: 'ASSET-2022-0007',
        model: 'Beckhoff C6030',
        manufacturer: 'Beckhoff',
        asset_class: 'Industrial PC',
        os_type: 'Windows',
        os_version: '10 IoT Enterprise',
        mac_address: '00:60:71:82:93:A4',
        status: 'Deployed',
        itsm_modified_at: '2024-12-01T10:30:00Z',
        assigned_to_person: 'PERSON-GUID-003',
        assigned_person_name: 'Szabó Péter',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-002',
        catalog_item_name: 'Desktop PC - Industrial',
        installed_software: ['SW-TIA'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0008-4e5f-8a9b-000000000008',
        itsm_id: 'HWA10008',
        display_name: 'Mérnöki Laptop #1',
        serial_number: 'HP-EB840-00801',
        asset_tag: 'ASSET-2024-0002',
        model: 'HP EliteBook 840 G8',
        manufacturer: 'HP',
        asset_class: 'Laptop',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:71:82:93:A4:B5',
        status: 'Deployed',
        itsm_modified_at: '2025-04-20T13:00:00Z',
        assigned_to_person: 'PERSON-GUID-006',
        assigned_person_name: 'Kiss Eszter',
        organization_itsm_id: 'ORG-GUID-005',
        organization_name: 'Mérnöki',
        catalog_item_itsm_id: 'CAT-GUID-003',
        catalog_item_name: 'Laptop - Standard',
        installed_software: ['SW-M365', 'SW-AUTOCAD', 'SW-SOLIDWORKS'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0009-4e5f-8a9b-000000000009',
        itsm_id: 'HWA10009',
        display_name: 'Felügyelői Tablet',
        serial_number: 'MSFT-SPR8-00901',
        asset_tag: 'ASSET-2024-0003',
        model: 'Microsoft Surface Pro 8',
        manufacturer: 'Microsoft',
        asset_class: 'Tablet',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:82:93:A4:B5:C6',
        status: 'Deployed',
        itsm_modified_at: '2025-05-05T09:45:00Z',
        assigned_to_person: 'PERSON-GUID-001',
        assigned_person_name: 'Kovács János',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-006',
        catalog_item_name: 'Mobile Device',
        installed_software: ['SW-M365', 'SW-SAP'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0010-4e5f-8a9b-000000000010',
        itsm_id: 'HWA10010',
        display_name: 'Karbantartó Laptop',
        serial_number: 'LNV-X1C-01001',
        asset_tag: 'ASSET-2023-0010',
        model: 'Lenovo ThinkPad X1 Carbon Gen 11',
        manufacturer: 'Lenovo',
        asset_class: 'Laptop',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:93:A4:B5:C6:D7',
        status: 'Deployed',
        itsm_modified_at: '2025-03-10T15:30:00Z',
        assigned_to_person: 'PERSON-GUID-003',
        assigned_person_name: 'Szabó Péter',
        organization_itsm_id: 'ORG-GUID-006',
        organization_name: 'Karbantartás',
        catalog_item_itsm_id: 'CAT-GUID-004',
        catalog_item_name: 'Laptop - Premium',
        installed_software: ['SW-M365', 'SW-TIA'],
        related_tickets: ['REQ-2025-00089'],
      },
      {
        itsm_guid: 'a1b2c3d4-0011-4e5f-8a9b-000000000011',
        itsm_id: 'HWA10011',
        display_name: 'ERP Terminál #1',
        serial_number: 'HP-T640-01101',
        asset_tag: 'ASSET-2022-0011',
        model: 'HP t640 Thin Client',
        manufacturer: 'HP',
        asset_class: 'Thin Client',
        os_type: 'Windows',
        os_version: '10 IoT',
        mac_address: '00:A4:B5:C6:D7:E8',
        status: 'Deployed',
        itsm_modified_at: '2024-10-20T08:00:00Z',
        organization_itsm_id: 'ORG-GUID-003',
        organization_name: 'Logisztika',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-SAP'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0012-4e5f-8a9b-000000000012',
        itsm_id: 'HWA10012',
        display_name: 'ERP Terminál #2',
        serial_number: 'HP-T640-01201',
        asset_tag: 'ASSET-2022-0012',
        model: 'HP t640 Thin Client',
        manufacturer: 'HP',
        asset_class: 'Thin Client',
        os_type: 'Windows',
        os_version: '10 IoT',
        mac_address: '00:B5:C6:D7:E8:F9',
        status: 'Deployed',
        itsm_modified_at: '2024-10-20T08:05:00Z',
        organization_itsm_id: 'ORG-GUID-003',
        organization_name: 'Logisztika',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-SAP'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0013-4e5f-8a9b-000000000013',
        itsm_id: 'HWA10013',
        display_name: 'Festősor Munkaállomás',
        serial_number: 'DELL-OPX-01301',
        asset_tag: 'ASSET-2023-0013',
        model: 'Dell OptiPlex 3090',
        manufacturer: 'Dell',
        asset_class: 'Desktop PC',
        os_type: 'Windows',
        os_version: '10 Pro',
        mac_address: '00:C6:D7:E8:F9:0A',
        status: 'Deployed',
        itsm_modified_at: '2025-01-25T12:10:00Z',
        assigned_to_person: 'PERSON-GUID-002',
        assigned_person_name: 'Nagy István',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-M365'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0014-4e5f-8a9b-000000000014',
        itsm_id: 'HWA10014',
        display_name: 'MES Szerver',
        serial_number: 'DELL-PE-R750-001',
        asset_tag: 'ASSET-2023-0014',
        model: 'Dell PowerEdge R750',
        manufacturer: 'Dell',
        asset_class: 'Server',
        os_type: 'Windows Server',
        os_version: '2022 Datacenter',
        mac_address: '00:D7:E8:F9:0A:1B',
        status: 'Deployed',
        itsm_modified_at: '2025-05-08T06:00:00Z',
        assigned_to_person: 'PERSON-GUID-007',
        assigned_person_name: 'Farkas László',
        organization_itsm_id: 'ORG-GUID-004',
        organization_name: 'IT',
        catalog_item_itsm_id: 'CAT-GUID-005',
        catalog_item_name: 'Server',
        installed_software: ['SW-SAP'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0015-4e5f-8a9b-000000000015',
        itsm_id: 'HWA10015',
        display_name: 'CAM Munkaállomás',
        serial_number: 'HP-Z4G4-01501',
        asset_tag: 'ASSET-2022-0015',
        model: 'HP Z4 G4',
        manufacturer: 'HP',
        asset_class: 'Workstation',
        os_type: 'Windows',
        os_version: '11 Pro for Workstations',
        mac_address: '00:E8:F9:0A:1B:2C',
        status: 'Deployed',
        itsm_modified_at: '2025-02-14T10:00:00Z',
        assigned_to_person: 'PERSON-GUID-006',
        assigned_person_name: 'Kiss Eszter',
        organization_itsm_id: 'ORG-GUID-005',
        organization_name: 'Mérnöki',
        catalog_item_itsm_id: 'CAT-GUID-007',
        catalog_item_name: 'Workstation',
        installed_software: ['SW-M365', 'SW-SOLIDWORKS', 'SW-MATLAB'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0016-4e5f-8a9b-000000000016',
        itsm_id: 'HWA10016',
        display_name: 'Összeszerelő Sor Monitor PC',
        serial_number: 'ADV-IPC610-01601',
        asset_tag: 'ASSET-2021-0016',
        model: 'Advantech IPC-610H',
        manufacturer: 'Advantech',
        asset_class: 'Industrial PC',
        os_type: 'Windows',
        os_version: '10 IoT Enterprise',
        mac_address: '00:F9:0A:1B:2C:3D',
        status: 'Deployed',
        itsm_modified_at: '2024-09-05T11:30:00Z',
        organization_itsm_id: 'ORG-GUID-001',
        organization_name: 'Gyártás',
        catalog_item_itsm_id: 'CAT-GUID-002',
        catalog_item_name: 'Desktop PC - Industrial',
        installed_software: ['SW-TIA'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0017-4e5f-8a9b-000000000017',
        itsm_id: 'HWA10017',
        display_name: 'PLC Programozó Állomás',
        serial_number: 'AB-PG-1756-01701',
        asset_tag: 'ASSET-2020-0017',
        model: 'Allen Bradley 1756-L85E',
        manufacturer: 'Rockwell Automation',
        asset_class: 'Industrial PC',
        os_type: 'Windows',
        os_version: '10 Pro',
        mac_address: '00:0A:1B:2C:3D:4E',
        status: 'Deployed',
        itsm_modified_at: '2024-07-12T14:00:00Z',
        assigned_to_person: 'PERSON-GUID-003',
        assigned_person_name: 'Szabó Péter',
        organization_itsm_id: 'ORG-GUID-006',
        organization_name: 'Karbantartás',
        catalog_item_itsm_id: 'CAT-GUID-002',
        catalog_item_name: 'Desktop PC - Industrial',
        installed_software: ['SW-TIA', 'SW-LABVIEW'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0018-4e5f-8a9b-000000000018',
        itsm_id: 'HWA10018',
        display_name: 'IT Admin Munkaállomás',
        serial_number: 'DELL-OPX-01801',
        asset_tag: 'ASSET-2024-0004',
        model: 'Dell OptiPlex 7090',
        manufacturer: 'Dell',
        asset_class: 'Desktop PC',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:1B:2C:3D:4E:5F',
        status: 'Deployed',
        itsm_modified_at: '2025-04-30T09:00:00Z',
        assigned_to_person: 'PERSON-GUID-007',
        assigned_person_name: 'Farkas László',
        organization_itsm_id: 'ORG-GUID-004',
        organization_name: 'IT',
        catalog_item_itsm_id: 'CAT-GUID-001',
        catalog_item_name: 'Desktop PC - Standard',
        installed_software: ['SW-M365'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0019-4e5f-8a9b-000000000019',
        itsm_id: 'HWA10019',
        display_name: 'Barcode Scanner Terminál #1',
        serial_number: 'HWL-CT60-01901',
        asset_tag: 'ASSET-2023-0019',
        model: 'Honeywell CT60',
        manufacturer: 'Honeywell',
        asset_class: 'Handheld Computer',
        os_type: 'Android',
        os_version: '10',
        mac_address: '00:2C:3D:4E:5F:60',
        status: 'Deployed',
        itsm_modified_at: '2024-12-10T10:00:00Z',
        assigned_to_person: 'PERSON-GUID-005',
        assigned_person_name: 'Tóth Mihály',
        organization_itsm_id: 'ORG-GUID-003',
        organization_name: 'Logisztika',
        catalog_item_itsm_id: 'CAT-GUID-006',
        catalog_item_name: 'Mobile Device',
        installed_software: [],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0020-4e5f-8a9b-000000000020',
        itsm_id: 'HWA10020',
        display_name: 'Tesztpad PC',
        serial_number: 'NI-CDAQ-02001',
        asset_tag: 'ASSET-2021-0020',
        model: 'NI cDAQ-9174',
        manufacturer: 'National Instruments',
        asset_class: 'Measurement System',
        os_type: 'Windows',
        os_version: '10 Pro',
        mac_address: '00:3D:4E:5F:60:71',
        status: 'Deployed',
        itsm_modified_at: '2024-08-20T13:20:00Z',
        assigned_to_person: 'PERSON-GUID-006',
        assigned_person_name: 'Kiss Eszter',
        organization_itsm_id: 'ORG-GUID-002',
        organization_name: 'Minőségbiztosítás',
        catalog_item_itsm_id: 'CAT-GUID-002',
        catalog_item_name: 'Desktop PC - Industrial',
        installed_software: ['SW-LABVIEW', 'SW-MATLAB'],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0021-4e5f-8a9b-000000000021',
        itsm_id: 'HWA10021',
        display_name: 'Nyomtató - Iroda #1',
        serial_number: 'HP-LJ-M404-02101',
        asset_tag: 'ASSET-2022-0021',
        model: 'HP LaserJet Pro M404n',
        manufacturer: 'HP',
        asset_class: 'Printer',
        status: 'Deployed',
        itsm_modified_at: '2024-06-01T08:00:00Z',
        organization_itsm_id: 'ORG-GUID-004',
        organization_name: 'IT',
        catalog_item_itsm_id: 'CAT-GUID-008',
        catalog_item_name: 'Printer/Scanner',
        installed_software: [],
        related_tickets: [],
      },
      {
        itsm_guid: 'a1b2c3d4-0022-4e5f-8a9b-000000000022',
        itsm_id: 'HWA10022',
        display_name: 'Robot Programozó Laptop',
        serial_number: 'LNV-T14-02201',
        asset_tag: 'ASSET-2024-0005',
        model: 'Lenovo ThinkPad T14 Gen 4',
        manufacturer: 'Lenovo',
        asset_class: 'Laptop',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:4E:5F:60:71:82',
        status: 'Deployed',
        itsm_modified_at: '2025-05-10T10:30:00Z',
        assigned_to_person: 'PERSON-GUID-003',
        assigned_person_name: 'Szabó Péter',
        organization_itsm_id: 'ORG-GUID-006',
        organization_name: 'Karbantartás',
        catalog_item_itsm_id: 'CAT-GUID-003',
        catalog_item_name: 'Laptop - Standard',
        installed_software: ['SW-M365', 'SW-ROBOSTUDIO', 'SW-TIA'],
        related_tickets: [],
      },
    ];
  }

  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.mockDelay));
  }

  async getHardware(hardwareId: string): Promise<IITSMHardware> {
    await this.delay();
    const hardware = this.mockDatabase.hardware.find(
      (h) => h.itsm_guid === hardwareId || h.itsm_id === hardwareId
    );
    if (!hardware) throw new Error(`Hardware not found: ${hardwareId}`);
    return hardware;
  }

  async searchHardware(query: string): Promise<IITSMHardware[]> {
    await this.delay();
    const lowerQuery = query.toLowerCase();
    return this.mockDatabase.hardware.filter(
      (h) =>
        h.display_name.toLowerCase().includes(lowerQuery) ||
        h.serial_number.toLowerCase().includes(lowerQuery) ||
        h.asset_tag.toLowerCase().includes(lowerQuery) ||
        h.model.toLowerCase().includes(lowerQuery) ||
        h.itsm_id.toLowerCase().includes(lowerQuery)
    );
  }

  async getPerson(personId: string): Promise<IITSMPerson> {
    await this.delay();
    const person = this.mockDatabase.persons.find((p) => p.person_id === personId);
    if (!person) throw new Error(`Person not found: ${personId}`);
    return person;
  }

  async getSoftware(softwareId: string): Promise<IITSMSoftware> {
    await this.delay();
    const software = this.mockDatabase.software.find((s) => s.software_id === softwareId);
    if (!software) throw new Error(`Software not found: ${softwareId}`);
    return software;
  }

  async getTicketsByHardware(hardwareId: string): Promise<IITSMTicket[]> {
    await this.delay();
    const hardware = await this.getHardware(hardwareId);
    return this.mockDatabase.tickets.filter((t) =>
      hardware.related_tickets?.includes(t.ticket_id)
    );
  }

  async syncAsset(hardwareId: string): Promise<IITSMSyncResult> {
    try {
      const hardware = await this.getHardware(hardwareId);

      let person = null;
      if (hardware.assigned_to_person) {
        person = await this.getPerson(hardware.assigned_to_person);
      }

      const software = [];
      if (hardware.installed_software) {
        for (const swId of hardware.installed_software) {
          try {
            const sw = await this.getSoftware(swId);
            software.push({ software_id: sw.software_id, display_name: sw.display_name, source: 'itsm' as const });
          } catch {
            // skip unknown software IDs
          }
        }
      }

      const tickets = await this.getTicketsByHardware(hardware.itsm_guid);

      return { success: true, hardware, person, software, tickets, synced_at: new Date().toISOString() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        synced_at: new Date().toISOString(),
      };
    }
  }

  async syncAll(): Promise<IITSMHardware[]> {
    await this.delay();
    return [...this.mockDatabase.hardware];
  }

  buildTicketUrl(ticketId: string): string {
    return `http://localhost:5000/mock-itsm-ui/ticket/${ticketId}`;
  }
}
