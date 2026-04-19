import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';
import type { ExternalConnection, ExternalConnectionStatus, ExternalProvider } from '../providers/types.js';

const COLLECTION = 'external_connections';

function now() {
  return Date.now();
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

function toConnectionId(uid: string, provider: ExternalProvider) {
  return `${uid}:${provider}`;
}

export async function getExternalConnection(uid: string, provider: ExternalProvider) {
  const id = toConnectionId(uid, provider);
  const snapshot = await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) return null;
  return snapshot.data() as ExternalConnection;
}

export async function upsertExternalConnection(
  input: Omit<ExternalConnection, 'id' | 'updatedAt'> & { id?: string },
) {
  const id = input.id || toConnectionId(input.uid, input.provider);
  const payload = omitUndefined({
    ...input,
    id,
    updatedAt: now(),
  }) as ExternalConnection;

  await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).set(payload, { merge: true });
  return payload;
}

export async function updateExternalConnectionStatus(
  uid: string,
  provider: ExternalProvider,
  status: ExternalConnectionStatus,
  patch?: Partial<ExternalConnection>,
) {
  const id = toConnectionId(uid, provider);
  const payload = omitUndefined({
    uid,
    provider,
    id,
    status,
    updatedAt: now(),
    ...(patch || {}),
  });

  await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).set(
    payload,
    { merge: true },
  );
}

export async function clearExternalConnectionToken(uid: string, provider: ExternalProvider) {
  const id = toConnectionId(uid, provider);
  await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).set(
    {
      uid,
      provider,
      id,
      tokenBlob: FieldValue.delete(),
      scopes: FieldValue.delete(),
      updatedAt: now(),
    },
    { merge: true },
  );
}

export function sanitizeExternalConnection(connection: ExternalConnection | null) {
  if (!connection) return null;
  const { tokenBlob, ...safe } = connection;
  return safe;
}
