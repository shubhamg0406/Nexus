import crypto from 'crypto';
import { SplitwiseClient } from '../../src/server/splitwise/splitwiseClient.js';
import { createSignedState, saveOAuthState } from '../../src/server/splitwise/splitwiseService.js';
import { doneUrl, getSafeErrorReason, getUidFromConnectRequest, queryParam, redirect, type RequestLike, type ResponseLike } from './_shared.js';

export default async function handler(req: RequestLike, res: ResponseLike) {
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

    const authorizeUrl = new SplitwiseClient().getAuthorizeUrl(state);
    if (queryParam(req, 'format') === 'json') {
      res.status(200).json({ authorizeUrl });
      return;
    }

    redirect(res, authorizeUrl);
  } catch (error) {
    const reason = getSafeErrorReason(error);
    if (queryParam(req, 'format') === 'json') {
      res.status(400).json({ error: reason });
      return;
    }
    redirect(res, doneUrl('error', reason));
  }
}

