import crypto from 'crypto';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';
import type { ExternalProvider, ExternalSyncRun } from '../providers/types.js';

const COLLECTION = 'external_sync_runs';

function now() {
  return Date.now();
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

export async function startExternalSyncRun(input: {
  uid: string;
  provider: ExternalProvider;
  connectionId: string;
}) {
  const id = crypto.randomUUID();
  const run: ExternalSyncRun = {
    id,
    uid: input.uid,
    provider: input.provider,
    connectionId: input.connectionId,
    startedAt: now(),
    status: 'failed',
    metrics: {
      accountsUpserted: 0,
      holdingsUpserted: 0,
      holdingsDeactivated: 0,
    },
  };

  await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).set(run);
  return run;
}

export async function finishExternalSyncRun(
  id: string,
  patch: Pick<ExternalSyncRun, 'status' | 'metrics'> & Partial<Pick<ExternalSyncRun, 'errorSummary'>>,
) {
  const payload = omitUndefined({
    status: patch.status,
    metrics: patch.metrics,
    errorSummary: patch.errorSummary,
    finishedAt: now(),
  });

  await getFirebaseAdminFirestore().collection(COLLECTION).doc(id).set(
    payload,
    { merge: true },
  );
}

export async function listLatestSyncRuns(uid: string, provider: ExternalProvider, limit = 5) {
  const snapshot = await getFirebaseAdminFirestore()
    .collection(COLLECTION)
    .where('uid', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as ExternalSyncRun)
    .filter((run) => run.provider === provider)
    .sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0))
    .slice(0, limit);
}
