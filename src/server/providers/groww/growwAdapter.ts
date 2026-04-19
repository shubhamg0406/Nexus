import type { ExternalConnection, ExternalProviderAdapter } from '../types.js';

export const GROWW_PROVIDER_ENABLED = false;

export class GrowwAdapter implements ExternalProviderAdapter {
  async getStatus(_connection: ExternalConnection) {
    return {
      healthy: false,
      detail: 'Groww is not enabled in this build. Requires paid Groww Trading API subscription.',
    };
  }

  async refreshConnection(_connection: ExternalConnection) {
    throw new Error('Groww is not enabled in this build.');
  }

  async fetchAccounts(_connection: ExternalConnection) {
    throw new Error('Groww is not enabled in this build.');
  }

  async fetchHoldings(_connection: ExternalConnection) {
    throw new Error('Groww is not enabled in this build.');
  }
}
