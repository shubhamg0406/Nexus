import { SplitwiseApiError, SplitwiseClient } from '../../src/server/splitwise/splitwiseClient.js';
import { fetchAndBuildSummary, markConnectionError, markConnectionReconnectNeeded } from '../../src/server/splitwise/splitwiseService.js';
import { getSafeErrorReason, getUidFromBearer, parseOptionalPositiveInt, queryParam, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
  try {
    const uid = await getUidFromBearer(req);
    const limit = parseOptionalPositiveInt(queryParam(req, 'limit'));
    const groupId = parseOptionalPositiveInt(queryParam(req, 'groupId'));
    const summary = await fetchAndBuildSummary(uid, { limit, groupId }, new SplitwiseClient());
    res.status(200).json(summary);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (error instanceof SplitwiseApiError && error.status === 401) {
      const uid = await getUidFromBearer(req).catch(() => '');
      if (uid) {
        await markConnectionReconnectNeeded(uid, 'Splitwise session expired. Please reconnect.');
      }
      res.status(401).json({ error: 'Splitwise connection was revoked. Please reconnect.' });
      return;
    }
    const uid = await getUidFromBearer(req).catch(() => '');
    if (uid) {
      await markConnectionError(uid, getSafeErrorReason(error)).catch(() => undefined);
    }
    res.status(400).json({ error: getSafeErrorReason(error) });
  }
}

