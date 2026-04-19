import { Router } from 'express';
import type { Request, Response } from 'express';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.js';
import { requireFirebaseUser } from '../auth/requireFirebaseUser.js';
import { disconnectUpstox, getUpstoxStatus, listUpstoxHoldingsWithOverrides, runUpstoxSync } from '../providers/upstox/upstoxService.js';
import { fetchAndBuildSummary, getStatusForUid, softRevokeConnection, synchronizeSplitwiseReceivable } from '../splitwise/splitwiseService.js';

type PortfolioMember = {
  email?: string;
  role?: 'owner' | 'partner';
  uid?: string;
};

type PortfolioDocument = {
  id: string;
  ownerUid?: string;
  ownerEmail?: string;
  members?: PortfolioMember[];
  memberEmails?: string[];
};

function normalize(value?: string) {
  return (value || '').trim().toLowerCase();
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 250);
  return 'Unknown error';
}

function memberMatchesUser(member: PortfolioMember, user: { uid: string; email?: string }) {
  if (member.uid && member.uid === user.uid) return true;
  const memberEmail = normalize(member.email);
  const userEmail = normalize(user.email);
  return Boolean(memberEmail && userEmail && memberEmail === userEmail);
}

function isPortfolioMember(doc: PortfolioDocument, user: { uid: string; email?: string }) {
  const userEmail = normalize(user.email);
  const memberEmails = Array.isArray(doc.memberEmails) ? doc.memberEmails.map(normalize) : [];
  if (userEmail && memberEmails.includes(userEmail)) return true;
  const members = Array.isArray(doc.members) ? doc.members : [];
  return members.some((member) => memberMatchesUser(member, user));
}

function isPortfolioOwner(doc: PortfolioDocument, user: { uid: string; email?: string }) {
  if (doc.ownerUid && doc.ownerUid === user.uid) return true;
  if (normalize(doc.ownerEmail) && normalize(doc.ownerEmail) === normalize(user.email)) return true;
  const members = Array.isArray(doc.members) ? doc.members : [];
  return members.some((member) => member.role === 'owner' && memberMatchesUser(member, user));
}

async function getPortfolioOrThrow(portfolioId: string) {
  const snapshot = await getFirebaseAdminFirestore().collection('portfolios').doc(portfolioId).get();
  if (!snapshot.exists) {
    throw new Error('Portfolio not found.');
  }
  const raw = snapshot.data() as Omit<PortfolioDocument, 'id'>;
  return {
    id: snapshot.id,
    ...raw,
  } satisfies PortfolioDocument;
}

function memberLabel(member: PortfolioMember & { uid: string }) {
  const email = normalize(member.email);
  if (email) return email;
  return `member:${member.uid.slice(0, 8)}`;
}

