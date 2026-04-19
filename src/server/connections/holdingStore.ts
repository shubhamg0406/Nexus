import crypto from 'crypto';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';
import type { ExternalAssetOverride, ExternalHolding } from '../providers/types.js';

const HOLDINGS_COLLECTION = 'external_holdings';
const OVERRIDES_COLLECTION = 'external_asset_overrides';

function now() {
  return Date.now();
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

function makeHoldingId(connectionId: string, sourceFingerprint: string) {
  const digest = crypto.createHash('sha1').update(`${connectionId}:${sourceFingerprint}`).digest('hex');
  return `hold_${digest}`;
}

function makeOverrideId(uid: string, holdingId: string) {
  return `${uid}:${holdingId}`;
}

export async function listExternalHoldings(uid: string, connectionId: string) {
  const snapshot = await getFirebaseAdminFirestore()
    .collection(HOLDINGS_COLLECTION)
    .where('uid', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as ExternalHolding)
    .filter((holding) => holding.connectionId === connectionId);
}

export async function listActiveExternalHoldings(uid: string, connectionId: string) {
  const holdings = await listExternalHoldings(uid, connectionId);
  return holdings.filter((holding) => holding.isActive);
}

export async function upsertExternalHoldings(holdings: Array<Omit<ExternalHolding, 'id'>>) {
  if (holdings.length === 0) return 0;

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();

  for (const holding of holdings) {
    const id = makeHoldingId(holding.connectionId, holding.sourceFingerprint);
    batch.set(db.collection(HOLDINGS_COLLECTION).doc(id), { ...holding, id, syncedAt: now() }, { merge: true });
  }

  await batch.commit();
  return holdings.length;
}

export async function deactivateMissingExternalHoldings(
  uid: string,
  connectionId: string,
  activeFingerprints: string[],
) {
  const holdings = await listExternalHoldings(uid, connectionId);
  const activeSet = new Set(activeFingerprints);
  const toDeactivate = holdings.filter((holding) => holding.isActive && !activeSet.has(holding.sourceFingerprint));

  if (toDeactivate.length === 0) return 0;

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();
  for (const holding of toDeactivate) {
    batch.set(
      db.collection(HOLDINGS_COLLECTION).doc(holding.id),
      {
        isActive: false,
        syncedAt: now(),
      },
      { merge: true },
    );
  }

  await batch.commit();
  return toDeactivate.length;
}

export async function deactivateAllExternalHoldings(uid: string, connectionId: string) {
  const holdings = await listExternalHoldings(uid, connectionId);
  const toDeactivate = holdings.filter((holding) => holding.isActive);
  if (toDeactivate.length === 0) return 0;

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();
  for (const holding of toDeactivate) {
    batch.set(
      db.collection(HOLDINGS_COLLECTION).doc(holding.id),
      {
        isActive: false,
        syncedAt: now(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  return toDeactivate.length;
}

export async function getExternalAssetOverride(uid: string, holdingId: string) {
  const snapshot = await getFirebaseAdminFirestore()
    .collection(OVERRIDES_COLLECTION)
    .doc(makeOverrideId(uid, holdingId))
    .get();

  if (!snapshot.exists) return null;
  return snapshot.data() as ExternalAssetOverride;
}

export async function listExternalAssetOverrides(uid: string, holdingIds: string[]) {
  if (holdingIds.length === 0) return [] as ExternalAssetOverride[];

  const uniqueHoldingIds = Array.from(new Set(holdingIds));
  const db = getFirebaseAdminFirestore();
  const docs = await Promise.all(
    uniqueHoldingIds.map((holdingId) => db.collection(OVERRIDES_COLLECTION).doc(makeOverrideId(uid, holdingId)).get()),
  );

  return docs
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => snapshot.data() as ExternalAssetOverride);
}

export async function upsertExternalAssetOverride(
  uid: string,
  holdingId: string,
  patch: Partial<Omit<ExternalAssetOverride, 'uid' | 'holdingId' | 'updatedAt'>>,
) {
  const payload = omitUndefined({
    uid,
    holdingId,
    updatedAt: now(),
    customLabel: patch.customLabel,
    ownerOverride: patch.ownerOverride,
    assetClassOverride: patch.assetClassOverride,
    hidden: patch.hidden,
    notes: patch.notes,
  }) as ExternalAssetOverride;

  await getFirebaseAdminFirestore()
    .collection(OVERRIDES_COLLECTION)
    .doc(makeOverrideId(uid, holdingId))
    .set(payload, { merge: true });

  return payload;
}
