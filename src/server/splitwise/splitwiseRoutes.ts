import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getFirebaseAdminAuth } from '../firebaseAdmin.js';
import { requireFirebaseUser } from '../auth/requireFirebaseUser.js';
import { SplitwiseApiError, SplitwiseClient } from './splitwiseClient.js';
import {
  consumeOAuthState,
  createSignedState,
  fetchAndBuildSummary,
  finalizeConnectionFromOAuth,
  getStatusForUid,
  markConnectionError,
  markConnectionReconnectNeeded,
  saveOAuthState,
  softRevokeConnection,
  synchronizeSplitwiseReceivable,
  verifySignedState,
} from './splitwiseService.js';

function getSafeErrorReason(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown error';
  const message = error.message || 'Unknown error';
  return message.slice(0, 200);
}

function parseOptionalPositiveInt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getPopupDoneUrl(result: 'success' | 'error' | 'cancelled', reason?: string) {
  const params = new URLSearchParams();
  params.set('result', result);
  if (reason) params.set('reason', reason);
  return `./done?${params.toString()}`;
}

async function getUidFromConnectRequest(req: Request) {
  const queryToken = typeof req.query.idToken === 'string' ? req.query.idToken : '';
  const authHeader = req.header('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const token = queryToken || bearer;
  if (!token) {
    throw new Error('Unauthorized');
  }
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return decoded.uid;
}

export function createSplitwiseRouter(client?: SplitwiseClient) {
  const router = Router();
  const getClient = () => client || new SplitwiseClient();

  router.get('/connect', async (req: Request, res: Response) => {
    try {
      const uid = await getUidFromConnectRequest(req);
      const nonce = crypto.randomBytes(16).toString('hex');
      const state = createSignedState({ uid, nonce });
      const expiresAt = Date.now() + 10 * 60 * 1000;

      await saveOAuthState({
        uid,
        state,
        nonce,
        expiresAt,
        createdAt: Date.now(),
      });

      const authorizeUrl = getClient().getAuthorizeUrl(state);
      if (req.query.format === 'json') {
        return res.json({ authorizeUrl });
      }
      return res.redirect(authorizeUrl);
    } catch (error) {
      const reason = getSafeErrorReason(error);
      if (req.query.format === 'json') {
        return res.status(400).json({ error: reason });
      }
      return res.redirect(getPopupDoneUrl('error', reason));
    }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthError === 'access_denied') {
      return res.redirect(getPopupDoneUrl('cancelled'));
    }

    try {
      if (!state || !code) {
        throw new Error('Splitwise callback is missing required OAuth query params.');
      }

      const verifiedState = verifySignedState(state);
      const persistedState = await consumeOAuthState(verifiedState.uid);

      if (persistedState.uid !== verifiedState.uid || persistedState.state !== state) {
        throw new Error('Splitwise callback state mismatch.');
      }

      const token = await getClient().exchangeCodeForAccessToken(code);
      await finalizeConnectionFromOAuth({
        uid: persistedState.uid,
        token,
        client: getClient(),
      });

      await synchronizeSplitwiseReceivable(persistedState.uid, { client: getClient() });
      return res.redirect(getPopupDoneUrl('success'));
    } catch (error) {
      const reason = getSafeErrorReason(error);
      try {
        const verifiedState = state ? verifySignedState(state) : null;
        if (verifiedState?.uid) {
          await markConnectionError(verifiedState.uid, reason);
        }
      } catch {
        // ignored
      }

      return res.redirect(getPopupDoneUrl('error', reason));
    }
  });

  router.get('/done', (req: Request, res: Response) => {
    const result = typeof req.query.result === 'string' ? req.query.result : 'error';
    const reason = typeof req.query.reason === 'string' ? req.query.reason : '';
    const payloadType =
      result === 'success'
        ? 'SPLITWISE_CONNECTED'
        : result === 'cancelled'
          ? 'SPLITWISE_CANCELLED'
          : 'SPLITWISE_ERROR';
    const payload = JSON.stringify({ type: payloadType, reason });

    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html>
  <body>
    <script>
      (function () {
        try {
          if (window.opener) {
            window.opener.postMessage(${payload}, '*');
          }
        } catch (_) {}
        window.close();
      })();
    </script>
  </body>
</html>`);
  });

  router.get('/status', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const result = await getStatusForUid(req.user!.uid);
      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch Splitwise status.' });
    }
  });

  router.post('/sync', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const synced = await synchronizeSplitwiseReceivable(req.user!.uid);
      return res.json({
        success: true,
        value: synced.value,
        currency: synced.currency,
        lastSyncedAt: synced.lastSyncedAt,
      });
    } catch (error) {
      if (error instanceof SplitwiseApiError && error.status === 401) {
        await markConnectionReconnectNeeded(req.user!.uid, 'Splitwise session expired. Please reconnect.');
        return res.status(401).json({ error: 'Splitwise session expired. Please reconnect.' });
      }
      if (error instanceof SplitwiseApiError && error.status === 429) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Splitwise sync is temporarily rate-limited. Please retry shortly.' });
      }
      if (error instanceof SplitwiseApiError && error.status >= 500) {
        await markConnectionError(req.user!.uid, 'Splitwise API is currently unavailable.');
        return res.status(503).json({ error: 'Splitwise API is currently unavailable. Showing last known balance.' });
      }

      return res.status(400).json({ error: getSafeErrorReason(error) });
    }
  });

  router.post('/disconnect', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      await softRevokeConnection(req.user!.uid);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to disconnect Splitwise.' });
    }
  });

  router.get('/summary', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const limit = parseOptionalPositiveInt(req.query.limit);
      const groupId = parseOptionalPositiveInt(req.query.groupId);
      const summary = await fetchAndBuildSummary(
        req.user!.uid,
        { limit, groupId },
        getClient(),
      );
      return res.json(summary);
    } catch (error) {
      if (error instanceof SplitwiseApiError && error.status === 401) {
        await markConnectionReconnectNeeded(req.user!.uid, 'Splitwise session expired. Please reconnect.');
        return res.status(401).json({ error: 'Splitwise connection was revoked. Please reconnect.' });
      }
      const reason = getSafeErrorReason(error);
      await markConnectionError(req.user!.uid, reason).catch(() => undefined);
      return res.status(400).json({ error: reason });
    }
  });

  return router;
}
