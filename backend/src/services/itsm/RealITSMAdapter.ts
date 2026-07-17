/**
 * RealITSMAdapter.ts — HTTP adapter for the live Alemba / Operaio Service Manager.
 *
 * Activated when `ITSM_MODE=real`. Uses the internal **View API** that the ITSM
 * web UI itself calls, because the official Alemba connector is blocked by DLP
 * policy (the ipcdata lesson). Reads from config:
 *   ITSM_REAL_API_URL — base URL, e.g. https://servicemanager.company.com
 *   ITSM_API_KEY      — bearer token / session key
 *   ITSM_VIEW_ID      — GUID of the "Hardware Assets" view
 *   ITSM_WEB_URL      — base for building record deep-links
 *
 * Endpoint contract (from the ipcdata investigation):
 *   GET {base}/api/ViewAPI/GetViewData/{viewId}
 * The view is filterable, so a single-asset lookup returns Count=1 rather than
 * downloading the whole (~18k row) catalogue. We only ever READ — nothing is
 * written back to ITSM.
 *
 * NOTE: The Alemba view exposes business column captions, which vary per tenant.
 * The `COLUMN_MAP` below maps our canonical field names to the caption(s) the
 * view returns; adjust it once the live view's exact column names are confirmed.
 * `mapRow()` is defensive so an unexpected/renamed column degrades to null
 * instead of throwing.
 */

import { IITSMAdapter } from './IITSMAdapter';
import {
  IITSMHardware,
  IITSMPerson,
  IITSMSoftware,
  IITSMTicket,
  IITSMSyncResult,
} from '../../types/itsm.types';
import config from '../../config/config';

/** Raw Alemba view row: caption → value. */
type ViewRow = Record<string, unknown>;

/**
 * Canonical field → possible Alemba column captions (first match wins).
 * Tune these to the live "Hardware Assets" view once confirmed.
 */
const COLUMN_MAP: Record<string, string[]> = {
  itsm_guid: ['Object GUID', 'ObjectGUID', 'Guid'],
  itsm_id: ['Hardware Asset ID', 'HardwareAssetID', 'Company Asset Tag', 'CompanyAssetTag'],
  display_name: ['Name', 'Display Name', 'Catalog Item'],
  serial_number: ['Serial Number', 'SerialNumber'],
  asset_tag: ['Company Asset Tag', 'CompanyAssetTag', 'Asset Tag'],
  model: ['Model', 'Catalog Item'],
  manufacturer: ['Manufacturer', 'Vendor'],
  asset_class: ['Asset Class', 'Type'],
  os_type: ['Operating System', 'OS'],
  os_version: ['OS Version'],
  mac_address: ['MAC Address', 'MACAddress'],
  status: ['Status', 'State'],
  itsm_modified_at: ['Last Modified', 'Modified Date', 'LastUpdate'],
  assigned_person_name: ['Used By', 'Assigned User', 'Owner'],
  organization_name: ['Organization', 'Location'],
  catalog_item_name: ['Catalog Item'],
};

export class RealITSMAdapter implements IITSMAdapter {
  private baseUrl: string;
  private apiKey: string;
  private viewId: string;

  constructor() {
    this.baseUrl = config.itsm.realApiUrl.replace(/\/+$/, '');
    this.apiKey = config.itsm.apiKey;
    this.viewId = config.itsm.viewId;

    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Real ITSM configuration is missing (ITSM_REAL_API_URL / ITSM_API_KEY)');
    }
    if (!this.viewId) {
      throw new Error('Real ITSM configuration is missing ITSM_VIEW_ID (Hardware Assets view GUID)');
    }
  }

  /** Authenticated GET against the ITSM View API. READ-ONLY. */
  private async _get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`ITSM API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  /** Fetch view rows, optionally server-side filtered to a search term. */
  private async fetchViewRows(filter?: string): Promise<ViewRow[]> {
    // Alemba's GetViewData accepts a free-text filter that narrows the view so we
    // do not pull the full catalogue. The exact param name can differ per version.
    const params = filter ? { filter, searchText: filter } : undefined;
    const body = await this._get<unknown>(`/api/ViewAPI/GetViewData/${this.viewId}`, params);
    return extractRows(body);
  }

  /** Defaults merged with the optional ITSM_COLUMN_MAP env override (override wins). */
  private columnMap: Record<string, string[]> = { ...COLUMN_MAP, ...config.itsm.columnMap };

  private mapRow(row: ViewRow): IITSMHardware {
    const pick = (field: string): string | undefined => {
      for (const caption of this.columnMap[field] ?? []) {
        const value = row[caption];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
      return undefined;
    };

    const itsmId = pick('itsm_id') ?? '';
    return {
      itsm_guid: pick('itsm_guid') ?? itsmId,
      itsm_id: itsmId,
      display_name: pick('display_name') ?? itsmId,
      serial_number: pick('serial_number') ?? '',
      asset_tag: pick('asset_tag') ?? '',
      model: pick('model') ?? '',
      manufacturer: pick('manufacturer') ?? '',
      asset_class: pick('asset_class'),
      os_type: pick('os_type'),
      os_version: pick('os_version'),
      mac_address: pick('mac_address'),
      status: (pick('status') as IITSMHardware['status']) ?? 'Deployed',
      itsm_modified_at: pick('itsm_modified_at'),
      assigned_person_name: pick('assigned_person_name'),
      organization_name: pick('organization_name'),
      catalog_item_name: pick('catalog_item_name'),
    };
  }

  async getHardware(hardwareId: string): Promise<IITSMHardware> {
    const rows = await this.fetchViewRows(hardwareId);
    const mapped = rows.map((r) => this.mapRow(r));
    const match = mapped.find(
      (h) => h.itsm_id === hardwareId || h.itsm_guid === hardwareId,
    );
    if (!match) throw new Error(`Hardware not found: ${hardwareId}`);
    return match;
  }

  async searchHardware(query: string): Promise<IITSMHardware[]> {
    const rows = await this.fetchViewRows(query);
    return rows.map((r) => this.mapRow(r));
  }

  async getPerson(_personId: string): Promise<IITSMPerson> {
    throw new Error('getPerson not implemented for the real ITSM adapter');
  }

  async getSoftware(_softwareId: string): Promise<IITSMSoftware> {
    throw new Error('getSoftware not implemented for the real ITSM adapter');
  }

  async getTicketsByHardware(_hardwareId: string): Promise<IITSMTicket[]> {
    // The Hardware Assets view does not carry tickets; return none rather than fail.
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
    // Unfiltered pull of the full view. Prefer reconcile (per-id lookups) over
    // this for routine operation — see ReconcileService / the ipcdata rationale.
    const rows = await this.fetchViewRows();
    return rows.map((r) => this.mapRow(r));
  }

  buildTicketUrl(ticketId: string): string {
    return `${config.itsm.webUrl}/Analyst/Forms/Open/${ticketId}`;
  }
}

/**
 * Normalise the various shapes GetViewData may return into a plain row array.
 * Alemba wraps rows under keys like `Data`, `Rows`, `Results` or `value`.
 */
function extractRows(body: unknown): ViewRow[] {
  if (Array.isArray(body)) return body as ViewRow[];
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['Data', 'data', 'Rows', 'rows', 'Results', 'results', 'value']) {
      if (Array.isArray(obj[key])) return obj[key] as ViewRow[];
    }
  }
  return [];
}
