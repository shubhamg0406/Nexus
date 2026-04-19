import type { Request, Response, NextFunction } from 'express';
import { getFirebaseAdminAuth } from '../firebaseAdmin.js';

type VerifyTokenFn = (token: string) => Promise<{ uid: string; email?: string; name?: string }>;

function extractBearerToken(headerValue: string | undefined) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token.trim() || null;
}

export function buildRequireFirebaseUser(
  verifyToken: VerifyTokenFn = async (token) => {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
    };
  },
) {
  return async function requireFirebaseUser(req: Request, res: Response, next: NextFunction) {
    try {
      const token = extractBearerToken(req.header('authorization'));
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await verifyToken(token);
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

export const requireFirebaseUser = buildRequireFirebaseUser();
