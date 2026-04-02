import React, { useMemo, useState, useEffect } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { Asset } from '../store/db';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Calculator, Search } from 'lucide-react';
import { AssetClassLogo } from '../lib/assetClassBranding';
import { getSystemAssetClassesForCountry } from '../lib/systemAssetClasses';
import { PriceProvider, hasConfiguredNonYahooProvider } from '../lib/api';
import { getCurrencyOptionsForCountry, getDefaultCurrencyForCountry } from './addAssetModalHelpers';

interface AddAssetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetToEdit?: Asset;
}

export function AddAssetModal({ open, onOpenChange, assetToEdit }: AddAssetModalProps) {
  const { addAsset, updateAsset, assetClasses: customAssetClasses, assets, priceProviderSettings } = usePortfolio();
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [averagePurchasePrice, setAveragePurchasePrice] = useState('');
  const [purchaseValue, setPurchaseValue] = useState('');
  const [currency, setCurrency] = useState<'CAD' | 'INR' | 'USD'>('USD');
  const [owner, setOwner] = useState('Joint');
  const [country, setCountry] = useState<'India' | 'Canada'>('India');
  const [assetClass, setAssetClass] = useState<string>('Mutual Funds');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [currentPrice, setCurrentPrice] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [holdingPlatform, setHoldingPlatform] = useState('');
  const [comments, setComments] = useState('');
  const [preferredPriceProvider, setPreferredPriceProvider] = useState<PriceProvider>('yahoo');
  const defaultPreferredProvider =
    hasConfiguredNonYahooProvider(priceProviderSettings) && priceProviderSettings.primaryProvider === 'yahoo'
      ? (priceProviderSettings.finnhubApiKey?.trim() ? 'finnhub' : 'alphavantage')
      : priceProviderSettings.primaryProvider;

  const ownerOptions = useMemo(() => {
    const options = Array.from(new Set(assets.map((asset) => asset.owner).filter(Boolean))).map(String).sort();
    if (assetToEdit?.owner && !options.includes(assetToEdit.owner)) {
      options.push(assetToEdit.owner);
      options.sort();
    }
    return options.length > 0 ? options : ['Joint'];
  }, [assetToEdit?.owner, assets]);

  const currencyOptions = useMemo(() => getCurrencyOptionsForCountry(country), [country]);

  useEffect(() => {
    if (assetToEdit && open) {
      setName(assetToEdit.name);
      setTicker(assetToEdit.ticker || '');
      setPurchaseDate(assetToEdit.purchaseDate || '');
      setQuantity(assetToEdit.quantity.toString());
      setAveragePurchasePrice(assetToEdit.quantity ? (assetToEdit.costBasis / assetToEdit.quantity).toString() : '');
      setPurchaseValue(assetToEdit.costBasis.toString());
      setCurrency(getDefaultCurrencyForCountry(assetToEdit.country as 'India' | 'Canada', assetToEdit.currency as 'CAD' | 'INR' | 'USD'));
      setOwner(assetToEdit.owner);
      setCountry(assetToEdit.country as any);
      setAssetClass(assetToEdit.assetClass);
      setAutoUpdate(assetToEdit.autoUpdate);
      setCurrentPrice(assetToEdit.currentPrice?.toString() || '');
      setCurrentValue(assetToEdit.currentPrice ? (assetToEdit.currentPrice * assetToEdit.quantity).toString() : '');
      setHoldingPlatform(assetToEdit.holdingPlatform || '');
      setComments(assetToEdit.comments || '');
      setPreferredPriceProvider(assetToEdit.preferredPriceProvider || defaultPreferredProvider);
    } else if (open && !assetToEdit) {
      resetForm();
    }
  }, [assetToEdit, defaultPreferredProvider, open, priceProviderSettings.primaryProvider]);

  // Filter custom asset classes by selected country
  const availableAssetClasses = customAssetClasses.filter(c => c.country === country);
  const systemAssetClasses = getSystemAssetClassesForCountry(country);
  
  // Default fallback classes based on country
  const defaultClasses = country === 'Canada' 
    ? ['TFSA', 'Credit Card']
    : ['Mutual Funds', 'Stocks', 'Credit Card'];
  
  // Combine unique classes
  const displayClasses = Array.from(new Set([
    ...availableAssetClasses.map(c => c.name),
    ...systemAssetClasses.map(c => c.name),
    ...defaultClasses,
    ...(assetClass ? [assetClass] : [])
  ])).sort((left, right) => left.localeCompare(right));
  const selectedAssetClassDef = [...customAssetClasses, ...systemAssetClasses].find((cls) => cls.country === country && cls.name === assetClass);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const resolvedPurchase = resolvePurchaseTriangle(quantity, averagePurchasePrice, purchaseValue);
    const resolvedCurrent = autoUpdate
      ? { price: undefined, value: undefined }
      : resolveCurrentTriangle(resolvedPurchase.quantity, currentPrice, currentValue);

    const normalizedTicker = ticker.trim() || undefined;
    const isGoldAsset = assetClass === 'Gold';
    const hasTickerControls = isTickerApplicable || Boolean(assetToEdit?.ticker) || Boolean(ticker.trim());

    const assetData = {
      name,
      ticker: isGoldAsset ? undefined : (hasTickerControls ? normalizedTicker : undefined),
      quantity: resolvedPurchase.quantity,
      costBasis: resolvedPurchase.value,
      currency,
      owner,
      country,
      assetClass,
      autoUpdate,
      currentPrice: !autoUpdate ? resolvedCurrent.price : undefined,
      purchaseDate: purchaseDate || undefined,
      holdingPlatform: holdingPlatform.trim() || undefined,
      comments: comments.trim() || undefined,
      preferredPriceProvider: isGoldAsset ? undefined : (hasTickerControls ? preferredPriceProvider : undefined),
    };

    if (assetToEdit) {
      await updateAsset({
        ...assetToEdit,
        id: assetToEdit.id,
        ...assetData,
        originalCurrency: assetToEdit.originalCurrency,
        exchangeRate: assetToEdit.exchangeRate,
      });
    } else {
      await addAsset(assetData);
    }
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setTicker('');
    setPurchaseDate('');
    setQuantity('');
    setAveragePurchasePrice('');
    setPurchaseValue('');
    setCurrency('INR');
    setOwner(ownerOptions[0] || 'Joint');
    setCountry('India');
    setAssetClass('Mutual Funds');
    setAutoUpdate(true);
    setCurrentPrice('');
    setCurrentValue('');
    setHoldingPlatform('');
    setComments('');
    setPreferredPriceProvider(defaultPreferredProvider);
  };

  const isTickerApplicable = !['Gold', 'Cash', 'PF/NPS/FD', 'TFSA/RRSP/FHSA', 'Real Estate', 'Other', 'Credit Card'].includes(assetClass);
  const showTickerControls = isTickerApplicable;

  const purchaseSummary = resolvePurchaseTriangle(quantity, averagePurchasePrice, purchaseValue);
  const currentSummary = autoUpdate ? null : resolveCurrentTriangle(purchaseSummary.quantity, currentPrice, currentValue);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="space-y-1">
        <DialogTitle>{assetToEdit ? 'Edit Asset' : 'Add New Asset'}</DialogTitle>
        <DialogDescription>Enter a full holding record. The form auto-fills the missing purchase and current values when you provide any two related numbers.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="max-h-[82vh] space-y-3 overflow-y-auto py-1 pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,0.92fr)_minmax(0,0.9fr)_minmax(0,0.98fr)]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Country</label>
            <Select value={country} onChange={(e) => {
              const nextCountry = e.target.value as 'India' | 'Canada';
              setCountry(nextCountry);
              setCurrency(getDefaultCurrencyForCountry(nextCountry));
              // Reset asset class if it's not in the new country's list
              const newAvailableClasses = customAssetClasses.filter(c => c.country === nextCountry);
              const newSystemClasses = getSystemAssetClassesForCountry(nextCountry);
              const newDefaultClasses = nextCountry === 'Canada' 
                ? ['TFSA', 'Credit Card']
                : ['Mutual Funds', 'Stocks', 'Credit Card'];
              const newDisplayClasses = Array.from(new Set([...newAvailableClasses.map(c => c.name), ...newSystemClasses.map(c => c.name), ...newDefaultClasses]));
              if (!newDisplayClasses.includes(assetClass)) {
                setAssetClass(newDisplayClasses[0] || '');
              }
            }}>
              <option value="Canada">Canada</option>
              <option value="India">India</option>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Purchase Date</label>
            <Input value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} type="date" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Asset Class</label>
            <div className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] items-center gap-2">
              <Select value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
                {displayClasses.map(cls => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </Select>
              <div className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <AssetClassLogo
                  name={assetClass || 'Asset Class'}
                  image={selectedAssetClassDef?.image}
                  className="h-8 w-8 shrink-0"
                />
                <span className="truncate">Best-match logo for {assetClass || 'asset class'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(240px,0.47fr)]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Owner</label>
            <Select required value={owner} onChange={(e) => setOwner(e.target.value)}>
              {ownerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Currency</label>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
              {currencyOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Asset Name</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Apple Inc, SBI Mutual Fund" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Holding Platform</label>
            <Input value={holdingPlatform} onChange={(e) => setHoldingPlatform(e.target.value)} placeholder="e.g. IBKR, Wealthsimple, Groww" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Comments</label>
            <Input value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional note" />
          </div>
        </div>

        {showTickerControls && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.38fr)_auto] md:items-end">
            <div className="space-y-2 relative">
              <label className="text-sm font-medium">
                Ticker Symbol (optional)
              </label>
              <div className="relative">
                <Input 
                  value={ticker} 
                  onChange={(e) => setTicker(e.target.value)} 
                  placeholder="e.g. NASDAQ:AAPL, NSE:RELIANCE, MUTF_IN:SBI_BLUE_CHIP" 
                  className="pr-10"
                  disabled={!autoUpdate}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </div>
              </div>
              <div className="text-[11px] leading-4 text-slate-500 mt-1">
                Use ticker format `EXCHANGE:TICKER` when applicable (e.g., `NASDAQ:AAPL`, `NSE:RELIANCE`)
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Preferred Price Service</label>
              <Select value={preferredPriceProvider} onChange={(e) => setPreferredPriceProvider(e.target.value as PriceProvider)} disabled={!autoUpdate}>
                <option value="yahoo">Yahoo Finance</option>
                <option value="alphavantage">Alpha Vantage</option>
                <option value="finnhub">Finnhub</option>
              </Select>
              <p className="text-[11px] leading-4 text-slate-500">Override the app default for this asset.</p>
            </div>
            <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 dark:border-slate-800 dark:bg-slate-900">
              <input 
                type="checkbox" 
                id="autoUpdate" 
                checked={!autoUpdate} 
                onChange={(e) => setAutoUpdate(!e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#00875A] focus:ring-[#00875A]"
              />
              <label htmlFor="autoUpdate" className="text-sm font-medium whitespace-nowrap">Manual entry</label>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Calculator className="h-4 w-4" />
            Purchase Details
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Qty</label>
              <Input required type="number" step="any" value={quantity} onChange={(e) => setPurchaseField('quantity', e.target.value, { quantity, averagePurchasePrice, purchaseValue, setQuantity, setAveragePurchasePrice, setPurchaseValue })} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Average Purchase Price</label>
              <Input required type="number" step="any" value={averagePurchasePrice} onChange={(e) => setPurchaseField('averagePurchasePrice', e.target.value, { quantity, averagePurchasePrice, purchaseValue, setQuantity, setAveragePurchasePrice, setPurchaseValue })} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Purchase Value</label>
              <Input required type="number" step="any" value={purchaseValue} onChange={(e) => setPurchaseField('purchaseValue', e.target.value, { quantity, averagePurchasePrice, purchaseValue, setQuantity, setAveragePurchasePrice, setPurchaseValue })} placeholder="0.00" />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            Enter any two numbers and the third will be calculated.
            {purchaseSummary.quantity > 0 && purchaseSummary.value > 0 ? ` Saved total: ${purchaseSummary.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
          </p>
        </div>

        {!autoUpdate ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Calculator className="h-4 w-4" />
              Current Valuation
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Price</label>
                <Input required type="number" step="any" value={currentPrice} onChange={(e) => setCurrentField('price', e.target.value, purchaseSummary.quantity, { currentPrice, currentValue, setCurrentPrice, setCurrentValue })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Value</label>
                <Input required type="number" step="any" value={currentValue} onChange={(e) => setCurrentField('value', e.target.value, purchaseSummary.quantity, { currentPrice, currentValue, setCurrentPrice, setCurrentValue })} placeholder="0.00" />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              Enter either current price or current value and the other field will be filled using quantity.
              {currentSummary?.value ? ` Current total: ${currentSummary.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end space-x-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-full px-6">Cancel</Button>
          <Button type="submit" className="bg-[#00875A] hover:bg-[#007A51] text-white rounded-full px-6">
            {assetToEdit ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function parseNumberInput(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatNumberInput(value: number) {
  return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, '') : '';
}

function resolvePurchaseTriangle(quantity: string, averagePurchasePrice: string, purchaseValue: string) {
  let resolvedQuantity = parseNumberInput(quantity);
  let resolvedAverage = parseNumberInput(averagePurchasePrice);
  let resolvedValue = parseNumberInput(purchaseValue);

  if (resolvedQuantity == null && resolvedAverage != null && resolvedValue != null && resolvedAverage !== 0) {
    resolvedQuantity = resolvedValue / resolvedAverage;
  } else if (resolvedAverage == null && resolvedQuantity != null && resolvedValue != null && resolvedQuantity !== 0) {
    resolvedAverage = resolvedValue / resolvedQuantity;
  } else if (resolvedValue == null && resolvedQuantity != null && resolvedAverage != null) {
    resolvedValue = resolvedQuantity * resolvedAverage;
  }

  return {
    quantity: resolvedQuantity ?? 0,
    average: resolvedAverage ?? 0,
    value: resolvedValue ?? 0,
  };
}

function resolveCurrentTriangle(quantity: number, currentPrice: string, currentValue: string) {
  let resolvedPrice = parseNumberInput(currentPrice);
  let resolvedValue = parseNumberInput(currentValue);

  if (resolvedPrice == null && resolvedValue != null && quantity > 0) {
    resolvedPrice = resolvedValue / quantity;
  } else if (resolvedValue == null && resolvedPrice != null && quantity > 0) {
    resolvedValue = resolvedPrice * quantity;
  }

  return {
    price: resolvedPrice ?? 0,
    value: resolvedValue ?? 0,
  };
}

function setPurchaseField(
  field: 'quantity' | 'averagePurchasePrice' | 'purchaseValue',
  value: string,
  state: {
    quantity: string;
    averagePurchasePrice: string;
    purchaseValue: string;
    setQuantity: (value: string) => void;
    setAveragePurchasePrice: (value: string) => void;
    setPurchaseValue: (value: string) => void;
  },
) {
  const next = {
    quantity: state.quantity,
    averagePurchasePrice: state.averagePurchasePrice,
    purchaseValue: state.purchaseValue,
    [field]: value,
  };

  if (value.trim() === '') {
    state.setQuantity(next.quantity);
    state.setAveragePurchasePrice(next.averagePurchasePrice);
    state.setPurchaseValue(next.purchaseValue);
    return;
  }

  const quantityNumber = parseNumberInput(next.quantity);
  const averageNumber = parseNumberInput(next.averagePurchasePrice);
  const valueNumber = parseNumberInput(next.purchaseValue);

  if (field === 'quantity' && quantityNumber != null && averageNumber != null) {
    next.purchaseValue = formatNumberInput(quantityNumber * averageNumber);
  } else if (field === 'averagePurchasePrice' && quantityNumber != null && averageNumber != null) {
    next.purchaseValue = formatNumberInput(quantityNumber * averageNumber);
  } else if (field === 'purchaseValue') {
    if (quantityNumber != null && quantityNumber !== 0) {
      next.averagePurchasePrice = formatNumberInput((valueNumber ?? 0) / quantityNumber);
    } else if (averageNumber != null && averageNumber !== 0) {
      next.quantity = formatNumberInput((valueNumber ?? 0) / averageNumber);
    }
  } else {
    const resolved = resolvePurchaseTriangle(next.quantity, next.averagePurchasePrice, next.purchaseValue);
    if (!next.quantity && resolved.quantity) next.quantity = formatNumberInput(resolved.quantity);
    if (!next.averagePurchasePrice && resolved.average) next.averagePurchasePrice = formatNumberInput(resolved.average);
    if (!next.purchaseValue && resolved.value) next.purchaseValue = formatNumberInput(resolved.value);
  }

  state.setQuantity(next.quantity);
  state.setAveragePurchasePrice(next.averagePurchasePrice);
  state.setPurchaseValue(next.purchaseValue);
}

function setCurrentField(
  field: 'price' | 'value',
  value: string,
  quantity: number,
  state: {
    currentPrice: string;
    currentValue: string;
    setCurrentPrice: (value: string) => void;
    setCurrentValue: (value: string) => void;
  },
) {
  const next = {
    currentPrice: field === 'price' ? value : state.currentPrice,
    currentValue: field === 'value' ? value : state.currentValue,
  };

  if (value.trim() === '') {
    state.setCurrentPrice(next.currentPrice);
    state.setCurrentValue(next.currentValue);
    return;
  }

  const priceNumber = parseNumberInput(next.currentPrice);
  const valueNumber = parseNumberInput(next.currentValue);

  if (field === 'price' && priceNumber != null && quantity > 0) {
    next.currentValue = formatNumberInput(priceNumber * quantity);
  } else if (field === 'value' && valueNumber != null && quantity > 0) {
    next.currentPrice = formatNumberInput(valueNumber / quantity);
  } else {
    const resolved = resolveCurrentTriangle(quantity, next.currentPrice, next.currentValue);
    if (!next.currentPrice && resolved.price) next.currentPrice = formatNumberInput(resolved.price);
    if (!next.currentValue && resolved.value) next.currentValue = formatNumberInput(resolved.value);
  }

  state.setCurrentPrice(next.currentPrice);
  state.setCurrentValue(next.currentValue);
}
