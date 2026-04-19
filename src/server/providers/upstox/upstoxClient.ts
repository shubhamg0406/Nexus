const UPSTOX_BASE_URL = 'https://api.upstox.com/v2';

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required config: ${name}`);
  }
  return value;
}

export type UpstoxTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
};

export type UpstoxProfileResponse = {
  user_id?: string;
  email?: string;
  user_name?: string;
  broker?: string;
  exchanges?: string[];
  products?: string[];
};

export type UpstoxHolding = {
  isin?: string;
  trading_symbol?: string;
  tradingsymbol?: string;
  quantity?: number;
  average_price?: number;
  last_price?: number;
  close_price?: number;
  pnl?: number;
  instrument_token?: string;
  product?: string;
};

export type UpstoxPosition = {
  isin?: string;
  trading_symbol?: string;
  tradingsymbol?: string;
  quantity?: number;
  buy_price?: number;
  average_price?: number;
  last_price?: number;
  close_price?: number;
  pnl?: number;
  instrument_token?: string;
  product?: string;
  multiplier?: number;
};

function parseApiPayload<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Upstox response malformed.');
  }

  const candidate = payload as { status?: string; data?: unknown; message?: string; errors?: Array<{ message?: string }> };
  if (candidate.status && candidate.status.toLowerCase() !== 'success') {
    const message = candidate.errors?.[0]?.message || candidate.message || 'Upstox request failed.';
    throw new Error(message);
  }

  return (candidate.data as T) ?? (payload as T);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: string }).message || 'Upstox request failed.')
      : `Upstox request failed (${response.status})`;
    throw new Error(message);
  }
  return parseApiPayload<T>(payload);
}

export class UpstoxClient {
  getAuthorizeUrl(state: string) {
    const url = new URL(`${UPSTOX_BASE_URL}/login/authorization/dialog`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', readRequiredEnv('UPSTOX_CLIENT_ID'));
    url.searchParams.set('redirect_uri', readRequiredEnv('UPSTOX_REDIRECT_URI'));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string) {
    const body = new URLSearchParams({
      code,
      client_id: readRequiredEnv('UPSTOX_CLIENT_ID'),
      client_secret: readRequiredEnv('UPSTOX_CLIENT_SECRET'),
      redirect_uri: readRequiredEnv('UPSTOX_REDIRECT_URI'),
      grant_type: 'authorization_code',
    });

    const response = await fetch(`${UPSTOX_BASE_URL}/login/authorization/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Api-Version': '2.0',
      },
      body,
    });

    return parseResponse<UpstoxTokenResponse>(response);
  }

  async getProfile(accessToken: string) {
    const response = await fetch(`${UPSTOX_BASE_URL}/user/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Api-Version': '2.0',
      },
    });

    return parseResponse<UpstoxProfileResponse>(response);
  }

  async getHoldings(accessToken: string) {
    const response = await fetch(`${UPSTOX_BASE_URL}/portfolio/long-term-holdings`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Api-Version': '2.0',
      },
    });

    const data = await parseResponse<UpstoxHolding[] | { holdings?: UpstoxHolding[] }>(response);
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.holdings) ? data.holdings : [];
  }

  async getPositions(accessToken: string) {
    const response = await fetch(`${UPSTOX_BASE_URL}/portfolio/short-term-positions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Api-Version': '2.0',
      },
    });

    const data = await parseResponse<UpstoxPosition[] | { positions?: UpstoxPosition[] }>(response);
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.positions) ? data.positions : [];
  }
}
