/**
 * ITSM Service
 * Uses the appropriate adapter based on configuration
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

  buildTicketUrl(ticketId: string) {
    return this.adapter.buildTicketUrl(ticketId);
  }
}

// Singleton instance
export default new ITSMService();