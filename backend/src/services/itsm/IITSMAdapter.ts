/**
 * ITSM Adapter Interface
 * Any ITSM implementation must follow this contract
 */

import {
  IITSMHardware,
  IITSMPerson,
  IITSMSoftware,
  IITSMTicket,
  IITSMSyncResult,
} from '../../types/itsm.types';

export interface IITSMAdapter {  
  /**
   * Get hardware by ITSM ID
   */
  getHardware(hardwareId: string): Promise<IITSMHardware>;

  /**
   * Search hardware by query (serial, asset tag, hostname, etc.)
   */
  searchHardware(query: string): Promise<IITSMHardware[]>;

  /**
   * Get person by ITSM ID
   */
  getPerson(personId: string): Promise<IITSMPerson>;

  /**
   * Get software by ITSM ID
   */
  getSoftware(softwareId: string): Promise<IITSMSoftware>;

  /**
   * Get all tickets related to a hardware
   */
  getTicketsByHardware(hardwareId: string): Promise<IITSMTicket[]>;

  /**
   * Full sync: Get all data for an asset (hardware + person + software + tickets)
   */
  syncAsset(hardwareId: string): Promise<IITSMSyncResult>;

  /**
   * Build ITSM web URL for a ticket
   */
  buildTicketUrl(ticketId: string): string;
}