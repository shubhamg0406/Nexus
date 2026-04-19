import { SplitwiseApiError } from '../../src/server/splitwise/splitwiseClient.js';
import { markConnectionError, markConnectionReconnectNeeded, synchronizeSplitwiseReceivable } from '../../src/server/splitwise/splitwiseService.js';
import { getSafeErrorReason, getUidFromBearer, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
  let uid = '';
  try {
    uid = await getUidFromBearer(req);
    const synced = await synchronizeSplitwiseReceivable(uid);
    res.status(200).json({
      success: true,
      value: synced.value,
      currency: synced.currency,
      lastSyncedAt: synced.lastSyncedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (error instanceof SplitwiseApiError && error.status === 401) {
      if (uid) {
        await markConnectionReconnectNeeded(uid, 'Splitwise session expired. Please reconnect.');
      }
      res.status(401).json({ error: 'Splitwise session expired. Please reconnect.' });
      return;
    }
    if (error instanceof SplitwiseApiError && error.status === 429) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Splitwise sync is temporarily rate-limited. Please retry shortly.' });
      return;
    }
    if (error instanceof SplitwiseApiError && error.status >= 500) {
      if (uid) {
        await markConnectionError(uid, 'Splitwise API is currently unavailable.');
      }
      res.status(503).json({ error: 'Splitwise API is currently unavailable. Showing last known balance.' });
      return;
    }

    res.status(400).json({ error: getSafeErrorReason(error) });
  }
}

