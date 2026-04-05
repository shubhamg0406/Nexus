import React from 'react';
import { Asset } from '../store/db';
import { AssetClassLogo } from './assetClassBranding';

type AssetLogoResolution =
  | {
      kind: 'ticker';
      src: string;
      alt: string;
      cacheKey: string;
    }
  | {
      kind: 'domain';
      src: string;
      alt: string;
      cacheKey: string;
    }
  | {
      kind: 'fallback';
    };

const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY?.trim() || '';
const failedLogoKeys = new Set<string>();

const AMC_DOMAIN_RULES: Array<{ matchers: string[]; domain: string }> = [
  { matchers: ['axis'], domain: 'axismf.com' },
  { matchers: ['sbi'], domain: 'sbimf.com' },
  { matchers: ['icici prudential', 'icici pru'], domain: 'icicipruamc.com' },
  { matchers: ['nippon india', 'reliance mutual'], domain: 'nipponindiamf.com' },
  { matchers: ['hdfc'], domain: 'hdfcfund.com' },
  { matchers: ['tata'], domain: 'tatamutualfund.com' },
  { matchers: ['parag parikh', 'ppfas'], domain: 'amc.ppfas.com' },
  { matchers: ['uti'], domain: 'utimf.com' },
  { matchers: ['aditya birla', 'birla sun life'], domain: 'mutualfund.adityabirlacapital.com' },
  { matchers: ['kotak'], domain: 'kotakmf.com' },
  { matchers: ['mirae asset'], domain: 'miraeassetmf.co.in' },
  { matchers: ['franklin templeton'], domain: 'franklintempletonindia.com' },
  { matchers: ['bandhan'], domain: 'bandhanmutual.com' },
  { matchers: ['quant'], domain: 'quantmutual.com' },
  { matchers: ['dsp'], domain: 'dspim.com' },
  { matchers: ['edelweiss'], domain: 'edelweissmf.com' },
];

export function resolveAssetLogo(asset: Asset): AssetLogoResolution {
  if (!LOGO_DEV_TOKEN) {
    return { kind: 'fallback' };
  }

  if (usesFundHouseLogo(asset)) {
    const domain = getFundHouseDomain(asset.name);
    if (domain) {
      const src = buildDomainLogoUrl(domain);
      return {
        kind: 'domain',
        src,
        alt: `${asset.name} fund house logo`,
        cacheKey: `domain:${domain}`,
      };
    }
  }

  const tickerSymbol = normalizeTickerForLogoDev(asset.ticker || '');
  if (tickerSymbol) {
    const src = buildTickerLogoUrl(tickerSymbol);
    return {
      kind: 'ticker',
      src,
      alt: `${asset.name} logo`,
      cacheKey: `ticker:${tickerSymbol}`,
    };
  }

  return { kind: 'fallback' };
}

export function AssetMarketLogo({
  asset,
  className = '',
}: {
  asset: Asset;
  className?: string;
}) {
  const resolution = resolveAssetLogo(asset);
  const [failed, setFailed] = React.useState(
    resolution.kind !== 'fallback' ? failedLogoKeys.has(resolution.cacheKey) : false,
  );

  React.useEffect(() => {
    if (resolution.kind === 'fallback') {
      setFailed(false);
      return;
    }
    setFailed(failedLogoKeys.has(resolution.cacheKey));
  }, [resolution]);

  if (resolution.kind === 'fallback' || failed) {
    return <AssetClassLogo name={asset.assetClass} className={className} />;
  }

  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-sm ${className}`}>
      <img
        src={resolution.src}
        alt={resolution.alt}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => {
          failedLogoKeys.add(resolution.cacheKey);
          setFailed(true);
        }}
      />
    </div>
  );
}

function buildTickerLogoUrl(symbol: string) {
  return `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(LOGO_DEV_TOKEN)}&retina=true&format=png&fallback=404`;
}

function buildDomainLogoUrl(domain: string) {
  return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(LOGO_DEV_TOKEN)}&retina=true&format=png&fallback=404`;
}

function usesFundHouseLogo(asset: Asset) {
  const normalizedClass = asset.assetClass.trim().toLowerCase();
  const normalizedCountry = asset.country.trim().toLowerCase();
  return normalizedCountry === 'india' && (normalizedClass.includes('mutual') || normalizedClass === 'mf' || normalizedClass === 'mfs');
}

function getFundHouseDomain(name: string) {
  const normalized = name.trim().toLowerCase();
  for (const rule of AMC_DOMAIN_RULES) {
    if (rule.matchers.some((matcher) => normalized.includes(matcher))) {
      return rule.domain;
    }
  }
  return '';
}

function normalizeTickerForLogoDev(ticker: string) {
  const trimmed = ticker.trim().toUpperCase();
  if (!trimmed) return '';

  if (trimmed.startsWith('NASDAQ:')) return `${trimmed.slice(7)}.NASDAQ`;
  if (trimmed.startsWith('NYSE:')) return `${trimmed.slice(5)}.NYSE`;
  if (trimmed.startsWith('AMEX:')) return `${trimmed.slice(5)}.AMEX`;
  if (trimmed.startsWith('TSE:')) return `${trimmed.slice(4)}.TSX`;
  if (trimmed.startsWith('CVE:')) return `${trimmed.slice(4)}.TSXV`;
  if (trimmed.startsWith('NSE:')) return `${trimmed.slice(4)}.NSE`;
  if (trimmed.endsWith('.TO')) return `${trimmed.slice(0, -3)}.TSX`;
  if (trimmed.endsWith('.V')) return `${trimmed.slice(0, -2)}.TSXV`;
  if (trimmed.endsWith('.NS')) return `${trimmed.slice(0, -3)}.NSE`;

  // Prefer company-name lookup for Bombay listings until exchange support is confirmed.
  if (trimmed.startsWith('BOM:') || trimmed.endsWith('.BO')) return '';

  if (!trimmed.includes(':') && !trimmed.includes('.')) {
    return `${trimmed}.NASDAQ`;
  }

  return '';
}
