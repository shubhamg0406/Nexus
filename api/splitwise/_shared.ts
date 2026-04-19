import { getFirebaseAdminAuth } from '../../src/server/firebaseAdmin.js';

export type RequestLike = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};

export type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
  redirect?: (statusOrUrl: number | string, url?: string) => void;
};

export function queryParam(req: RequestLike, key: string) {
  const raw = req.query[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function headerValue(req: RequestLike, key: string) {
  const value = req.headers[key.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function bearerFromHeader(req: RequestLike) {
  const header = headerValue(req, 'authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

export async function getUidFromBearer(req: RequestLike) {
  const token = bearerFromHeader(req);
  if (!token) {
    throw new Error('Unauthorized');
  }
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return decoded.uid;
}

export async function getUidFromConnectRequest(req: RequestLike) {
  const queryToken = queryParam(req, 'idToken') || '';
  const token = queryToken || bearerFromHeader(req);
  if (!token) {
    throw new Error('Unauthorized');
  }
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return decoded.uid;
}

export function redirect(res: ResponseLike, location: string, statusCode: number = 302) {
  if (typeof res.redirect === 'function') {
    res.redirect(statusCode, location);
    return;
  }

  res.status(statusCode);
  res.setHeader('Location', location);
  res.end();
}

export function getSafeErrorReason(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown error';
  const message = error.message || 'Unknown error';
  return message.slice(0, 200);
}

export function parseOptionalPositiveInt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function doneUrl(result: 'success' | 'error' | 'cancelled', reason?: string) {
  const params = new URLSearchParams();
  params.set('result', result);
  if (reason) params.set('reason', reason);
  return `./done?${params.toString()}`;
}
