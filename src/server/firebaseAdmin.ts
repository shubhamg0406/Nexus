import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readServiceAccountFromEnv(): FirebaseServiceAccount | null {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

function ensureFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const serviceAccount = readServiceAccountFromEnv();
  if (serviceAccount) {
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    });
  }

  return initializeApp();
}

export function getFirebaseAdminAuth() {
  return getAuth(ensureFirebaseAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(ensureFirebaseAdminApp());
}
