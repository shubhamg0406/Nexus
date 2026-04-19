import { softRevokeConnection } from '../../src/server/splitwise/splitwiseService.js';
import { getUidFromBearer, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
  try {
    const uid = await getUidFromBearer(req);
    await softRevokeConnection(uid);
    res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.status(500).json({ error: 'Failed to disconnect Splitwise.' });
  }
}

