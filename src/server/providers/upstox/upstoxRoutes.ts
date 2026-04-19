import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireFirebaseUser } from '../../auth/requireFirebaseUser.js';
import {
  buildSettingsRedirect,
  buildUpstoxAuthorizeUrl,
  completeUpstoxCallback,
  disconnectUpstox,
  getUpstoxStatus,
  listUpstoxHoldingsWithOverrides,
  runUpstoxSync,
  saveUpstoxHoldingOverride,
  verifySignedState,
} from './upstoxService.js';
import { updateExternalConnectionStatus } from '../../connections/connectionStore.js';

function safeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 250);
  }
  return 'Unknown error';
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

export function createUpstoxRouter() {
  const router = Router();

  router.get('/connect', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const authorizeUrl = await buildUpstoxAuthorizeUrl(req.user!.uid);
      if (req.query.format === 'json') {
        return res.json({ authorizeUrl });
      }
      return res.redirect(authorizeUrl);
    } catch (error) {
      const reason = safeError(error);
      if (req.query.format === 'json') {
        return res.status(400).json({
          error: reason,
          hint: 'Configure Upstox + connected-account server env vars, then retry.',
        });
      }
      return res.redirect(buildSettingsRedirect({ upstox: 'error', reason }));
    }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    try {
      if (!state || !code) {
        throw new Error('Upstox callback is missing required query parameters.');
      }

      await completeUpstoxCallback({ state, code });
      return res.redirect(buildSettingsRedirect({ upstox: 'success' }));
    } catch (error) {
      const reason = safeError(error);

      try {
        const verified = state ? verifySignedState(state) : null;
        if (verified?.uid) {
          await updateExternalConnectionStatus(verified.uid, 'upstox', 'error', {
            lastError: reason,
          });
        }
      } catch {
        // Ignore callback state errors.
      }

      return res.redirect(buildSettingsRedirect({ upstox: 'error', reason }));
    }
  });

  router.get('/status', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const status = await getUpstoxStatus(req.user!.uid);
      return res.json(status);
    } catch (error) {
      return res.status(500).json({ error: safeError(error) });
    }
  });

  router.post('/refresh', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const result = await runUpstoxSync(req.user!.uid);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  router.post('/disconnect', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const result = await disconnectUpstox(req.user!.uid);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  router.get('/holdings', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const holdings = await listUpstoxHoldingsWithOverrides(req.user!.uid);
      return res.json({ holdings });
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  router.post('/overrides/:holdingId', requireFirebaseUser, async (req: Request, res: Response) => {
    try {
      const holdingId = String(req.params.holdingId || '').trim();
      if (!holdingId) {
        return res.status(400).json({ error: 'holdingId is required.' });
      }

      const override = await saveUpstoxHoldingOverride(req.user!.uid, holdingId, {
        customLabel: typeof req.body?.customLabel === 'string' ? req.body.customLabel.trim() || undefined : undefined,
        ownerOverride: typeof req.body?.ownerOverride === 'string' ? req.body.ownerOverride.trim() || undefined : undefined,
        assetClassOverride: typeof req.body?.assetClassOverride === 'string' ? req.body.assetClassOverride.trim() || undefined : undefined,
        notes: typeof req.body?.notes === 'string' ? req.body.notes.trim() || undefined : undefined,
        hidden: req.body?.hidden == null ? undefined : parseBoolean(req.body.hidden),
      });

      return res.json({ override });
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  // Placeholder for future platform cron/background sync trigger.
  router.post('/sync/scheduled', async (_req: Request, res: Response) => {
    return res.status(501).json({ error: 'Scheduled sync is not enabled yet.' });
  });

  return router;
}
