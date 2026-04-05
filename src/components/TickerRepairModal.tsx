import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Search } from 'lucide-react';
import { Asset } from '../store/db';
import { usePortfolio } from '../store/PortfolioContext';
import { fetchAutoMatchedPriceForAsset, fetchGoldSystemQuote, getTickerRecommendation, hasConfiguredNonYahooProvider, inferCurrencyFromTicker, isCanadianAutoMatchTicker, isIndianMutualFundAsset, isIndianStockAsset, isMassiveCandidateTicker, PriceFetchResult, PriceProvider, ResolvedPriceProvider } from '../lib/api';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { applyPriceFormula } from '../lib/priceFormula';

interface TickerRepairModalProps {
  asset?: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SupportedCurrency = 'USD' | 'CAD' | 'INR';
type UnitMode = 'none' | 'ounce-to-gram' | 'custom';
type CalculationMode = 'guided' | 'formula';

const OUNCE_TO_GRAM_FACTOR = 31.1035;

export function TickerRepairModal({ asset, open, onOpenChange }: TickerRepairModalProps) {
  const { updateAsset, priceProviderSettings, rates } = usePortfolio();
  const [provider, setProvider] = React.useState<PriceProvider>('yahoo');
  const [ticker, setTicker] = React.useState('');
  const [calculationMode, setCalculationMode] = React.useState<CalculationMode>('guided');
  const [unitMode, setUnitMode] = React.useState<UnitMode>('none');
  const [customUnitFactor, setCustomUnitFactor] = React.useState('');
  const [fromCurrency, setFromCurrency] = React.useState<SupportedCurrency>('USD');
  const [toCurrency, setToCurrency] = React.useState<SupportedCurrency>('USD');
  const [priceFormula, setPriceFormula] = React.useState('({price} / {unit}) * {fx}');
  const [isChecking, setIsChecking] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [result, setResult] = React.useState<PriceFetchResult | null>(null);
  const defaultPreferredProvider =
    hasConfiguredNonYahooProvider(priceProviderSettings) && priceProviderSettings.primaryProvider === 'yahoo'
      ? (priceProviderSettings.finnhubApiKey?.trim() ? 'finnhub' : 'alphavantage')
      : priceProviderSettings.primaryProvider;
  const isGoldAsset = asset?.assetClass === 'Gold';
  const routingInfo = React.useMemo(() => getRoutingInfo(asset, ticker), [asset, ticker]);

  React.useEffect(() => {
    if (!asset || !open) return;

    setProvider(
      asset.preferredPriceProvider === 'alphavantage' || asset.preferredPriceProvider === 'finnhub' || asset.preferredPriceProvider === 'yahoo'
        ? asset.preferredPriceProvider
        : defaultPreferredProvider
    );
    setTicker(asset.ticker || '');
    setCalculationMode(asset.priceFormula ? 'formula' : 'guided');
    if (asset.priceUnitConversionFactor && asset.priceUnitConversionFactor > 1) {
      if (Math.abs(asset.priceUnitConversionFactor - OUNCE_TO_GRAM_FACTOR) < 0.0001) {
        setUnitMode('ounce-to-gram');
        setCustomUnitFactor('');
      } else {
        setUnitMode('custom');
        setCustomUnitFactor(String(asset.priceUnitConversionFactor));
      }
    } else {
      setUnitMode('none');
      setCustomUnitFactor('');
    }
    setFromCurrency(asset.priceSourceCurrency || inferCurrencyFromTicker(asset.ticker || asset.name || ''));
    setToCurrency(asset.priceTargetCurrency || asset.currency);
    setPriceFormula(asset.priceFormula || '({price} / {unit}) * {fx}');
    setResult(null);
    setIsChecking(false);
    setIsSaving(false);
  }, [asset, defaultPreferredProvider, open, priceProviderSettings.primaryProvider]);

  React.useEffect(() => {
    if (!asset || !open || !isGoldAsset) return;

    setIsChecking(true);
    void fetchGoldSystemQuote()
      .then((quote) => {
        setResult(quote);
        setFromCurrency('USD');
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, [asset, isGoldAsset, open]);

  if (!asset) return null;

  const recommendation = routingInfo.kind === 'system'
    ? routingInfo.helperText
    : getTickerRecommendation(ticker, provider);
  const quoteCurrency = getResolvedQuoteCurrency(result, ticker, asset, fromCurrency);
  const parsedCustomUnitFactor = Number(customUnitFactor);
  const unitFactor =
    unitMode === 'ounce-to-gram'
      ? OUNCE_TO_GRAM_FACTOR
      : unitMode === 'custom' && Number.isFinite(parsedCustomUnitFactor) && parsedCustomUnitFactor > 0
        ? parsedCustomUnitFactor
        : 1;
  const fxFactor = getFxConversionFactor(quoteCurrency, toCurrency, rates);
  const sourcePrice = result?.price ?? null;
  const formulaResult = sourcePrice != null
    ? applyPriceFormula(priceFormula, {
        price: sourcePrice,
        fx: fxFactor,
        unit: unitFactor,
      })
    : null;
  const finalConvertedPrice =
    calculationMode === 'formula'
      ? formulaResult?.value ?? null
      : sourcePrice != null
        ? (sourcePrice / unitFactor) * fxFactor
        : null;
  const canSave =
    (isGoldAsset || Boolean(ticker.trim())) &&
    (!result || result.price != null) &&
    (calculationMode === 'guided' || !formulaResult?.error);

  const testTicker = async () => {
    setIsChecking(true);
    try {
      const checked = isGoldAsset
        ? await fetchGoldSystemQuote()
        : await fetchAutoMatchedPriceForAsset(
            {
              ...asset,
              ticker,
              preferredPriceProvider: provider,
            },
            priceProviderSettings,
          );
      setResult(checked);
      setFromCurrency(isGoldAsset ? 'USD' : getResolvedQuoteCurrency(checked, ticker, asset, fromCurrency));
      if (!isGoldAsset && checked.price != null && (checked.provider === 'yahoo' || checked.provider === 'alphavantage' || checked.provider === 'finnhub') && checked.provider !== provider) {
        setProvider(checked.provider);
      }
    } finally {
      setIsChecking(false);
    }
  };

  const saveTicker = async () => {
    setIsSaving(true);
    try {
      await updateAsset({
        ...asset,
        ticker: isGoldAsset ? undefined : (ticker.trim() || undefined),
        autoUpdate: isGoldAsset ? true : Boolean(ticker.trim()),
        currentPrice: finalConvertedPrice ?? asset.currentPrice,
        preferredPriceProvider: isGoldAsset || routingInfo.kind === 'system' ? undefined : provider,
        priceProvider: isGoldAsset ? 'gold' : (result?.provider || routingInfo.provider || provider),
        priceFetchStatus: result?.price != null ? 'success' : asset.priceFetchStatus,
        priceFetchMessage: result?.price != null ? undefined : result?.error || asset.priceFetchMessage,
        priceUnitConversionFactor: unitFactor !== 1 ? unitFactor : undefined,
        priceSourceCurrency: quoteCurrency,
        priceTargetCurrency: toCurrency,
        priceFormula: calculationMode === 'formula' ? priceFormula.trim() : undefined,
        priceConversionFactor: calculationMode === 'formula' ? undefined : buildStoredConversionFactor({ unitFactor, fxFactor }),
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="border-b border-slate-200 pb-4">
        <DialogTitle className="text-xl font-semibold text-slate-950 dark:text-slate-50">{isGoldAsset ? 'Gold Price Settings' : 'Edit Ticker'}</DialogTitle>
        <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {isGoldAsset
            ? `Gold uses the system source automatically for ${asset.name}. Adjust only the saved currency, unit conversion, or formula.`
            : `Update the live price source for ${asset.name}. Most assets only need a ticker and provider.`}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <div className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
            {isGoldAsset ? (
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                  <FieldLabel>System Source</FieldLabel>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                    Gold API live gold feed
                  </div>
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Gold uses the shared system source. No ticker is needed.
                  </p>
                </div>
                <Button type="button" onClick={() => void testTicker()} disabled={isChecking} className="h-11">
                  {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Refresh preview
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
                  <div className="space-y-2">
                    <FieldLabel>Ticker</FieldLabel>
                    <Input
                      value={ticker}
                      onChange={(event) => setTicker(event.target.value)}
                      placeholder="e.g. GOOG, GOOG.TO, NSE:RELIANCE"
                      className="h-11"
                    />
                  </div>

                  {routingInfo.kind === 'system' ? (
                    <div className="space-y-2">
                      <FieldLabel>System Source</FieldLabel>
                      <div className="flex h-11 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                        {routingInfo.label}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <FieldLabel>Provider</FieldLabel>
                      <Select value={provider} onChange={(event) => setProvider(event.target.value as PriceProvider)} className="h-11">
                        <option value="yahoo">Yahoo Finance</option>
                        <option value="alphavantage">Alpha Vantage</option>
                        <option value="finnhub">Finnhub</option>
                      </Select>
                    </div>
                  )}

                  <Button type="button" onClick={() => void testTicker()} disabled={isChecking || !ticker.trim()} className="h-11 md:self-end">
                    {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Check quote
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{recommendation}</p>
              </>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Latest Quote</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    {result?.price != null ? formatDecimal(result.price) : '--'}
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {result?.price != null ? `${quoteCurrency} per ${unitMode === 'ounce-to-gram' ? 'ounce' : 'unit'}` : 'Run a quote check to preview the live price.'}
                  </div>
                </div>
                {result?.price != null ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Quote found
                  </span>
                ) : null}
              </div>

              {(result?.normalizedTicker || result?.price != null || result?.sourceUrl) ? (
                <div className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                  {result?.normalizedTicker ? (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Symbol</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{result.normalizedTicker}</div>
                    </div>
                  ) : null}
                  {result?.price != null ? (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Source</div>
                      <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{labelForProvider(result.provider)}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {result?.sourceUrl ? (
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50"
                >
                  Open provider page
                </a>
              ) : null}

              {result?.error ? (
                <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{result.error}</span>
                </div>
              ) : null}
            </div>

            <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Saved Price</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                {finalConvertedPrice != null ? `${currencySymbol(toCurrency)}${formatDecimal(finalConvertedPrice)}` : '--'}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {buildLiveMath({
                  calculationMode,
                  sourcePrice,
                  unitFactor,
                  fxFactor,
                  toCurrency,
                  finalPrice: finalConvertedPrice,
                  formulaResult: formulaResult?.resolvedExpression || '',
                }) || 'The saved price updates after a successful quote check.'}
              </div>

              <div className="mt-3 rounded-2xl bg-white p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                <div className="grid gap-2">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Asset:</span>{' '}
                    <span className="font-medium text-slate-900 dark:text-slate-100">{asset.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Currency:</span>{' '}
                    <span className="font-medium">{toCurrency}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Qty:</span>{' '}
                    <span className="font-medium">{formatDecimal(asset.quantity, 4)}</span>
                  </div>
                </div>
              </div>
            </aside>
          </section>

          <details className="group rounded-3xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              Advanced pricing
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>Quote Currency</FieldLabel>
                    <Select value={fromCurrency} onChange={(event) => setFromCurrency(event.target.value as SupportedCurrency)}>
                      <option value="USD">USD</option>
                      <option value="CAD">CAD</option>
                      <option value="INR">INR</option>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Save Price In</FieldLabel>
                    <Select value={toCurrency} onChange={(event) => setToCurrency(event.target.value as SupportedCurrency)}>
                      <option value="USD">USD</option>
                      <option value="CAD">CAD</option>
                      <option value="INR">INR</option>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>Unit Conversion</FieldLabel>
                    <Select value={unitMode} onChange={(event) => setUnitMode(event.target.value as UnitMode)}>
                      <option value="none">No unit conversion</option>
                      <option value="ounce-to-gram">Troy ounce to gram</option>
                      <option value="custom">Custom factor</option>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Calculation Mode</FieldLabel>
                    <Select value={calculationMode} onChange={(event) => setCalculationMode(event.target.value as CalculationMode)}>
                      <option value="guided">Guided</option>
                      <option value="formula">Formula</option>
                    </Select>
                  </div>
                </div>

                {unitMode === 'custom' ? (
                  <div className="space-y-2">
                    <FieldLabel>Custom Unit Factor</FieldLabel>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={customUnitFactor}
                      onChange={(event) => setCustomUnitFactor(event.target.value)}
                      placeholder="e.g. 50"
                    />
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                {calculationMode === 'formula' ? (
                  <div className="space-y-2">
                    <FieldLabel>Formula</FieldLabel>
                    <Input
                      value={priceFormula}
                      onChange={(event) => setPriceFormula(event.target.value)}
                      placeholder="({price} / {unit}) * {fx}"
                    />
                    <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                      Available values: <code>{'{price}'}</code>, <code>{'{unit}'}</code>, and <code>{'{fx}'}</code>.
                    </p>
                    {formulaResult?.error ? (
                      <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        {formulaResult.error}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    Guided mode calculates <code>(price / unit) * fx</code> using the quote you just checked.
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Keep advanced pricing collapsed unless this asset needs conversion or a custom formula.
        </p>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void saveTicker()} disabled={!canSave || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function FieldLabel({ children }: React.PropsWithChildren) {
  return <label className="text-sm font-medium text-slate-900 dark:text-slate-100">{children}</label>;
}

function getRoutingInfo(asset: Asset | undefined, ticker: string) {
  if (!asset) {
    return {
      kind: 'manual' as const,
      provider: null,
      label: 'Manual provider selection',
      helperText: '',
    };
  }

  const trimmedTicker = ticker.trim() || asset.ticker?.trim() || '';

  if (asset.assetClass === 'Gold') {
    return {
      kind: 'system' as const,
      provider: 'gold' as const,
      label: 'Gold API',
      helperText: 'Gold uses the shared system source automatically. No provider selection is needed here.',
    };
  }

  if (isIndianMutualFundAsset(asset.assetClass, asset.country, trimmedTicker)) {
    return {
      kind: 'system' as const,
      provider: 'amfi' as const,
      label: 'AMFI NAV',
      helperText: 'India mutual funds are matched through AMFI automatically using the existing fund name and ticker.',
    };
  }

  if (isIndianStockAsset(asset.assetClass, asset.country, trimmedTicker)) {
    return {
      kind: 'system' as const,
      provider: 'upstox' as const,
      label: 'Upstox system route',
      helperText: 'India stocks use the shared India stock route automatically, so a manual Yahoo/Alpha selection is not needed.',
    };
  }

  if (isMassiveCandidateTicker(trimmedTicker)) {
    return {
      kind: 'system' as const,
      provider: 'massive' as const,
      label: 'Massive close data',
      helperText: 'U.S. stocks use the shared Massive close-data route automatically and stay cached after the first daily refresh.',
    };
  }

  if (isCanadianAutoMatchTicker(trimmedTicker, asset.country)) {
    return {
      kind: 'system' as const,
      provider: 'alphavantage' as const,
      label: 'Canada auto-match route',
      helperText: 'Canada tickers follow the shared Canada auto-match route, so the final source is resolved by the system.',
    };
  }

  return {
    kind: 'manual' as const,
    provider: null,
    label: 'Manual provider selection',
    helperText: '',
  };
}

function labelForProvider(provider: ResolvedPriceProvider) {
  if (provider === 'alphavantage') return 'Alpha Vantage';
  if (provider === 'finnhub') return 'Finnhub';
  if (provider === 'massive') return 'Massive';
  if (provider === 'amfi') return 'AMFI NAV';
  if (provider === 'upstox') return 'Upstox';
  if (provider === 'gold') return 'Gold API';
  return 'Yahoo Finance';
}

function getResolvedQuoteCurrency(
  result: PriceFetchResult | null,
  ticker: string,
  asset: Asset,
  currentFrom: SupportedCurrency,
): SupportedCurrency {
  const candidate = result?.currency || asset.priceSourceCurrency || inferCurrencyFromTicker(result?.normalizedTicker || ticker || asset.ticker || asset.name || '');
  if (candidate === 'USD' || candidate === 'CAD' || candidate === 'INR') {
    return candidate;
  }
  return currentFrom;
}

function getFxConversionFactor(
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency,
  rates: Record<string, number> | null,
) {
  if (fromCurrency === toCurrency) return 1;
  if (!rates) return 1;

  const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
  const toRate = toCurrency === 'USD' ? 1 : rates[toCurrency];
  if (!fromRate || !toRate) return 1;

  return toRate / fromRate;
}

function buildStoredConversionFactor({ unitFactor, fxFactor }: { unitFactor: number; fxFactor: number }) {
  const safeUnitFactor = unitFactor > 0 ? unitFactor : 1;
  const safeFxFactor = fxFactor > 0 ? fxFactor : 1;
  return safeFxFactor / safeUnitFactor;
}

function buildLiveMath({
  calculationMode,
  sourcePrice,
  unitFactor,
  fxFactor,
  toCurrency,
  finalPrice,
  formulaResult,
}: {
  calculationMode: CalculationMode;
  sourcePrice: number | null;
  unitFactor: number;
  fxFactor: number;
  toCurrency: SupportedCurrency;
  finalPrice: number | null;
  formulaResult: string;
}) {
  if (sourcePrice == null || finalPrice == null) return '';

  if (calculationMode === 'formula') {
    return `${formulaResult} = ${currencySymbol(toCurrency)}${formatDecimal(finalPrice)}`;
  }

  const steps = [`${formatDecimal(sourcePrice)}`];
  if (unitFactor !== 1) {
    steps[0] = `(${steps[0]} / ${formatDecimal(unitFactor, 4)})`;
  }
  if (fxFactor !== 1) {
    steps.push(`* ${formatDecimal(fxFactor, 4)}`);
  }
  return `${steps.join(' ')} = ${currencySymbol(toCurrency)}${formatDecimal(finalPrice)}`;
}

function formatDecimal(value: number, maxFractionDigits: number = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function currencySymbol(currency: SupportedCurrency) {
  if (currency === 'INR') return '₹';
  if (currency === 'CAD') return 'CA$';
  return '$';
}
