/**
 * IITSMAdapter.ts — Adapter interface contract for ITSM integrations.
 *
 * Any ITSM backend (Mock, ServiceNow, ManageEngine, etc.) must implement this
 * interface so ITSMService can delegate calls without knowing the concrete
 * implementation. Swap the adapter by changing `ITSM_MODE` in config.
 *
 * Methods:
 *   getHardware(id)            — fetch a single hardware record by GUID or ID.
 *   searchHardware(query)      — free-text search across name/serial/tag/model.
 *   getPerson(id)              — fetch a person/user by their ITSM person ID.
 *   getSoftware(id)            — fetch a software record by software ID.
 *   getTicketsByHardware(id)   — list open/recent tickets linked to a device.
 *   syncAsset(id)              — full sync: returns hardware + person + software
 *                                + tickets in one call.
 *   syncAll()                  — return all hardware records (used for bulk sync).
 *   buildTicketUrl(ticketId)   — construct the deep-link URL for a ticket.
 */

import {
  IITSMHardware,
  IITSMPerson,
  IITSMSoftware,
  IITSMTicket,
  IITSMSyncResult,
} from '../../types/itsm.types';

export interface IITSMAdapter {
  getHardware(hardwareId: string): Promise<IITSMHardware>;
  searchHardware(query: string): Promise<IITSMHardware[]>;
  getPerson(personId: string): Promise<IITSMPerson>;
  getSoftware(softwareId: string): Promise<IITSMSoftware>;
  getTicketsByHardware(hardwareId: string): Promise<IITSMTicket[]>;
  syncAsset(hardwareId: string): Promise<IITSMSyncResult>;
  syncAll(): Promise<IITSMHardware[]>;
  buildTicketUrl(ticketId: string): string;
}