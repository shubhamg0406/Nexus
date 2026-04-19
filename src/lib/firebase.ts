import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

if (typeof window !== 'undefined') {
  void enableIndexedDbPersistence(db).catch((err: unknown) => {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'failed-precondition') {
      console.warn('Persistence failed: multiple tabs open');
      return;
    }
    if (code === 'unimplemented') {
      console.warn('Persistence not supported in this browser');
      return;
    }
    console.warn('Persistence setup failed', err);
  });
}

googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export const defaultPortfolioId = import.meta.env.NEXT_PUBLIC_FIREBASE_PORTFOLIO_ID || 'default-portfolio';
