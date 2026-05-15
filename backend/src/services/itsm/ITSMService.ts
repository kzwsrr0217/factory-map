/**
 * ITSMService.ts — Singleton ITSM service that delegates to the active adapter.
 *
 * On construction reads `config.itsm.mode` (`ITSM_MODE` env var):
 *   'mock' → MockITSMAdapter  (default for development; uses in-memory data)
 *   'real' → RealITSMAdapter  (connects to a live ITSM REST API)
 *
 * All public methods are thin pass-throughs to the adapter; call-sites import
 * the singleton (`import itsmService from './ITSMService'`) and never interact
 * with the adapter class directly.
 *
 * Exported as a default singleton (`new ITSMService()`) so state (mock DB,
 * HTTP client) is shared across all controller calls within a server process.
 */

import { IITSMAdapter } from './IITSMAdapter';
import { MockITSMAdapter } from './MockITSMAdapter';
import { RealITSMAdapter } from './RealITSMAdapter';
import config from '../../config/config';

class ITSMService {
  private adapter: IITSMAdapter;

  constructor() {
    // Choose adapter based on config
    if (config.itsm.mode === 'mock') {
      console.log('🧪 Using Mock ITSM Adapter');
      this.adapter = new MockITSMAdapter();
    } else {
      console.log('🔌 Using Real ITSM Adapter');
      this.adapter = new RealITSMAdapter();
    }
  }

  /**
   * All methods delegate to the adapter
   */

  async getHardware(hardwareId: string) {
    return this.adapter.getHardware(hardwareId);
  }

  async searchHardware(query: string) {
    return this.adapter.searchHardware(query);
  }

  async getPerson(personId: string) {
    return this.adapter.getPerson(personId);
  }

  async getSoftware(softwareId: string) {
    return this.adapter.getSoftware(softwareId);
  }

  async getTicketsByHardware(hardwareId: string) {
    return this.adapter.getTicketsByHardware(hardwareId);
  }

  async syncAsset(hardwareId: string) {
    return this.adapter.syncAsset(hardwareId);
  }

  async syncAll() {
    return this.adapter.syncAll();
  }

  buildTicketUrl(ticketId: string) {
    return this.adapter.buildTicketUrl(ticketId);
  }
}

// Singleton instance
export default new ITSMService();