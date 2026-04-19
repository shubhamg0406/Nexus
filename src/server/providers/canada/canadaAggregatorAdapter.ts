import type { ExternalConnection, ExternalProviderAdapter } from '../types.js';

export const CANADA_AGGREGATOR_ENABLED = false;

export class CanadaAggregatorAdapter implements ExternalProviderAdapter {
  async getStatus(_connection: ExternalConnection) {
    return {
      healthy: false,
      detail: 'No live free production-safe Canada aggregator is enabled in this build.',
    };
  }

  async refreshConnection(_connection: ExternalConnection) {
    throw new Error('Canada aggregation is not enabled in this build.');
  }

  async fetchAccounts(_connection: ExternalConnection) {
    throw new Error('Canada aggregation is not enabled in this build.');
  }

  async fetchHoldings(_connection: ExternalConnection) {
    throw new Error('Canada aggregation is not enabled in this build.');
  }
}
