/**
 * Mock ITSM Adapter
 * Simulates ITSM API responses for development
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
  private mockDelay = 300; // Simulate network delay (ms)

  private mockDatabase = {
    hardware: [] as IITSMHardware[],
    persons: [] as IITSMPerson[],
    software: [] as IITSMSoftware[],
    tickets: [] as IITSMTicket[],
  };

  constructor() {
    this.initializeMockData();
  }

  /**
   * Initialize some mock data
   */
  private initializeMockData(): void {
    // Mock hardware
    this.mockDatabase.hardware = [
      {
        itsm_id: 'HW-PC-0001',
        display_name: 'Művezetői PC #1',
        serial_number: 'DELL-SN-ABC123',
        asset_tag: 'ASSET-2023-0001',
        model: 'Dell OptiPlex 7090',
        manufacturer: 'Dell',
        os_type: 'Windows',
        os_version: '11 Pro',
        mac_address: '00:1A:2B:3C:4D:5E',
        status: 'Deployed',
        assigned_to_person: 'PERSON-0001',
        installed_software: ['SW-OFFICE-365', 'SW-AUTOCAD-2024'],
        related_tickets: ['INC-2025-00123'],
      },
      {
        itsm_id: 'HW-PC-0002',
        display_name: 'Tekercselő PC #1',
        serial_number: 'HP-SN-XYZ456',
        asset_tag: 'ASSET-2023-0002',
        model: 'HP EliteDesk 800 G8',
        manufacturer: 'HP',
        os_type: 'Windows',
        os_version: '10 Pro',
        mac_address: '00:1A:2B:3C:4D:5F',
        status: 'Deployed',
        assigned_to_person: 'PERSON-0002',
        installed_software: ['SW-OFFICE-365'],
        related_tickets: [],
      },
    ];

    // Mock persons
    this.mockDatabase.persons = [
      {
        person_id: 'PERSON-0001',
        full_name: 'Kovács János',
        assigned_hardware: ['HW-PC-0001'],
      },
      {
        person_id: 'PERSON-0002',
        full_name: 'Nagy István',
        assigned_hardware: ['HW-PC-0002'],
      },
    ];

    // Mock software
    this.mockDatabase.software = [
      {
        software_id: 'SW-OFFICE-365',
        display_name: 'Microsoft 365',
        vendor: 'Microsoft',
        version: '16.0.17328',
      },
      {
        software_id: 'SW-AUTOCAD-2024',
        display_name: 'AutoCAD 2024',
        vendor: 'Autodesk',
        version: '2024.1.0',
      },
    ];

    // Mock tickets
    this.mockDatabase.tickets = [
      {
        ticket_id: 'INC-2025-00123',
        itsm_url: 'http://localhost:5000/mock-itsm-ui/ticket/INC-2025-00123',
      },
    ];
  }

  /**
   * Simulate network delay
   */
  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.mockDelay));
  }

  async getHardware(hardwareId: string): Promise<IITSMHardware> {
    await this.delay();

    const hardware = this.mockDatabase.hardware.find((h) => h.itsm_id === hardwareId);

    if (!hardware) {
      throw new Error(`Hardware not found: ${hardwareId}`);
    }

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
        h.model.toLowerCase().includes(lowerQuery)
    );
  }

  async getPerson(personId: string): Promise<IITSMPerson> {
    await this.delay();

    const person = this.mockDatabase.persons.find((p) => p.person_id === personId);

    if (!person) {
      throw new Error(`Person not found: ${personId}`);
    }

    return person;
  }

  async getSoftware(softwareId: string): Promise<IITSMSoftware> {
    await this.delay();

    const software = this.mockDatabase.software.find((s) => s.software_id === softwareId);

    if (!software) {
      throw new Error(`Software not found: ${softwareId}`);
    }

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
      // Get hardware
      const hardware = await this.getHardware(hardwareId);

      // Get person (if assigned)
      let person: IITSMPerson | null = null;
      if (hardware.assigned_to_person) {
        person = await this.getPerson(hardware.assigned_to_person);
      }

      // Get software
      const software = [];
      if (hardware.installed_software) {
        for (const swId of hardware.installed_software) {
          const sw = await this.getSoftware(swId);
          software.push({
            software_id: sw.software_id,
            display_name: sw.display_name,
            source: 'itsm' as const,
          });
        }
      }

      // Get tickets
      const tickets = await this.getTicketsByHardware(hardwareId);

      return {
        success: true,
        hardware,
        person,
        software,
        tickets,
        synced_at: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        synced_at: new Date().toISOString(),
      };
    }
  }

  buildTicketUrl(ticketId: string): string {
    return `http://localhost:5000/mock-itsm-ui/ticket/${ticketId}`;
  }
}