import { SplitwiseClient } from '../../src/server/splitwise/splitwiseClient.js';
import {
  consumeOAuthState,
  finalizeConnectionFromOAuth,
  markConnectionError,
  synchronizeSplitwiseReceivable,
  verifySignedState,
} from '../../src/server/splitwise/splitwiseService.js';
import { doneUrl, getSafeErrorReason, queryParam, redirect, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
  const state = queryParam(req, 'state') || '';
  const code = queryParam(req, 'code') || '';
  const oauthError = queryParam(req, 'error') || '';

  if (oauthError === 'access_denied') {
    redirect(res, doneUrl('cancelled'));
    return;
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

    const client = new SplitwiseClient();
    const token = await client.exchangeCodeForAccessToken(code);
    await finalizeConnectionFromOAuth({
      uid: persistedState.uid,
      token,
      client,
    });
    await synchronizeSplitwiseReceivable(persistedState.uid, { client });

    redirect(res, doneUrl('success'));
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
    redirect(res, doneUrl('error', reason));
  }
}

