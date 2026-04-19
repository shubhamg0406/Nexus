import crypto from 'crypto';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';
import type { ExternalAccount } from '../providers/types.js';

const COLLECTION = 'external_accounts';

function now() {
  return Date.now();
}

function makeId(connectionId: string, remoteAccountId: string) {
  const digest = crypto.createHash('sha1').update(`${connectionId}:${remoteAccountId}`).digest('hex');
  return `acct_${digest}`;
}

export async function listExternalAccounts(uid: string, connectionId: string) {
  const snapshot = await getFirebaseAdminFirestore()
    .collection(COLLECTION)
    .where('uid', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as ExternalAccount)
    .filter((account) => account.connectionId === connectionId);
}

export async function upsertExternalAccounts(accounts: Array<Omit<ExternalAccount, 'id'>>) {
  if (accounts.length === 0) return 0;

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();

  for (const account of accounts) {
    const id = makeId(account.connectionId, account.remoteAccountId);
    batch.set(db.collection(COLLECTION).doc(id), { ...account, id, syncedAt: now() }, { merge: true });
  }

  await batch.commit();
  return accounts.length;
}

export async function deactivateMissingExternalAccounts(
  uid: string,
  connectionId: string,
  activeRemoteAccountIds: string[],
) {
  const accounts = await listExternalAccounts(uid, connectionId);
  const activeSet = new Set(activeRemoteAccountIds);
  const toDeactivate = accounts.filter((account) => account.isActive && !activeSet.has(account.remoteAccountId));

  if (toDeactivate.length === 0) return 0;

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();
  for (const account of toDeactivate) {
    batch.set(
      db.collection(COLLECTION).doc(account.id),
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
