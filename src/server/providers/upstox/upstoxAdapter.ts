import type { ExternalAccount, ExternalConnection, ExternalHolding, ExternalProviderAdapter } from '../types.js';
import { UpstoxClient } from './upstoxClient.js';
import { readUpstoxAccessToken } from './upstoxService.js';

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toOptionalNumber(value: unknown) {
  const parsed = toNumber(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
}

function pickTicker(input: { trading_symbol?: string; tradingsymbol?: string }) {
  return input.trading_symbol || input.tradingsymbol;
}

function normalizeAssetType(symbol: string | undefined, product: string | undefined): ExternalHolding['assetType'] {
  const upperSymbol = (symbol || '').toUpperCase();
  const upperProduct = (product || '').toUpperCase();

  if (upperProduct.includes('FUT') || upperProduct.includes('OPT')) return 'derivative';
  if (upperSymbol.includes('ETF')) return 'etf';
  if (upperSymbol.includes('FUND') || upperSymbol.includes('MF')) return 'fund';
  return 'stock';
}

function normalizePositionSide(quantity: number): ExternalHolding['positionSide'] {
  if (quantity > 0) return 'long';
  if (quantity < 0) return 'short';
  return 'unknown';
}

function readInvestedValue(
  row: Record<string, unknown>,
  quantity: number,
  averageCost: number,
  marketValue: number,
  unrealizedPnl: number,
) {
  const directCandidate = toOptionalNumber(
    row.invested ??
    row.invested_value ??
    row.investedValue ??
    row.buy_value ??
    row.buyValue ??
    row.invested_amount,
  );
  if (directCandidate != null) return directCandidate;

  if (quantity !== 0 && averageCost > 0) {
    return quantity * averageCost;
  }

  if (Number.isFinite(marketValue) && Number.isFinite(unrealizedPnl)) {
    return marketValue - unrealizedPnl;
  }

  return undefined;
}

export class UpstoxAdapter implements ExternalProviderAdapter {
  private readonly client: UpstoxClient;

  constructor(client?: UpstoxClient) {
    this.client = client || new UpstoxClient();
  }

  async getStatus(connection: ExternalConnection) {
    const accessToken = readUpstoxAccessToken(connection);
    await this.client.getProfile(accessToken);
    return { healthy: true };
  }

  async refreshConnection(connection: ExternalConnection) {
    await this.getStatus(connection);
  }

  async fetchAccounts(connection: ExternalConnection) {
    const accessToken = readUpstoxAccessToken(connection);
    const profile = await this.client.getProfile(accessToken);
    const remoteAccountId = profile.user_id || 'primary';
    const accountId = `upstox:${connection.id}:${remoteAccountId}`;

    const account: ExternalAccount = {
      id: accountId,
      uid: connection.uid,
      connectionId: connection.id,
      provider: 'upstox',
      remoteAccountId,
      accountName: profile.user_name || profile.email || 'Upstox Account',
      accountType: 'brokerage',
      institutionName: 'Upstox',
      currency: 'INR',
      syncedAt: Date.now(),
      isActive: true,
    };

    return [account];
  }

  async fetchHoldings(connection: ExternalConnection) {
    const accessToken = readUpstoxAccessToken(connection);
    const [accounts, holdingsResponse, positionsResponse] = await Promise.all([
      this.fetchAccounts(connection),
      this.client.getHoldings(accessToken),
      this.client.getPositions(accessToken),
    ]);

    const account = accounts[0];
    const accountId = account.id;

    const holdings: ExternalHolding[] = holdingsResponse.map((holding) => {
      const quantity = toNumber(holding.quantity);
      const averageCost = toNumber(holding.average_price);
      const price = toNumber(holding.last_price || holding.close_price);
      const marketValue = quantity * price;
      const unrealizedPnl = toNumber(holding.pnl);
      const investedValue = readInvestedValue(holding as unknown as Record<string, unknown>, quantity, averageCost, marketValue, unrealizedPnl);
      const ticker = pickTicker(holding);
      const sourceKey = holding.isin || ticker || holding.instrument_token || 'unknown';
      const sourceFingerprint = `upstox:${account.remoteAccountId}:${sourceKey}:holding`;

      return {
        id: sourceFingerprint,
        uid: connection.uid,
        connectionId: connection.id,
        accountId,
        provider: 'upstox',
        remoteHoldingId: holding.instrument_token,
        isin: holding.isin,
        ticker,
        securityName: ticker || holding.isin || 'Upstox Holding',
        assetType: normalizeAssetType(ticker, holding.product),
        quantity,
        averageCost,
        investedValue,
        costCurrency: 'INR',
        price,
        priceCurrency: 'INR',
        marketValue,
        unrealizedPnl,
        accountCurrency: 'INR',
        syncedAt: Date.now(),
        isActive: true,
        sourceFingerprint,
        holdingKind: 'holding',
      };
    });

    const positions: ExternalHolding[] = positionsResponse.map((position) => {
      const quantity = toNumber(position.quantity);
      const averageCost = toNumber(position.average_price || position.buy_price);
      const price = toNumber(position.last_price || position.close_price);
      const multiplier = Math.max(1, toNumber(position.multiplier));
      const marketValue = quantity * price * multiplier;
      const unrealizedPnl = toNumber(position.pnl);
      const investedValue = readInvestedValue(position as unknown as Record<string, unknown>, quantity, averageCost, marketValue, unrealizedPnl);
      const ticker = pickTicker(position);
      const sourceKey = position.isin || ticker || position.instrument_token || 'unknown';
      const sourceFingerprint = `upstox:${account.remoteAccountId}:${sourceKey}:position`;

      return {
        id: sourceFingerprint,
        uid: connection.uid,
        connectionId: connection.id,
        accountId,
        provider: 'upstox',
        remoteHoldingId: position.instrument_token,
        isin: position.isin,
        ticker,
        securityName: ticker || position.isin || 'Upstox Position',
        assetType: normalizeAssetType(ticker, position.product),
        quantity,
        averageCost,
        investedValue,
        costCurrency: 'INR',
        price,
        priceCurrency: 'INR',
        marketValue,
        unrealizedPnl,
        accountCurrency: 'INR',
        syncedAt: Date.now(),
        isActive: true,
        sourceFingerprint,
        holdingKind: 'position',
        positionSide: normalizePositionSide(quantity),
      };
    });

    return [...holdings, ...positions];
  }
}
