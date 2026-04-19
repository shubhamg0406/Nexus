export type SplitwiseTokenPair = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string[];
};

export class SplitwiseApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SplitwiseApiError';
    this.status = status;
  }
}

type SplitwiseClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  oauthTokenUrl: string;
  oauthAuthorizeUrl: string;
};

export type SplitwiseCurrentUser = {
  id?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  default_currency?: string;
  picture?: {
    small?: string;
    medium?: string;
    large?: string;
    custom?: string;
  };
  balances?: Array<{
    amount?: string | number;
    currency_code?: string;
  }>;
  balance?: Array<{
    amount?: string | number;
    currency_code?: string;
  }>;
};

export type SplitwiseGroup = {
  id?: number;
  name?: string;
  updated_at?: string;
  members?: Array<{
    id?: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    balance?: Array<{
      amount?: string | number;
      currency_code?: string;
    }>;
  }>;
};

export type SplitwiseExpense = {
  id?: number;
  description?: string;
  cost?: string;
  currency_code?: string;
  date?: string;
  group_id?: number;
  payment?: boolean;
  created_by?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
};

function requireConfig(value: string | undefined, label: string) {
  if (!value?.trim()) {
    throw new Error(`Missing required Splitwise config: ${label}`);
  }
  return value.trim();
}

function toObjectFromUrlEncoded(body: string) {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function normalizeScope(rawScope: string | undefined) {
  if (!rawScope) return undefined;
  return rawScope
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getSplitwiseConfigFromEnv(): SplitwiseClientConfig {
  return {
    clientId: requireConfig(process.env.SPLITWISE_CLIENT_ID, 'SPLITWISE_CLIENT_ID'),
    clientSecret: requireConfig(process.env.SPLITWISE_CLIENT_SECRET, 'SPLITWISE_CLIENT_SECRET'),
    redirectUri: requireConfig(process.env.SPLITWISE_REDIRECT_URI, 'SPLITWISE_REDIRECT_URI'),
    apiBaseUrl: (process.env.SPLITWISE_API_BASE_URL || 'https://secure.splitwise.com/api/v3.0').trim(),
    oauthTokenUrl: (process.env.SPLITWISE_OAUTH_TOKEN_URL || 'https://secure.splitwise.com/oauth/token').trim(),
    oauthAuthorizeUrl: (process.env.SPLITWISE_OAUTH_AUTHORIZE_URL || 'https://secure.splitwise.com/oauth/authorize').trim(),
  };
}

export class SplitwiseClient {
  private readonly config: SplitwiseClientConfig;

  constructor(config: SplitwiseClientConfig = getSplitwiseConfigFromEnv()) {
    this.config = config;
  }

  private buildUrl(path: string) {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return `${this.config.apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  private async bearerRequest<T>({
    method,
    path,
    accessToken,
    data,
  }: {
    method: 'GET' | 'POST';
    path: string;
    accessToken: string;
    data?: Record<string, string | number | boolean | undefined>;
  }): Promise<T> {
    const url = this.buildUrl(path);
    const cleanData = data
      ? Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
      : undefined;

    const requestUrl = new URL(url);
    const headers: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    let body: URLSearchParams | undefined;
    if (method === 'GET' && cleanData) {
      for (const [key, value] of Object.entries(cleanData)) {
        requestUrl.searchParams.set(key, String(value));
      }
    }
    if (method === 'POST' && cleanData) {
      body = new URLSearchParams();
      for (const [key, value] of Object.entries(cleanData)) {
        body.set(key, String(value));
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(requestUrl.toString(), {
      method,
      headers,
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new SplitwiseApiError(`Splitwise API request failed (${response.status})`, response.status);
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  getAuthorizeUrl(state: string) {
    const url = new URL(this.config.oauthAuthorizeUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCodeForAccessToken(code: string): Promise<SplitwiseTokenPair> {
    const response = await fetch(this.config.oauthTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawBody = await response.text();
    const parsedBody = contentType.includes('application/json')
      ? (rawBody ? JSON.parse(rawBody) : {})
      : toObjectFromUrlEncoded(rawBody);
    if (!response.ok) {
      throw new SplitwiseApiError(`Splitwise OAuth token exchange failed (${response.status})`, response.status);
    }

    const accessToken = parsedBody.access_token || parsedBody.oauth_token;
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Splitwise OAuth token exchange did not return an access token.');
    }

    return {
      accessToken,
      refreshToken: typeof parsedBody.refresh_token === 'string' ? parsedBody.refresh_token : undefined,
      tokenType: typeof parsedBody.token_type === 'string' ? parsedBody.token_type : undefined,
      scope: normalizeScope(typeof parsedBody.scope === 'string' ? parsedBody.scope : undefined),
    };
  }

  async getCurrentUser(token: SplitwiseTokenPair) {
    const response = await this.bearerRequest<{ user?: SplitwiseCurrentUser; current_user?: SplitwiseCurrentUser }>({
      method: 'GET',
      path: '/get_current_user',
      accessToken: token.accessToken,
    });
    return response.current_user || response.user || {};
  }

  async getGroups(token: SplitwiseTokenPair) {
    const response = await this.bearerRequest<{ groups?: SplitwiseGroup[] }>({
      method: 'GET',
      path: '/get_groups',
      accessToken: token.accessToken,
    });
    return Array.isArray(response.groups) ? response.groups : [];
  }

  async getExpenses(
    token: SplitwiseTokenPair,
    params: { limit?: number; offset?: number; groupId?: number },
  ) {
    const response = await this.bearerRequest<{ expenses?: SplitwiseExpense[] }>({
      method: 'GET',
      path: '/get_expenses',
      accessToken: token.accessToken,
      data: {
        limit: params.limit,
        offset: params.offset,
        group_id: params.groupId,
      },
    });
    return Array.isArray(response.expenses) ? response.expenses : [];
  }
}
