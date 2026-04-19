import { describe, expect, it } from 'vitest';
import {
  buildPortfolioName,
  createDefaultPortfolio,
  derivePortfolioCurrencies,
  getActivePortfolioStorageKey,
  getPersonalPortfolioId,
  isLegacySelfPortfolioCandidate,
  normalizePortfolio,
  removeLegacySelfPortfolioDuplicates,
  shouldHydratePersonalPortfolioFromLegacy,
  selectActivePortfolioId,
} from './portfolioHelpers';

describe('portfolioHelpers', () => {
  it('creates a personal portfolio for the signed-in user', () => {
    const uid = 'user-123';
    const portfolio = createDefaultPortfolio('shubhamg266@gmail.com', uid, getPersonalPortfolioId(uid));

    expect(portfolio.name).toBe('My Portfolio');
    expect(portfolio.ownerEmail).toBe('shubhamg266@gmail.com');
    expect(portfolio.ownerUid).toBe(uid);
    expect(portfolio.isPersonal).toBe(true);
    expect(portfolio.primaryCurrency).toBe('CAD');
    expect(portfolio.secondaryCurrency).toBe('USD');
    expect(portfolio.currencySettingsVersion).toBe(1);
    expect(portfolio.members).toEqual([{ email: 'shubhamg266@gmail.com', role: 'owner' }]);
    expect(portfolio.memberEmails).toEqual(['shubhamg266@gmail.com']);
  });

  it('creates a shared-style portfolio name when not using the personal portfolio id', () => {
    const portfolio = createDefaultPortfolio('friend@example.com', 'user-999', 'shared-portfolio');

    expect(portfolio.name).toBe("friend@example.com's Portfolio");
    expect(portfolio.isPersonal).toBe(false);
  });

  it('normalizes missing portfolio metadata safely', () => {
    const normalized = normalizePortfolio({
      assets: [],
      assetClasses: [],
      members: [{ email: 'Partner@Example.com', role: 'partner' }],
    });

    expect(normalized.baseCurrency).toBe('ORIGINAL');
    expect(normalized.primaryCurrency).toBe('CAD');
    expect(normalized.secondaryCurrency).toBe('USD');
    expect(normalized.memberEmails).toEqual(['Partner@Example.com']);
    expect(normalized.name).toBe('');
    expect(normalized.ownerEmail).toBe('');
    expect(normalized.ownerUid).toBe('');
    expect(normalized.isPersonal).toBe(false);
  });

  it('builds a readable fallback portfolio name', () => {
    expect(
      buildPortfolioName(
        normalizePortfolio({
          members: [{ email: 'mayuri@example.com', role: 'owner' }],
        }),
        'portfolio-abc12345',
      ),
    ).toBe("mayuri@example.com's Portfolio");
  });

  it('prefers the current active portfolio when it is still accessible', () => {
    const activeId = selectActivePortfolioId({
      currentActivePortfolioId: 'shared-1',
      persistedPortfolioId: 'user-123',
      personalPortfolioId: 'user-123',
      availablePortfolios: [
        { id: 'user-123', isPersonal: true },
        { id: 'shared-1', isPersonal: false },
      ],
    });

    expect(activeId).toBe('shared-1');
  });

  it('falls back to the persisted portfolio when the current selection disappears', () => {
    const activeId = selectActivePortfolioId({
      currentActivePortfolioId: 'missing',
      persistedPortfolioId: 'shared-2',
      personalPortfolioId: 'user-123',
      availablePortfolios: [
        { id: 'user-123', isPersonal: true },
        { id: 'shared-2', isPersonal: false },
      ],
    });

    expect(activeId).toBe('shared-2');
  });

  it('falls back to the personal portfolio by default', () => {
    const activeId = selectActivePortfolioId({
      currentActivePortfolioId: null,
      persistedPortfolioId: null,
      personalPortfolioId: 'user-123',
      availablePortfolios: [
        { id: 'shared-2', isPersonal: false },
        { id: 'user-123', isPersonal: true },
      ],
    });

    expect(activeId).toBe('user-123');
  });

  it('generates a stable local-storage key per user', () => {
    expect(getActivePortfolioStorageKey('abc')).toBe('nexus-active-portfolio:abc');
  });

  it('removes a legacy self-owned duplicate when a personal portfolio exists', () => {
    const portfolios = removeLegacySelfPortfolioDuplicates(
      [
        {
          id: 'user-123',
          name: 'My Portfolio',
          ownerEmail: 'shubhamg266@gmail.com',
          isPersonal: true,
        },
        {
          id: 'default-portfolio',
          name: "shubhamg266@gmail.com's Portfolio",
          ownerEmail: 'shubhamg266@gmail.com',
          isPersonal: false,
        },
        {
          id: 'shared-1',
          name: 'Mayuri Garg Portfolio',
          ownerEmail: 'mayuri.garg1996@gmail.com',
          isPersonal: false,
        },
      ],
      'shubhamg266@gmail.com',
    );

    expect(portfolios).toHaveLength(2);
    expect(portfolios.map((portfolio) => portfolio.id)).toEqual(['user-123', 'shared-1']);
  });

  it('removes a self-only legacy portfolio even if the name is custom', () => {
    const portfolios = removeLegacySelfPortfolioDuplicates(
      [
        {
          id: 'user-123',
          name: 'My Portfolio',
          ownerEmail: 'shubhamg266@gmail.com',
          isPersonal: true,
          document: { memberEmails: ['shubhamg266@gmail.com'] },
        },
        {
          id: 'legacy-custom',
          name: 'Shubham Main',
          ownerEmail: 'shubhamg266@gmail.com',
          isPersonal: false,
          document: { memberEmails: ['shubhamg266@gmail.com'] },
        },
        {
          id: 'shared-owned',
          name: 'Family Shared',
          ownerEmail: 'shubhamg266@gmail.com',
          isPersonal: false,
          document: { memberEmails: ['shubhamg266@gmail.com', 'mayuri.garg1996@gmail.com'] },
        },
      ],
      'shubhamg266@gmail.com',
    );

    expect(portfolios.map((portfolio) => portfolio.id)).toEqual(['user-123', 'shared-owned']);
  });

  it('identifies a legacy self-only portfolio candidate', () => {
    expect(isLegacySelfPortfolioCandidate(
      {
        id: 'legacy-custom',
        name: 'Shubham Main',
        ownerEmail: 'shubhamg266@gmail.com',
        isPersonal: false,
        document: { memberEmails: ['shubhamg266@gmail.com'] },
      },
      'shubhamg266@gmail.com',
      'user-123',
    )).toBe(true);
  });

  it('hydrates a personal portfolio only when it is still empty and the legacy one has data', () => {
    expect(shouldHydratePersonalPortfolioFromLegacy(
      {
        assets: [],
        assetClasses: [],
      },
      {
        assets: [{ id: '1' } as never],
        assetClasses: [],
      },
    )).toBe(true);

    expect(shouldHydratePersonalPortfolioFromLegacy(
      {
        assets: [{ id: 'p1' } as never],
        assetClasses: [],
      },
      {
        assets: [{ id: '1' } as never],
        assetClasses: [],
      },
    )).toBe(false);
  });

  it('uses base currency as primary during derivation when available', () => {
    expect(derivePortfolioCurrencies({
      baseCurrency: 'INR',
      assets: [],
    })).toEqual({
      primaryCurrency: 'INR',
      secondaryCurrency: 'USD',
    });
  });

  it('infers dominant asset currency when legacy base currency is original', () => {
    expect(derivePortfolioCurrencies({
      baseCurrency: 'ORIGINAL',
      assets: [
        { currency: 'USD', costBasis: 100 } as never,
        { currency: 'CAD', costBasis: 1000 } as never,
      ],
    })).toEqual({
      primaryCurrency: 'CAD',
      secondaryCurrency: 'USD',
    });
  });

  it('preserves explicit primary/secondary currencies', () => {
    expect(derivePortfolioCurrencies({
      baseCurrency: 'ORIGINAL',
      primaryCurrency: 'USD',
      secondaryCurrency: 'CAD',
      assets: [{ currency: 'INR', costBasis: 9999 } as never],
    })).toEqual({
      primaryCurrency: 'USD',
      secondaryCurrency: 'CAD',
    });
  });
});
