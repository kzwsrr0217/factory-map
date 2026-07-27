/**
 * SnapshotITSMAdapter.ts — reads MMH-scoped ITSM hardware data from the local
 * `itsm_hardware_snapshot` table instead of calling the real ITSM API.
 *
 * Activated when `ITSM_MODE=snapshot`. This exists because the backend runs in
 * a Podman container with no working path to the real Alemba View API — its
 * only proven access pattern today is Windows Integrated/Kerberos SSO from a
 * domain-joined machine (see ops/itsm/Export-ItsmMmhSnapshot.ps1). That script
 * is run manually/on a schedule OUTSIDE the container, and its export is
 * landed into `itsm_hardware_snapshot` via `import-itsm-snapshot.ts`.
 *
 * This adapter therefore makes **zero network calls to ITSM** — every method
 * below is a plain DB read. It satisfies the same read-only, low-request-volume
 * requirement the live adapter would, just by construction rather than by
 * discipline.
 */
import { IITSMAdapter } from './IITSMAdapter';
import {
  IITSMHardware,
  IITSMPerson,
  IITSMSoftware,
  IITSMTicket,
  IITSMSyncResult,
} from '../../types/itsm.types';
import { AppDataSource } from '../../config/database';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { Like } from 'typeorm';
import config from '../../config/config';

function toHardware(row: ItsmHardwareSnapshot): IITSMHardware {
  return {
    itsm_guid: row.itsm_guid,
    itsm_id: row.itsm_id,
    display_name: row.display_name ?? row.itsm_id,
    serial_number: row.serial_number ?? '',
    asset_tag: row.asset_tag ?? '',
    model: row.model ?? '',
    manufacturer: row.manufacturer ?? '',
    os_type: row.os_type ?? undefined,
    os_version: row.os_version ?? undefined,
    mac_address: row.mac_address ?? undefined,
    status: (row.status as IITSMHardware['status']) ?? 'Deployed',
    itsm_modified_at: row.itsm_modified_at ?? undefined,
    assigned_person_name: row.assigned_person_name ?? undefined,
    organization_name: row.location_name ?? undefined,
    location_name: row.location_name ?? undefined,
    catalog_item_name: row.catalog_item_name ?? undefined,
  };
}

export class SnapshotITSMAdapter implements IITSMAdapter {
  private repo() {
    return AppDataSource.getRepository(ItsmHardwareSnapshot);
  }

  async getHardware(hardwareId: string): Promise<IITSMHardware> {
    const row =
      (await this.repo().findOne({ where: { itsm_id: hardwareId } })) ??
      (await this.repo().findOne({ where: { itsm_guid: hardwareId } }));
    if (!row) throw new Error(`Hardware not found: ${hardwareId}`);
    return toHardware(row);
  }

  async searchHardware(query: string): Promise<IITSMHardware[]> {
    const like = `%${query}%`;
    const rows = await this.repo().find({
      where: [
        { itsm_id: Like(like) },
        { serial_number: Like(like) },
        { display_name: Like(like) },
        { asset_tag: Like(like) },
      ],
      take: 50,
    });
    return rows.map(toHardware);
  }

  async getPerson(_personId: string): Promise<IITSMPerson> {
    throw new Error('getPerson not available in snapshot ITSM mode');
  }

  async getSoftware(_softwareId: string): Promise<IITSMSoftware> {
    throw new Error('getSoftware not available in snapshot ITSM mode');
  }

  async getTicketsByHardware(_hardwareId: string): Promise<IITSMTicket[]> {
    // The snapshot export does not carry tickets.
    return [];
  }

  async syncAsset(hardwareId: string): Promise<IITSMSyncResult> {
    try {
      const hardware = await this.getHardware(hardwareId);
      return { success: true, hardware, person: null, software: [], tickets: [], synced_at: new Date().toISOString() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', synced_at: new Date().toISOString() };
    }
  }

  async syncAll(): Promise<IITSMHardware[]> {
    const rows = await this.repo().find();
    return rows.map(toHardware);
  }

  buildTicketUrl(ticketId: string): string {
    return `${config.itsm.webUrl}/Analyst/Forms/Open/${ticketId}`;
  }
}