export function createSharedIntegrationsRouter() {
  const router = Router();

  router.get('/shared', requireFirebaseUser, async (req: Request, res: Response) => {
    const portfolioId = typeof req.query.portfolioId === 'string' ? req.query.portfolioId.trim() : '';
    if (!portfolioId) {
      return res.status(400).json({ error: 'portfolioId is required.' });
    }

    try {
      const portfolio = await getPortfolioOrThrow(portfolioId);
      const user = req.user!;
      if (!isPortfolioMember(portfolio, user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const members = (Array.isArray(portfolio.members) ? portfolio.members : [])
        .filter((member): member is PortfolioMember & { uid: string } => typeof member.uid === 'string' && member.uid.trim().length > 0);

      const envelopes = await Promise.all(members.map(async (member) => {
        const uid = member.uid.trim();

        let upstoxStatus: Awaited<ReturnType<typeof getUpstoxStatus>>;
        let upstoxHoldings: Awaited<ReturnType<typeof listUpstoxHoldingsWithOverrides>>;
        let upstoxError: string | undefined;
        try {
          [upstoxStatus, upstoxHoldings] = await Promise.all([
            getUpstoxStatus(uid),
            listUpstoxHoldingsWithOverrides(uid),
          ]);
        } catch (error) {
          upstoxStatus = {
            provider: 'upstox',
            status: 'error',
            displayName: 'Upstox',
            accounts: [],
            holdingsSummary: {
              totalMarketValueByCurrency: [],
              totalHoldingsCount: 0,
              totalPositionsCount: 0,
            },
            syncRuns: [],
          };
          upstoxHoldings = [];
          upstoxError = safeError(error);
        }

        let splitwiseStatus: Awaited<ReturnType<typeof getStatusForUid>>;
        let splitwiseSummary: Awaited<ReturnType<typeof fetchAndBuildSummary>> | null = null;
        let splitwiseError: string | undefined;
        try {
          splitwiseStatus = await getStatusForUid(uid);
          if (splitwiseStatus.status === 'connected') {
            splitwiseSummary = await fetchAndBuildSummary(uid, { limit: 20 });
          }
        } catch (error) {
          splitwiseStatus = {
            connected: false,
            status: 'error',
            lastError: safeError(error),
          };
          splitwiseSummary = null;
          splitwiseError = safeError(error);
        }

        return {
          member: {
            uid,
            email: member.email || '',
            role: member.role || 'partner',
            label: memberLabel(member),
          },
          upstox: {
            status: upstoxStatus,
            holdings: upstoxHoldings,
            error: upstoxError,
          },
          splitwise: {
            status: splitwiseStatus,
            summary: splitwiseSummary,
            error: splitwiseError,
          },
        };
      }));

      return res.json({
        portfolioId,
        members: envelopes,
      });
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  router.post('/shared/disconnect', requireFirebaseUser, async (req: Request, res: Response) => {
    const portfolioId = typeof req.body?.portfolioId === 'string' ? req.body.portfolioId.trim() : '';
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';
    const targetUid = typeof req.body?.targetUid === 'string' ? req.body.targetUid.trim() : '';

    if (!portfolioId || !provider || !targetUid) {
      return res.status(400).json({ error: 'portfolioId, provider, and targetUid are required.' });
    }
    if (provider !== 'upstox' && provider !== 'splitwise') {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }

    try {
      const portfolio = await getPortfolioOrThrow(portfolioId);
      const user = req.user!;
      if (!isPortfolioMember(portfolio, user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const allowed = targetUid === user.uid || isPortfolioOwner(portfolio, user);
      if (!allowed) {
        return res.status(403).json({ error: 'Only portfolio owner can disconnect other members.' });
      }

      if (provider === 'upstox') {
        const result = await disconnectUpstox(targetUid);
        return res.json({ success: true, provider, targetUid, result });
      }

      await softRevokeConnection(targetUid);
      return res.json({ success: true, provider, targetUid });
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  router.post('/shared/refresh', requireFirebaseUser, async (req: Request, res: Response) => {
    const portfolioId = typeof req.body?.portfolioId === 'string' ? req.body.portfolioId.trim() : '';
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';
    const targetUid = typeof req.body?.targetUid === 'string' ? req.body.targetUid.trim() : '';

    if (!portfolioId || !provider || !targetUid) {
      return res.status(400).json({ error: 'portfolioId, provider, and targetUid are required.' });
    }
    if (provider !== 'upstox' && provider !== 'splitwise') {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }

    try {
      const portfolio = await getPortfolioOrThrow(portfolioId);
      const user = req.user!;
      if (!isPortfolioMember(portfolio, user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const allowed = targetUid === user.uid || isPortfolioOwner(portfolio, user);
      if (!allowed) {
        return res.status(403).json({ error: 'Only portfolio owner can refresh other members.' });
      }

      if (provider === 'upstox') {
        const result = await runUpstoxSync(targetUid);
        return res.json({ success: true, provider, targetUid, result });
      }

      const result = await synchronizeSplitwiseReceivable(targetUid);
      return res.json({ success: true, provider, targetUid, result });
    } catch (error) {
      return res.status(400).json({ error: safeError(error) });
    }
  });

  return router;
}
