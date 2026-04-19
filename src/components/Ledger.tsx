import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getBulkRefreshRowStatus, usePortfolio } from '../store/PortfolioContext';
import { useAuth } from '../store/AuthContext';
import { Asset } from '../store/db';
import {
  ColumnDef,
  Row,
  SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { TickerRepairModal } from './TickerRepairModal';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { AlertTriangle, Building2, Check, ChevronDown, Edit, Ellipsis, Filter, Gem, Landmark, LineChart, PiggyBank, Plus, RefreshCw, ShieldCheck, Trash2, WalletCards } from 'lucide-react';
import { convertAmount, formatCurrency, formatPercent, getAssetXirr, getCurrentPrice, getCurrentTotal, getGrowthTotal, getInvestmentPrice, getInvestmentTotal, isDebtAssetClass } from '../lib/portfolioMetrics';
import { getTickerRecommendation } from '../lib/api';
import { Select } from './ui/select';
import { AssetClassLogo } from '../lib/assetClassBranding';
import { AssetMarketLogo } from '../lib/assetLogos';

type LedgerCurrency = 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
type FilterColumnId = 'name' | 'assetClass' | 'position' | 'currentPrice' | 'marketValue' | 'performance' | 'notes';
type FilterState = Record<FilterColumnId, { selected: string[]; search: string; min: string; max: string }>;
type LedgerSortMode = 'default' | 'name' | 'assetClass' | 'position' | 'currentPrice' | 'marketValue' | 'performance';
type SubtotalCurrency = 'CAD' | 'INR' | 'USD';
type AssetClassFilterOption = { label: string; value: string };
type LedgerDisplayGroup = {
  assetClass: string;
  rows: Row<Asset>[];
  metrics: {
    invested: number;
    current: number;
    gain: number;
    xirr: number | null;
    currency: SubtotalCurrency;
  };
};

const TABLE_COLUMN_WIDTHS = ['34%', '10%', '10%', '13%', '13%', '10%', '8%', '2%'] as const;
const HIDDEN_LEDGER_COLUMNS = { defaultOrder: false } as const;
const SORT_MODE_OPTIONS: Array<{ value: LedgerSortMode; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'assetClass', label: 'Asset Class' },
  { value: 'position', label: 'Position' },
  { value: 'currentPrice', label: 'Current Price' },
  { value: 'marketValue', label: 'Market Value' },
  { value: 'performance', label: 'Performance' },
];

const EMPTY_FILTER_STATE: FilterState = {
  name: { selected: [], search: '', min: '', max: '' },
  assetClass: { selected: [], search: '', min: '', max: '' },
  position: { selected: [], search: '', min: '', max: '' },
  currentPrice: { selected: [], search: '', min: '', max: '' },
  marketValue: { selected: [], search: '', min: '', max: '' },
  performance: { selected: [], search: '', min: '', max: '' },
  notes: { selected: [], search: '', min: '', max: '' },
};

function getAssetCountryForFilter(asset: Asset): 'Canada' | 'India' {
  return asset.country === 'India' ? 'India' : 'Canada';
}

function buildAssetClassFilterValue(country: 'Canada' | 'India', assetClass: string): string {
  return `${country}::${assetClass}`;
}

export function Ledger({ onEditAsset, onAddAsset }: { onEditAsset?: (asset: Asset) => void; onAddAsset?: () => void }) {
  const { user } = useAuth();
  const { assets, assetClasses, baseCurrency, rates, priceProviderSettings, removeAsset, duplicateAsset, refreshAsset, refreshPrices, refreshFailedPrices, isRefreshing, refreshQueue, bulkRefreshState } = usePortfolio();
  const safeBulkRefreshState = normalizeBulkRefreshState(bulkRefreshState);
  const [sortMode, setSortMode] = useState<LedgerSortMode>('default');
  const [memberFilter, setMemberFilter] = useState('ALL');
  const [assetClassFilter, setAssetClassFilter] = useState('ALL');
  const [pricingFilter, setPricingFilter] = useState<'ALL' | 'AUTO' | 'MANUAL' | 'FAILED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [tickerRepairAsset, setTickerRepairAsset] = useState<Asset | undefined>(undefined);
  const [refreshingRowIds, setRefreshingRowIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [openColumnFilter, setOpenColumnFilter] = useState<FilterColumnId | null>(null);
  const [statsModal, setStatsModal] = useState<{ type: 'rows' | 'failed' | 'manual'; open: boolean }>({ type: 'rows', open: false });
  const [refreshCenterOpen, setRefreshCenterOpen] = useState(false);
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const ledgerSorting = useMemo(() => getSortingForMode(sortMode), [sortMode]);

  const handleRefreshRow = React.useCallback(async (assetId: string) => {
    setRefreshingRowIds((current) => current.includes(assetId) ? current : [...current, assetId]);
    try {
      await refreshAsset(assetId);
    } finally {
      setRefreshingRowIds((current) => current.filter((id) => id !== assetId));
    }
  }, [refreshAsset]);

  const members = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.owner).filter(Boolean))).map(String).sort(),
    [assets],
  );
  const assetClassOptions = useMemo(
    () => Array.from(new Set(assets.map((asset) => buildAssetClassFilterValue(getAssetCountryForFilter(asset), getCanonicalAssetClass(asset.assetClass))).filter(Boolean))).map(String).sort(),
    [assets],
  );
  const assetClassOptionsByCountry = useMemo(() => {
    const groups: Record<'Canada' | 'India', AssetClassFilterOption[]> = { Canada: [], India: [] };
    const seen = {
      Canada: new Set<string>(),
      India: new Set<string>(),
    };

    for (const asset of assets) {
      const country = getAssetCountryForFilter(asset);
      const canonical = getCanonicalAssetClass(asset.assetClass);
      if (!canonical || seen[country].has(canonical)) continue;
      seen[country].add(canonical);
      groups[country].push({
        label: canonical,
        value: buildAssetClassFilterValue(country, canonical),
      });
    }

    groups.Canada.sort((left, right) => left.label.localeCompare(right.label));
    groups.India.sort((left, right) => left.label.localeCompare(right.label));
    return groups;
  }, [assets]);
  const getConvertedValue = React.useCallback(
    (amount: number, assetCurrency: string, currency: LedgerCurrency) => {
      if (currency === 'ORIGINAL') return amount;
      return convertAmount(amount, assetCurrency, currency, rates);
    },
    [rates],
  );

  const getDisplayCurrency = React.useCallback(
    (asset: Asset): 'CAD' | 'INR' | 'USD' => (baseCurrency === 'ORIGINAL' ? asset.currency : baseCurrency),
    [baseCurrency],
  );

  const baseFilteredAssets = useMemo(
    () => assets.filter((asset) => {
      const matchesMember = memberFilter === 'ALL' || asset.owner === memberFilter;
      const matchesClass = assetClassFilter === 'ALL' || buildAssetClassFilterValue(getAssetCountryForFilter(asset), getCanonicalAssetClass(asset.assetClass)) === assetClassFilter;
      const matchesPricing =
        pricingFilter === 'ALL' ||
        (pricingFilter === 'AUTO' && isLivePricingAsset(asset) && !hasActionablePriceFailure(asset)) ||
        (pricingFilter === 'MANUAL' && !isLivePricingAsset(asset)) ||
        (pricingFilter === 'FAILED' && hasActionablePriceFailure(asset));
      const normalizedSearch = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        [asset.name, asset.assetClass, getCanonicalAssetClass(asset.assetClass), asset.owner, asset.ticker, asset.holdingPlatform, asset.comments]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));

      return matchesMember && matchesClass && matchesPricing && matchesSearch;
    }),
    [assetClassFilter, assets, memberFilter, pricingFilter, searchQuery],
  );

  useEffect(() => {
    if (memberFilter !== 'ALL' && !members.includes(memberFilter)) {
      setMemberFilter('ALL');
    }
  }, [memberFilter, members]);

  useEffect(() => {
    if (assetClassFilter !== 'ALL' && !assetClassOptions.includes(assetClassFilter)) {
      setAssetClassFilter('ALL');
    }
  }, [assetClassFilter, assetClassOptions]);

  useEffect(() => {
    const handleClickOutside = () => setOpenColumnFilter(null);
    if (openColumnFilter) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openColumnFilter]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(event.target as Node)) {
        setOpenRowMenuId(null);
      }
    };
    if (openRowMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openRowMenuId]);

  const getNumericFilterValue = React.useCallback((asset: Asset, columnId: FilterColumnId) => {
    switch (columnId) {
      case 'position':
        return asset.quantity;
      case 'currentPrice':
        return getConvertedValue(getCurrentPrice(asset), asset.currency, baseCurrency);
      case 'marketValue':
        return getConvertedValue(getCurrentTotal(asset), asset.currency, baseCurrency);
      case 'performance':
        return getConvertedValue(getGrowthTotal(asset), asset.currency, baseCurrency);
      default:
        return 0;
    }
  }, [baseCurrency, getConvertedValue]);

  const getTextFilterTokens = React.useCallback((asset: Asset, columnId: FilterColumnId) => {
    if (columnId === 'name') return [asset.name];
    if (columnId === 'assetClass') return [getCanonicalAssetClass(asset.assetClass)];
    if (columnId === 'notes') {
      const rowStatus = getBulkRefreshRowStatus(asset);
      const tags = [isLivePricingAsset(asset) ? (rowStatus === 'failed_actionable' ? 'Needs Attention' : rowStatus === 'queued_next_window' ? 'Queued Refresh' : rowStatus === 'using_cached_close_today' ? 'Cached Close' : rowStatus === 'using_last_saved_price' ? 'Using Last Saved Price' : 'Live Price') : 'Manual Pricing'];
      tags.push(asset.comments ? 'Has Comments' : 'No Comments');
      if (asset.holdingPlatform) tags.push(asset.holdingPlatform);
      return tags;
    }
    return [];
  }, []);

  const columnFilterOptions = useMemo(() => {
    const getDistinct = (columnId: FilterColumnId) =>
      Array.from(new Set(baseFilteredAssets.flatMap((asset) => getTextFilterTokens(asset, columnId)))).filter(Boolean).sort();

    return {
      name: getDistinct('name'),
      assetClass: getDistinct('assetClass'),
      notes: getDistinct('notes'),
    };
  }, [baseFilteredAssets, getTextFilterTokens]);

  const filteredAssets = useMemo(() => baseFilteredAssets.filter((asset) => {
    return (Object.entries(columnFilters) as [FilterColumnId, FilterState[FilterColumnId]][]).every(([columnId, filter]) => {
      const hasSelected = filter.selected.length > 0;
      const hasRange = filter.min.trim() !== '' || filter.max.trim() !== '';

      if ((columnId === 'name' || columnId === 'assetClass' || columnId === 'notes') && hasSelected) {
        const tokens = getTextFilterTokens(asset, columnId);
        if (!filter.selected.some((value) => tokens.includes(value))) return false;
      }

      if ((columnId === 'position' || columnId === 'currentPrice' || columnId === 'marketValue' || columnId === 'performance') && hasRange) {
        const value = getNumericFilterValue(asset, columnId);
        const min = filter.min.trim() === '' ? null : Number(filter.min);
        const max = filter.max.trim() === '' ? null : Number(filter.max);
        if (min !== null && Number.isFinite(min) && value < min) return false;
        if (max !== null && Number.isFinite(max) && value > max) return false;
      }

      return true;
    });
  }), [baseFilteredAssets, columnFilters, getNumericFilterValue, getTextFilterTokens]);

  const setColumnFilterSelected = React.useCallback((columnId: FilterColumnId, selected: string[]) => {
    setColumnFilters((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        selected,
      },
    }));
  }, []);

  const setColumnFilterRange = React.useCallback((columnId: FilterColumnId, key: 'min' | 'max', value: string) => {
    setColumnFilters((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        [key]: value,
      },
    }));
  }, []);

  const setColumnFilterSearch = React.useCallback((columnId: FilterColumnId, value: string) => {
    setColumnFilters((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        search: value,
      },
    }));
  }, []);

  const clearColumnFilter = React.useCallback((columnId: FilterColumnId) => {
    setColumnFilters((current) => ({
      ...current,
      [columnId]: EMPTY_FILTER_STATE[columnId],
    }));
  }, []);

  const columns = useMemo<ColumnDef<Asset, unknown>[]>(() => {
    const columnHelper = createColumnHelper<Asset>();

    return [
      columnHelper.accessor((row) => buildAssetSortKey(row, user?.displayName || user?.email || ''), {
        id: 'defaultOrder',
        header: () => null,
        enableHiding: true,
        cell: () => null,
      }),
      columnHelper.accessor('name', {
        id: 'name',
        header: 'Asset',
        cell: (info) => {
          const asset = info.row.original;
          const supportsTickerPricing = showsTickerManagement(asset);
          const hasFailedPrice = supportsTickerPricing && hasActionablePriceFailure(asset);
          const rowRefreshStatus = getBulkRefreshRowStatus(asset);
          const providerForRecommendation = asset.priceProvider === 'finnhub' || asset.priceProvider === 'alphavantage' || asset.priceProvider === 'yahoo' ? asset.priceProvider : 'yahoo';
          const assetMeta = [shouldDisplayTicker(asset) ? asset.ticker || null : null, getCanonicalAssetClass(asset.assetClass), asset.owner].filter(Boolean).join(' • ');
          const isRowRefreshing = refreshingRowIds.includes(asset.id);
          const toneClasses = getAssetToneClasses(asset);

          return (
            <div className="space-y-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className="flex items-start gap-3">
                <AssetMarketLogo asset={asset} className={`mt-0.5 h-9 w-9 ${toneClasses.iconTile}`} />
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{asset.name}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{assetMeta}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                    {getOwnerInitials(asset.owner)}
                  </span>
                  {asset.owner}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${toneClasses.chip}`}>
                  {asset.holdingPlatform || getCanonicalAssetClass(asset.assetClass)}
                </span>
                {asset.sourceManaged ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {asset.connectedProvider === 'splitwise' ? 'Via Splitwise' : 'Source-managed'}
                  </span>
                ) : null}
              </div>
              {supportsTickerPricing ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTickerRepairAsset(asset)}
                      className={`inline-flex items-center gap-1 text-xs font-medium ${hasFailedPrice ? 'text-amber-600 hover:text-amber-700' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-100'}`}
                      title={hasFailedPrice ? `${asset.priceFetchMessage || 'Price fetch failed.'} ${getTickerRecommendation(asset.ticker || '', providerForRecommendation)}` : isGoldAsset(asset) ? 'Adjust system gold pricing settings' : 'Check or update ticker/provider'}
                    >
                      {hasFailedPrice ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                      {getPricingActionLabel(asset)}
                    </button>
                    {((!isGoldAsset(asset) && asset.ticker) || asset.connectedProvider === 'splitwise') ? (
                      <button
                        type="button"
                        onClick={() => void handleRefreshRow(asset.id)}
                        disabled={isRowRefreshing}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-slate-100"
                        title="Refresh only this row"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRowRefreshing ? 'animate-spin' : ''}`} />
                        Refresh row
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => getCanonicalAssetClass(row.assetClass), {
        id: 'assetClass',
        header: 'Asset Class',
        cell: (info) => (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{info.getValue()}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{info.row.original.country}</div>
          </div>
        ),
      }),
      columnHelper.accessor('quantity', {
        id: 'position',
        header: 'Position',
        cell: (info) => {
          const asset = info.row.original;
          const displayCurrency = getDisplayCurrency(asset);
          const investmentPrice = getConvertedValue(getInvestmentPrice(asset), asset.currency, baseCurrency);
          const showsAsDebt = isDebtAssetDisplay(asset);

          return (
            <div className="space-y-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
              <div className={`text-xs ${showsAsDebt ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                {showsAsDebt ? `Balance per unit: ${formatCurrency(investmentPrice, displayCurrency)}` : `Avg: ${formatCurrency(investmentPrice, displayCurrency)}`}
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor('currentPrice', {
        id: 'currentPrice',
        header: (
          <div className="flex items-center gap-2">
            <span>Current Price</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void refreshFailedPrices();
              }}
              className="inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Retry failed price fetches"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        ),
        cell: (info) => {
          const asset = info.row.original;
          const displayCurrency = getDisplayCurrency(asset);
          const supportsTickerPricing = showsTickerManagement(asset);
          const hasFailedPrice = supportsTickerPricing && hasActionablePriceFailure(asset);
          const rowRefreshStatus = getBulkRefreshRowStatus(asset);
          const providerForRecommendation = asset.priceProvider === 'finnhub' || asset.priceProvider === 'alphavantage' || asset.priceProvider === 'yahoo' ? asset.priceProvider : 'yahoo';
          const previousClose = getPreviousClose(asset);
          const currentPrice = hasFailedPrice
            ? (asset.currentPrice ? getConvertedValue(getCurrentPrice(asset), asset.currency, baseCurrency) : getConvertedValue(getInvestmentPrice(asset), asset.currency, baseCurrency))
            : getConvertedValue(getCurrentPrice(asset), asset.currency, baseCurrency);
          const convertedPreviousClose = previousClose ? getConvertedValue(previousClose, asset.currency, baseCurrency) : null;
          const dailyChange = convertedPreviousClose !== null ? currentPrice - convertedPreviousClose : null;
          const dailyChangePercent = convertedPreviousClose ? dailyChange! / convertedPreviousClose : null;

          return (
            <div className="space-y-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className={`text-sm font-semibold ${hasFailedPrice ? 'text-amber-600' : 'text-slate-900 dark:text-slate-100'}`}>{currentPrice ? formatCurrency(currentPrice, displayCurrency) : '-'}</div>
              {dailyChange !== null && dailyChangePercent !== null ? (
                <div className={`text-xs ${getStatusColor(dailyChange)}`}>
                  {formatCurrency(dailyChange, displayCurrency)} ({formatPercent(dailyChangePercent)})
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400">Daily change unavailable</div>
              )}
              {hasFailedPrice && (
                <div className="flex items-center gap-1 text-[11px] text-amber-600" title={`${asset.priceFetchMessage || 'Price fetch failed.'} ${getTickerRecommendation(asset.ticker || '', providerForRecommendation)}`}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Last known value shown
                </div>
              )}
              {!hasFailedPrice && rowRefreshStatus === 'queued_next_window' && (
                <div className="flex items-center gap-1 text-[11px] text-sky-600" title={asset.priceFetchMessage}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Queued for next window
                </div>
              )}
              {!hasFailedPrice && rowRefreshStatus === 'using_cached_close_today' && (
                <div className="flex items-center gap-1 text-[11px] text-slate-500" title={asset.priceFetchMessage}>
                  <Check className="h-3.5 w-3.5" />
                  Using today&apos;s cached close
                </div>
              )}
              {!hasFailedPrice && rowRefreshStatus === 'using_last_saved_price' && (
                <div className="flex items-center gap-1 text-[11px] text-amber-600" title={asset.priceFetchMessage}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Using last saved price
                </div>
              )}
              {!hasFailedPrice && rowRefreshStatus === 'blocked_missing_credentials' && (
                <div className="flex items-center gap-1 text-[11px] text-amber-600" title={asset.priceFetchMessage}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Setup needed
                </div>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => getConvertedValue(getCurrentTotal(row), row.currency, baseCurrency), {
        id: 'marketValue',
        header: 'Market Value',
        cell: (info) => {
          const asset = info.row.original;
          const displayCurrency = getDisplayCurrency(asset);
          const currentTotal = info.getValue() as number;
          const investmentTotal = getConvertedValue(getInvestmentTotal(asset), asset.currency, baseCurrency);
          const showsAsDebt = isDebtAssetDisplay(asset);
          return (
            <div className="space-y-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className={`text-sm font-semibold ${showsAsDebt ? 'text-red-500' : 'text-slate-900 dark:text-slate-100'}`}>
                {formatCurrency(currentTotal, displayCurrency)}
              </div>
              <div className={`text-xs ${showsAsDebt ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                {showsAsDebt ? `Debt balance: ${formatCurrency(investmentTotal, displayCurrency)}` : `Cost basis: ${formatCurrency(investmentTotal, displayCurrency)}`}
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => getConvertedValue(getGrowthTotal(row), row.currency, baseCurrency), {
        id: 'performance',
        header: 'Performance',
        cell: (info) => {
          const asset = info.row.original;
          const growthTotal = info.getValue() as number;
          const displayCurrency = getDisplayCurrency(asset);
          const investmentTotal = getConvertedValue(getInvestmentTotal(asset), asset.currency, baseCurrency);
          const growthPercent = investmentTotal !== 0 ? growthTotal / investmentTotal : 0;
          const xirr = getAssetXirr(asset, displayCurrency, rates);
          const showsAsDebt = isDebtAssetDisplay(asset);
          const tone = growthTotal >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300';

          return (
            <div className="space-y-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
                  {formatPercent(growthPercent)}
                </span>
                <span className={`text-sm font-semibold ${getStatusColor(growthTotal)}`}>
                  {formatCurrency(growthTotal, displayCurrency)}
                </span>
              </div>
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {showsAsDebt ? 'XIRR: Not applicable for debt' : `XIRR: ${formatPercent(xirr)}`}
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor('comments', {
        id: 'notes',
        header: 'Notes',
        cell: (info) => {
          const asset = info.row.original;
          return (
            <div className="space-y-1">
              <div className="text-sm text-slate-700 dark:text-slate-200">{asset.comments || 'No comments added'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{getPricingModeLabel(asset)}</div>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        enableColumnFilter: false,
        enableSorting: false,
        cell: (info) => {
          const asset = info.row.original;
          const menuOpen = openRowMenuId === asset.id;

          return (
            <div className="relative flex items-center justify-end" ref={menuOpen ? rowMenuRef : null}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpenRowMenuId((current) => current === asset.id ? null : asset.id)}
                title="More actions"
              >
                <Ellipsis className="h-4 w-4 text-slate-500" />
              </Button>
              {menuOpen ? (
                <div className="absolute right-0 top-10 z-30 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-950">
                  {!asset.sourceManaged ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setOpenRowMenuId(null);
                        await duplicateAsset(asset.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      <WalletCards className="h-4 w-4" />
                      Duplicate Asset
                    </button>
                  ) : null}
                  {!asset.sourceManaged ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenRowMenuId(null);
                        onEditAsset?.(asset);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      <Edit className="h-4 w-4" />
                      Edit
                    </button>
                  ) : null}
                  {!asset.sourceManaged ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setOpenRowMenuId(null);
                        await removeAsset(asset.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        },
      }),
    ];
  }, [baseCurrency, duplicateAsset, getConvertedValue, getDisplayCurrency, handleRefreshRow, onEditAsset, openRowMenuId, rates, refreshFailedPrices, refreshingRowIds, removeAsset, user?.displayName, user?.email]);

  const canadaAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.country === 'Canada'),
    [filteredAssets],
  );
  const indiaAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.country === 'India'),
    [filteredAssets],
  );
  const failedAssets = useMemo(
    () => filteredAssets.filter((asset) => hasActionablePriceFailure(asset)),
    [filteredAssets],
  );
  const queuedAssets = useMemo(
    () => filteredAssets.filter((asset) => getBulkRefreshRowStatus(asset) === 'queued_next_window'),
    [filteredAssets],
  );
  const manualAssets = useMemo(
    () => filteredAssets.filter((asset) => !isLivePricingAsset(asset)),
    [filteredAssets],
  );
  const globalFailedAssets = useMemo(
    () => assets.filter((asset) => hasActionablePriceFailure(asset)),
    [assets],
  );
  const globalManualAssets = useMemo(
    () => assets.filter((asset) => !isLivePricingAsset(asset)),
    [assets],
  );
  const globalMarketLinkedAssets = useMemo(
    () => assets.filter((asset) => isLivePricingAsset(asset)),
    [assets],
  );
  const statsModalAssets = statsModal.type === 'failed'
    ? globalFailedAssets
    : statsModal.type === 'manual'
      ? globalManualAssets
      : assets;
  const statsModalTitle = statsModal.type === 'failed'
    ? 'Price Rows Needing Attention'
    : statsModal.type === 'manual'
      ? 'Manual Pricing Rows'
      : 'All Portfolio Rows';
  const statsModalDescription = statsModal.type === 'failed'
    ? 'These rows still need attention. Queued refreshes waiting for the next Massive window are excluded from this count.'
    : statsModal.type === 'manual'
      ? 'These rows are set to manual pricing and will not use ticker refreshes.'
      : 'These are all rows in the portfolio. Bulk refresh operates on all market-linked rows, not just the filtered view.';

  const canadaTable = useReactTable<Asset>({
    data: canadaAssets,
    columns,
    state: {
      sorting: ledgerSorting,
      columnVisibility: HIDDEN_LEDGER_COLUMNS,
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const indiaTable = useReactTable<Asset>({
    data: indiaAssets,
    columns,
    state: {
      sorting: ledgerSorting,
      columnVisibility: HIDDEN_LEDGER_COLUMNS,
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const canadaDisplayGroups = buildLedgerDisplayGroups(canadaTable.getRowModel().rows, baseCurrency, rates);
  const indiaDisplayGroups = buildLedgerDisplayGroups(indiaTable.getRowModel().rows, baseCurrency, rates);

  return (
    <div className="space-y-6">
      <div className="mb-8 flex justify-between items-start gap-3">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">Assets</h1>
          <p className="text-lg text-slate-500 dark:text-slate-400">Manage your family's individual holdings</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refreshPrices} disabled={isRefreshing} className="hidden sm:flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Rates
          </Button>
          <Button onClick={onAddAsset} className="bg-[#00875A] hover:bg-[#007A51] text-white rounded-lg shrink-0 px-4">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Asset</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Search</p>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search asset, ticker, platform, comments..."
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 px-4 dark:border-slate-800 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Members</p>
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={memberFilter === 'ALL'} onClick={() => setMemberFilter('ALL')}>Both</FilterChip>
                  {members.map((member) => (
                    <FilterChip key={member} active={memberFilter === member} onClick={() => setMemberFilter(member)}>
                      {member}
                    </FilterChip>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Asset Classes</p>
                <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                  <div className="sm:row-span-2">
                    <AssetClassFilterChip
                      label="All Assets"
                      active={assetClassFilter === 'ALL'}
                      onClick={() => setAssetClassFilter('ALL')}
                    />
                  </div>
                  <AssetClassFilterRow
                    country="Canada"
                    assetClasses={assetClassOptionsByCountry.Canada}
                    activeAssetClass={assetClassFilter}
                    onSelect={setAssetClassFilter}
                    assetClassesMeta={assetClasses}
                  />
                  <AssetClassFilterRow
                    country="India"
                    assetClasses={assetClassOptionsByCountry.India}
                    activeAssetClass={assetClassFilter}
                    onSelect={setAssetClassFilter}
                    assetClassesMeta={assetClasses}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Pricing</p>
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={pricingFilter === 'ALL'} onClick={() => setPricingFilter('ALL')}>All</FilterChip>
                  <FilterChip active={pricingFilter === 'AUTO'} onClick={() => setPricingFilter('AUTO')}>Live Price</FilterChip>
                  <FilterChip active={pricingFilter === 'MANUAL'} onClick={() => setPricingFilter('MANUAL')}>Manual</FilterChip>
                  <FilterChip active={pricingFilter === 'FAILED'} onClick={() => setPricingFilter('FAILED')}>Needs Attention</FilterChip>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatPill label="Rows" value={String(assets.length)} onClick={() => setStatsModal({ type: 'rows', open: true })} />
                <StatPill label="Needs Attention" value={String(globalFailedAssets.length)} onClick={() => setStatsModal({ type: 'failed', open: true })} />
                <StatPill label="Manual" value={String(globalManualAssets.length)} onClick={() => setStatsModal({ type: 'manual', open: true })} />
              </div>

              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Refresh Status</p>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                        safeBulkRefreshState.status === 'queued'
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                          : safeBulkRefreshState.status === 'partial'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            : safeBulkRefreshState.status === 'running'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      }`}>
                        {formatBulkRefreshStatusLabel(safeBulkRefreshState.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {safeBulkRefreshState.queues.length > 0
                        ? buildCompactRefreshSummary(safeBulkRefreshState)
                        : 'Bulk refresh covers all market-linked rows in the portfolio. Open details for queue, cached-close, and issue breakdowns.'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setRefreshCenterOpen(true)}>
                    View Details
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <RefreshMetricCard label="Market-linked" value={String(globalMarketLinkedAssets.length)} tone="neutral" />
                  <RefreshMetricCard label="Updated now" value={String(safeBulkRefreshState.counts.updatedNow)} tone="positive" />
                  <RefreshMetricCard label="Queued" value={String(safeBulkRefreshState.counts.queued)} tone="info" />
                  <RefreshMetricCard label="Needs attention" value={String(safeBulkRefreshState.counts.needsAttention)} tone="warning" />
                </div>
              </div>

              <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                Canada assets appear first, followed by India. Use the header filter icons for Excel-style column filtering and quick value selection. {queuedAssets.length > 0 ? `${queuedAssets.length} filtered row${queuedAssets.length === 1 ? ' is' : 's are'} currently queued.` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden space-y-6 md:block">
        <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Sort</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Apply one sort mode across both country tables.</p>
          </div>
          <div className="w-full max-w-[260px]">
            <Select value={sortMode} onChange={(event) => setSortMode(event.target.value as LedgerSortMode)} className="h-11 rounded-2xl">
              {SORT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <CountryTableSection
          title="Canada Assets"
          subtitle="Group totals update automatically with your current filters and sort mode."
          table={canadaTable}
          displayGroups={canadaDisplayGroups}
          columnsLength={columns.length}
          columnFilters={columnFilters}
          openColumnFilter={openColumnFilter}
          setOpenColumnFilter={setOpenColumnFilter}
          columnFilterOptions={columnFilterOptions}
          setColumnFilterSelected={setColumnFilterSelected}
          setColumnFilterRange={setColumnFilterRange}
          setColumnFilterSearch={setColumnFilterSearch}
          clearColumnFilter={clearColumnFilter}
        />
        <CountryTableSection
          title="India Assets"
          subtitle="Group totals update automatically with your current filters and sort mode."
          table={indiaTable}
          displayGroups={indiaDisplayGroups}
          columnsLength={columns.length}
          columnFilters={columnFilters}
          openColumnFilter={openColumnFilter}
          setOpenColumnFilter={setOpenColumnFilter}
          columnFilterOptions={columnFilterOptions}
          setColumnFilterSelected={setColumnFilterSelected}
          setColumnFilterRange={setColumnFilterRange}
          setColumnFilterSearch={setColumnFilterSearch}
          clearColumnFilter={clearColumnFilter}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:hidden">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Sort</p>
            <Select value={sortMode} onChange={(event) => setSortMode(event.target.value as LedgerSortMode)} className="h-11 rounded-2xl">
              {SORT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {[...canadaTable.getRowModel().rows, ...indiaTable.getRowModel().rows].length ? (
          [...canadaDisplayGroups, ...indiaDisplayGroups].flatMap((group) => {
            const cards = group.rows.map((row, index, allRows) => {
            const asset = row.original;
            const displayCurrency = getDisplayCurrency(asset);
            const investmentTotal = getConvertedValue(getInvestmentTotal(asset), asset.currency, baseCurrency);
            const investmentPrice = getConvertedValue(getInvestmentPrice(asset), asset.currency, baseCurrency);
            const currentPrice = getConvertedValue(getCurrentPrice(asset), asset.currency, baseCurrency);
            const currentTotal = getConvertedValue(getCurrentTotal(asset), asset.currency, baseCurrency);
            const growthTotal = getConvertedValue(getGrowthTotal(asset), asset.currency, baseCurrency);
            const xirr = getAssetXirr(asset, displayCurrency, rates);
            const showsAsDebt = isDebtAssetDisplay(asset);
            const isRowRefreshing = refreshingRowIds.includes(asset.id);
            const toneClasses = getAssetToneClasses(asset);

            return (
              <React.Fragment key={row.id}>
                <div className={`rounded-lg border p-4 bg-white dark:bg-slate-950 dark:border-slate-800 space-y-3 shadow-sm ${toneClasses.mobileCard}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-3">
                        <AssetMarketLogo asset={asset} className={`h-10 w-10 ${toneClasses.iconTile}`} />
                        <div>
                          <div className="font-semibold text-lg">{asset.name}</div>
                          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                              {getOwnerInitials(asset.owner)}
                            </span>
                            {asset.owner} • {asset.country}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!asset.sourceManaged ? (
                        <Button variant="ghost" size="icon" onClick={() => onEditAsset?.(asset)}>
                          <Edit className="h-4 w-4 text-slate-500" />
                        </Button>
                      ) : null}
                      {!asset.sourceManaged ? (
                        <Button variant="ghost" size="icon" onClick={() => removeAsset(asset.id)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
                    <div>
                      <div className="text-slate-500">Asset Class</div>
                      <div className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses.chip}`}>{getCanonicalAssetClass(asset.assetClass)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Total Quantity</div>
                      <div>{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    </div>
                      <div>
                        <div className="text-slate-500">Ticker</div>
                        {showsTickerManagement(asset) ? (
                          <>
                            <div>{shouldDisplayTicker(asset) ? (asset.ticker || '-') : 'System gold feed'}</div>
                            <button
                              type="button"
                              onClick={() => setTickerRepairAsset(asset)}
                              className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${hasActionablePriceFailure(asset) ? 'text-amber-600' : 'text-slate-500'}`}
                              title={hasActionablePriceFailure(asset) ? asset.priceFetchMessage || 'Price fetch failed.' : isGoldAsset(asset) ? 'Adjust system gold pricing settings' : 'Check or update ticker/provider'}
                            >
                              {hasActionablePriceFailure(asset) ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                              {getPricingActionLabel(asset)}
                            </button>
                            {((!isGoldAsset(asset) && asset.ticker) || asset.connectedProvider === 'splitwise') ? (
                              <button
                                type="button"
                                onClick={() => void handleRefreshRow(asset.id)}
                                disabled={isRowRefreshing}
                                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Refresh only this row"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${isRowRefreshing ? 'animate-spin' : ''}`} />
                                Refresh row
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <div>{getPricingModeLabel(asset)}</div>
                        )}
                      </div>
                    <div>
                      <div className="text-slate-500">Holding Platform</div>
                      <div>{asset.holdingPlatform || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Comments</div>
                      <div>{asset.comments || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{showsAsDebt ? 'Debt Balance' : 'Investment Total'}</div>
                      <div className={showsAsDebt ? 'font-medium text-red-500' : ''}>{formatCurrency(investmentTotal, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{showsAsDebt ? 'Balance per Unit' : 'Investment Price'}</div>
                      <div className={showsAsDebt ? 'font-medium text-red-500' : ''}>{formatCurrency(investmentPrice, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{showsAsDebt ? 'Current Balance per Unit' : 'Current Price'}</div>
                      <div className={showsAsDebt ? 'font-medium text-red-500' : ''}>{asset.currentPrice ? formatCurrency(currentPrice, displayCurrency) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{showsAsDebt ? 'Current Debt' : 'Current Total'}</div>
                      <div className={`font-semibold ${showsAsDebt ? 'text-red-500' : ''}`}>{formatCurrency(currentTotal, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Total Growth</div>
                      <div className={growthTotal >= 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-500'}>
                        {formatCurrency(growthTotal, displayCurrency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">XIRR</div>
                      <div>{showsAsDebt ? 'Not applicable for debt' : formatPercent(xirr)}</div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
            });

            cards.push(
              <MobileClassTotalCard key={`subtotal-${group.assetClass}-${group.metrics.currency}-${group.rows[0]?.id || 'group'}`} group={group} />
            );

            return cards;
          })
        ) : (
          <div className="text-center py-8 text-slate-500">No assets found.</div>
        )}
      </div>

      <TickerRepairModal
        asset={tickerRepairAsset}
        open={Boolean(tickerRepairAsset)}
        onOpenChange={(open) => {
          if (!open) {
            setTickerRepairAsset(undefined);
          }
        }}
      />

      <Dialog open={refreshCenterOpen} onOpenChange={setRefreshCenterOpen}>
        <DialogHeader>
          <DialogTitle>Refresh Control Center</DialogTitle>
          <DialogDescription>
            Bulk refresh covers all market-linked rows in the portfolio, not just the current filtered view.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {safeBulkRefreshState.queues.length > 0
                ? buildCompactRefreshSummary(safeBulkRefreshState)
                : 'No provider queues are waiting right now. AMFI, Upstox, gold, and any eligible close-based rows are ready to refresh immediately.'}
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
              safeBulkRefreshState.status === 'queued'
                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                : safeBulkRefreshState.status === 'partial'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : safeBulkRefreshState.status === 'running'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}>
              {formatBulkRefreshStatusLabel(safeBulkRefreshState.status)}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <RefreshMetricCard label="Market-linked" value={String(globalMarketLinkedAssets.length)} tone="neutral" />
            <RefreshMetricCard label="Updated now" value={String(safeBulkRefreshState.counts.updatedNow)} tone="positive" />
            <RefreshMetricCard label="Using cached close" value={String(safeBulkRefreshState.counts.usingCachedClose)} tone="neutral" />
            <RefreshMetricCard label="Queued" value={String(safeBulkRefreshState.counts.queued)} tone="info" />
            <RefreshMetricCard label="Needs attention" value={String(safeBulkRefreshState.counts.needsAttention)} tone="warning" />
            <RefreshMetricCard label="Manual" value={String(globalManualAssets.length)} tone="neutral" />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Current Run</div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {safeBulkRefreshState.queues.length > 0
                  ? safeBulkRefreshState.queues.map((queue) => (
                      <div key={queue.provider} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">{queue.provider === 'massive' ? 'Massive queue' : 'Alpha Vantage queue'}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {queue.pendingRows} row{queue.pendingRows === 1 ? '' : 's'} across {queue.pendingRequests} request{queue.pendingRequests === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="text-xs font-medium text-sky-700 dark:text-sky-300">
                          {queue.nextRunAt ? formatQueueTime(queue.nextRunAt) : 'Waiting'}
                        </div>
                      </div>
                    ))
                  : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      No provider queues are waiting right now.
                    </div>
                  )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Top Issues</div>
              <div className="mt-2 space-y-2">
                {safeBulkRefreshState.issues.length > 0 ? (
                  safeBulkRefreshState.issues.map((issue) => (
                    <div key={issue.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-sm text-slate-700 dark:text-slate-200">{issue.label}</div>
                      <span className={getIssueBadgeClass(issue.tone)}>{issue.count}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    No grouped issues right now. Cached-close and queued rows are tracked separately from actionable failures.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog open={statsModal.open} onOpenChange={(open) => setStatsModal((current) => ({ ...current, open }))}>
        <DialogHeader>
          <DialogTitle>{statsModalTitle}</DialogTitle>
          <DialogDescription>{statsModalDescription}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {statsModalAssets.length ? (
            statsModalAssets.map((asset) => {
              const isRowRefreshing = refreshingRowIds.includes(asset.id);
              const supportsTickerPricing = showsTickerManagement(asset);
              return (
                <div key={asset.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{asset.name}</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {getCanonicalAssetClass(asset.assetClass)} • {asset.owner} • {asset.country}
                        {shouldDisplayTicker(asset) && asset.ticker ? ` • ${asset.ticker}` : ''}
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {isLivePricingAsset(asset) ? (
                          hasActionablePriceFailure(asset)
                            ? <span className="text-amber-600">{getVisiblePriceFetchMessage(asset, priceProviderSettings)}</span>
                            : isQueuedAsset(asset)
                              ? <span className="text-sky-600">{asset.priceFetchMessage}</span>
                              : getBulkRefreshRowStatus(asset) === 'using_cached_close_today'
                                ? <span className="text-slate-500">{asset.priceFetchMessage}</span>
                                : getBulkRefreshRowStatus(asset) === 'using_last_saved_price' || getBulkRefreshRowStatus(asset) === 'blocked_missing_credentials'
                                  ? <span className="text-amber-600">{asset.priceFetchMessage}</span>
                              : 'Live price enabled'
                        ) : 'Manual pricing'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {supportsTickerPricing ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setTickerRepairAsset(asset)}>
                            {getPricingActionLabel(asset)}
                          </Button>
                          {!isGoldAsset(asset) && asset.ticker ? (
                            <Button variant="outline" size="sm" onClick={() => void handleRefreshRow(asset.id)} disabled={isRowRefreshing}>
                              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRowRefreshing ? 'animate-spin' : ''}`} />
                              Refresh row
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setStatsModal((current) => ({ ...current, open: false }));
                          onEditAsset?.(asset);
                        }}
                      >
                        <Edit className="mr-2 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              No rows match this summary right now.
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function getVisiblePriceFetchMessage(asset: Asset, priceProviderSettings: { alphaVantageApiKey: string; finnhubApiKey: string; primaryProvider: string; secondaryProvider: string }) {
  const rawMessage = asset.priceFetchMessage || 'Price fetch failed.';

  if (
    asset.preferredPriceProvider === 'alphavantage' &&
    !priceProviderSettings.alphaVantageApiKey?.trim() &&
    rawMessage.toLowerCase().includes('missing alpha vantage api key')
  ) {
    return 'Saved provider Alpha Vantage is not configured. Refresh row will use Yahoo fallback.';
  }

  if (
    asset.preferredPriceProvider === 'finnhub' &&
    !priceProviderSettings.finnhubApiKey?.trim() &&
    rawMessage.toLowerCase().includes('missing finnhub api key')
  ) {
    return 'Saved provider Finnhub is not configured. Refresh row will use Yahoo fallback.';
  }

  return rawMessage;
}

function FilterChip({ active, children, onClick }: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
    >
      {children}
    </button>
  );
}

function AssetClassFilterRow({
  country,
  assetClasses,
  activeAssetClass,
  onSelect,
  assetClassesMeta,
}: {
  country: 'Canada' | 'India';
  assetClasses: AssetClassFilterOption[];
  activeAssetClass: string;
  onSelect: (value: string) => void;
  assetClassesMeta: Array<{ country: string; name: string; image?: string }>;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[80px_minmax(0,1fr)] md:items-start">
      <div className="pt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">{country}</div>
      <div className="flex flex-wrap gap-2">
        {assetClasses.map((assetClassOption) => {
          const assetClassMeta = assetClassesMeta.find((candidate) => candidate.country === country && getCanonicalAssetClass(candidate.name) === assetClassOption.label);
          return (
            <AssetClassFilterChip
              key={assetClassOption.value}
              label={assetClassOption.label}
              image={assetClassMeta?.image}
              active={activeAssetClass === assetClassOption.value}
              onClick={() => onSelect(assetClassOption.value)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AssetClassFilterChip({
  label,
  image,
  active,
  onClick,
}: {
  label: string;
  image?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
          : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <AssetClassLogo name={label} image={image} className="h-6 w-6 shrink-0 rounded-full" />
      <span>{label}</span>
    </button>
  );
}

function StatPill({ label, value, onClick }: React.PropsWithChildren<{ label: string; value: string; onClick?: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
    </button>
  );
}

function ClassTotalRow({ group, columnsLength }: { group: LedgerDisplayGroup; columnsLength: number }) {
  const toneClasses = getAssetToneClasses(group.rows[0]?.original);

  return (
    <TableRow className={`${toneClasses.subtotalRow} ${toneClasses.subtotalHover}`}>
      <TableCell className="px-4 py-3 text-sm">
        <div className="font-semibold text-slate-900 dark:text-slate-100">{group.assetClass} total</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{group.rows.length} visible holding{group.rows.length === 1 ? '' : 's'}</div>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span className={`inline-flex rounded-full px-2.5 py-1 ${toneClasses.chip}`}>Filtered subtotal</span>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
        Invested
        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {formatCurrency(group.metrics.invested, group.metrics.currency)}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
        Current
        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {formatCurrency(group.metrics.current, group.metrics.currency)}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
        Gain / Loss
        <div className={`mt-1 text-sm font-semibold ${getStatusColor(group.metrics.gain)}`}>
          {formatCurrency(group.metrics.gain, group.metrics.currency)}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
        XIRR
        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {formatPercent(group.metrics.xirr)}
        </div>
      </TableCell>
      <TableCell colSpan={Math.max(columnsLength - 6, 1)} className="px-4 py-3" />
    </TableRow>
  );
}

function MobileClassTotalCard({ group }: { group: LedgerDisplayGroup }) {
  const toneClasses = getAssetToneClasses(group.rows[0]?.original);

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClasses.mobileCard} ${toneClasses.mobileSubtotalCard}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{group.assetClass} total</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{group.rows.length} visible holding{group.rows.length === 1 ? '' : 's'}</div>
        </div>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses.chip}`}>Filtered subtotal</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <MetricTile label="Invested" value={formatCurrency(group.metrics.invested, group.metrics.currency)} />
        <MetricTile label="Current" value={formatCurrency(group.metrics.current, group.metrics.currency)} />
        <MetricTile label="Gain / Loss" value={formatCurrency(group.metrics.gain, group.metrics.currency)} tone={group.metrics.gain >= 0 ? 'positive' : 'negative'} />
        <MetricTile label="XIRR" value={formatPercent(group.metrics.xirr)} />
      </div>
    </div>
  );
}

function RefreshMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'positive' | 'info' | 'warning';
}) {
  const toneClass = tone === 'positive'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'info'
      ? 'text-sky-700 dark:text-sky-300'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function MetricTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'positive' | 'negative' }) {
  const toneClass = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="rounded-2xl bg-white px-3 py-3 dark:bg-slate-950">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function normalizeBulkRefreshState(state: unknown) {
  const candidate = (state && typeof state === 'object') ? state as Record<string, unknown> : {};
  const rawCounts = (candidate.counts && typeof candidate.counts === 'object') ? candidate.counts as Record<string, unknown> : {};
  const rawQueues = Array.isArray(candidate.queues) ? candidate.queues : [];
  const rawIssues = Array.isArray(candidate.issues) ? candidate.issues : [];
  const queues = rawQueues
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      provider: entry.provider === 'alphavantage' ? 'alphavantage' : 'massive',
      pendingRequests: typeof entry.pendingRequests === 'number' ? entry.pendingRequests : 0,
      pendingRows: typeof entry.pendingRows === 'number' ? entry.pendingRows : 0,
      nextRunAt: typeof entry.nextRunAt === 'number' ? entry.nextRunAt : null,
    }));
  const issues = rawIssues
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      key: typeof entry.key === 'string' ? entry.key : crypto.randomUUID(),
      label: typeof entry.label === 'string' ? entry.label : 'Refresh issue',
      count: typeof entry.count === 'number' ? entry.count : 0,
      tone:
        entry.tone === 'sky' || entry.tone === 'amber' || entry.tone === 'rose' || entry.tone === 'emerald'
          ? entry.tone
          : 'slate',
    }));

  return {
    status: candidate.status === 'running' || candidate.status === 'queued' || candidate.status === 'completed' || candidate.status === 'partial'
      ? candidate.status
      : 'idle',
    counts: {
      eligibleMarketLinked: typeof rawCounts.eligibleMarketLinked === 'number' ? rawCounts.eligibleMarketLinked : 0,
      updatedNow: typeof rawCounts.updatedNow === 'number' ? rawCounts.updatedNow : 0,
      usingCachedClose: typeof rawCounts.usingCachedClose === 'number' ? rawCounts.usingCachedClose : 0,
      queued: typeof rawCounts.queued === 'number' ? rawCounts.queued : 0,
      skippedManual: typeof rawCounts.skippedManual === 'number' ? rawCounts.skippedManual : 0,
      blockedBySetup: typeof rawCounts.blockedBySetup === 'number' ? rawCounts.blockedBySetup : 0,
      needsAttention: typeof rawCounts.needsAttention === 'number' ? rawCounts.needsAttention : 0,
    },
    queues,
    issues,
  };
}

function formatBulkRefreshStatusLabel(status: 'idle' | 'running' | 'queued' | 'completed' | 'partial') {
  switch (status) {
    case 'running':
      return 'Refresh Running';
    case 'queued':
      return 'Queue Active';
    case 'completed':
      return 'Refresh Complete';
    case 'partial':
      return 'Partial Refresh';
    default:
      return 'Ready';
  }
}

function getIssueBadgeClass(tone: 'sky' | 'amber' | 'rose' | 'emerald' | 'slate') {
  switch (tone) {
    case 'sky':
      return 'inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300';
    case 'amber':
      return 'inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
    case 'rose':
      return 'inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300';
    case 'emerald':
      return 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
    default:
      return 'inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-300';
  }
}

function buildCompactRefreshSummary(state: ReturnType<typeof normalizeBulkRefreshState>) {
  if (state.queues.length === 0) {
    return 'No provider queues are waiting right now.';
  }

  return state.queues
    .map((queue) => {
      const providerLabel = queue.provider === 'massive' ? 'Massive' : 'Alpha Vantage';
      const timing = queue.nextRunAt ? ` at ${formatQueueTime(queue.nextRunAt)}` : '';
      return `${providerLabel} has ${queue.pendingRows} queued row${queue.pendingRows === 1 ? '' : 's'}${timing}`;
    })
    .join(' • ');
}

function isQueuedAsset(asset: Asset) {
  return getBulkRefreshRowStatus(asset) === 'queued_next_window';
}

function hasActionablePriceFailure(asset: Asset) {
  return getBulkRefreshRowStatus(asset) === 'failed_actionable';
}

function isQueuedPriceMessage(message?: string) {
  return Boolean(
    message &&
    (
      message.toLowerCase().includes('queued for the next massive refresh window') ||
      message.toLowerCase().includes('queued for the next alpha vantage daily close window')
    ),
  );
}

function formatQueueTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CountryTableSection({
  title,
  subtitle,
  table,
  displayGroups,
  columnsLength,
  columnFilters,
  openColumnFilter,
  setOpenColumnFilter,
  columnFilterOptions,
  setColumnFilterSelected,
  setColumnFilterRange,
  setColumnFilterSearch,
  clearColumnFilter,
}: {
  title: string;
  subtitle: string;
  table: ReturnType<typeof useReactTable<Asset>>;
  displayGroups: LedgerDisplayGroup[];
  columnsLength: number;
  columnFilters: FilterState;
  openColumnFilter: FilterColumnId | null;
  setOpenColumnFilter: (columnId: FilterColumnId | null) => void;
  columnFilterOptions: Record<'name' | 'assetClass' | 'notes', string[]>;
  setColumnFilterSelected: (columnId: FilterColumnId, selected: string[]) => void;
  setColumnFilterRange: (columnId: FilterColumnId, key: 'min' | 'max', value: string) => void;
  setColumnFilterSearch: (columnId: FilterColumnId, value: string) => void;
  clearColumnFilter: (columnId: FilterColumnId) => void;
}) {
  const headerGroups = table.getHeaderGroups();

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <Table className="min-w-[1280px] w-full table-fixed">
        <colgroup>
          {TABLE_COLUMN_WIDTHS.map((width, index) => (
            <col key={`${width}-${index}`} style={{ width }} />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-slate-950/95">
          {headerGroups.map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header, index) => (
                <TableHead
                  key={header.id}
                  style={{ width: TABLE_COLUMN_WIDTHS[index] }}
                  className="min-w-0 border-b border-slate-200 bg-white/95 px-4 py-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-400"
                >
                  {header.isPlaceholder ? null : (
                    <div className="relative">
                      <div
                        className="flex items-center gap-2"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isFilterableColumn(header.column.id) ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const columnId = header.column.id as FilterColumnId;
                              setOpenColumnFilter(openColumnFilter === columnId ? null : columnId);
                            }}
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                              isColumnFilterActive(columnFilters[header.column.id as FilterColumnId])
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-600 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-300'
                            }`}
                            title="Filter this column"
                          >
                            <Filter className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {isFilterableColumn(header.column.id) && openColumnFilter === header.column.id ? (
                        <ColumnFilterMenu
                          columnId={header.column.id as FilterColumnId}
                          filter={columnFilters[header.column.id as FilterColumnId]}
                          options={
                            header.column.id === 'name' || header.column.id === 'assetClass' || header.column.id === 'notes'
                              ? columnFilterOptions[header.column.id as 'name' | 'assetClass' | 'notes']
                              : []
                          }
                          onClose={() => setOpenColumnFilter(null)}
                          onClear={() => clearColumnFilter(header.column.id as FilterColumnId)}
                          onSearchChange={(value) => setColumnFilterSearch(header.column.id as FilterColumnId, value)}
                          onSelectedChange={(selected) => setColumnFilterSelected(header.column.id as FilterColumnId, selected)}
                          onRangeChange={(key, value) => setColumnFilterRange(header.column.id as FilterColumnId, key, value)}
                        />
                      ) : null}
                    </div>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {displayGroups.length ? (
            displayGroups.flatMap((group) => {
              return [
                ...group.rows.map((row, index) => {
                  const toneClasses = getAssetToneClasses(row.original);
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow className={`align-top border-l-[3px] transition-colors ${toneClasses.rowAccent} ${toneClasses.rowSurface} ${toneClasses.rowHover}`}>
                        {row.getVisibleCells().map((cell, cellIndex) => (
                          <TableCell
                            key={cell.id}
                            style={{ width: TABLE_COLUMN_WIDTHS[cellIndex] }}
                            className="min-w-0 px-4 py-4 text-sm leading-6"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    </React.Fragment>
                  );
                }),
                <ClassTotalRow key={`subtotal-${group.assetClass}-${group.metrics.currency}-${group.rows[0]?.id || 'group'}`} group={group} columnsLength={columnsLength} />,
              ];
            })
          ) : (
            <TableRow>
              <TableCell colSpan={columnsLength} className="h-24 text-center">
                No assets found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function getOwnerInitials(owner: string) {
  return owner
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'NA';
}

function getSortingForMode(sortMode: LedgerSortMode): SortingState {
  switch (sortMode) {
    case 'name':
      return [{ id: 'name', desc: false }];
    case 'assetClass':
      return [{ id: 'assetClass', desc: false }, { id: 'name', desc: false }];
    case 'position':
      return [{ id: 'position', desc: true }, { id: 'name', desc: false }];
    case 'currentPrice':
      return [{ id: 'currentPrice', desc: true }, { id: 'name', desc: false }];
    case 'marketValue':
      return [{ id: 'marketValue', desc: true }, { id: 'name', desc: false }];
    case 'performance':
      return [{ id: 'performance', desc: true }, { id: 'name', desc: false }];
    case 'default':
    default:
      return [{ id: 'defaultOrder', desc: false }];
  }
}

function buildLedgerDisplayGroups(
  rows: Row<Asset>[],
  baseCurrency: LedgerCurrency,
  rates: Record<string, number> | null,
): LedgerDisplayGroup[] {
  const groups = new Map<string, Row<Asset>[]>();

  rows.forEach((row) => {
    const assetClass = getCanonicalAssetClass(row.original.assetClass);
    if (!groups.has(assetClass)) {
      groups.set(assetClass, []);
    }
    groups.get(assetClass)?.push(row);
  });

  return Array.from(groups.entries()).map(([assetClass, groupedRows]) => ({
    assetClass,
    rows: groupedRows,
    metrics: buildLedgerGroupMetrics(groupedRows.map((row) => row.original), baseCurrency, rates),
  }));
}

function buildLedgerGroupMetrics(
  assets: Asset[],
  baseCurrency: LedgerCurrency,
  rates: Record<string, number> | null,
): LedgerDisplayGroup['metrics'] {
  const currency = getGroupDisplayCurrency(assets, baseCurrency);
  const invested = assets.reduce((sum, asset) => sum + convertAmount(getInvestmentTotal(asset), asset.currency, currency, rates), 0);
  const current = assets.reduce((sum, asset) => sum + convertAmount(getCurrentTotal(asset), asset.currency, currency, rates), 0);
  const gain = assets.reduce((sum, asset) => sum + convertAmount(getGrowthTotal(asset), asset.currency, currency, rates), 0);
  const xirr = getGroupedXirr(assets, currency, rates);

  return { invested, current, gain, xirr, currency };
}

function getGroupDisplayCurrency(assets: Asset[], baseCurrency: LedgerCurrency): SubtotalCurrency {
  const firstAsset = assets[0];
  if (!firstAsset) return 'CAD';
  if (baseCurrency !== 'ORIGINAL') return baseCurrency;
  return firstAsset.country === 'India' ? 'INR' : 'CAD';
}

function getGroupedXirr(
  assets: Asset[],
  currency: SubtotalCurrency,
  rates: Record<string, number> | null,
) {
  if (assets.length === 0) return null;
  if (assets.some((asset) => isDebtAssetClass(asset.assetClass) || !asset.purchaseDate)) return null;

  const parsedDates = assets.map((asset) => {
    const parsed = new Date(asset.purchaseDate as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  });

  if (parsedDates.some((value) => !value)) return null;
  const uniqueDates = new Set(parsedDates as string[]);
  if (uniqueDates.size > 1) return null;

  const invested = assets.reduce((sum, asset) => sum + convertAmount(getInvestmentTotal(asset), asset.currency, currency, rates), 0);
  const current = assets.reduce((sum, asset) => sum + convertAmount(getCurrentTotal(asset), asset.currency, currency, rates), 0);

  if (invested <= 0 || current <= 0) return null;

  const sharedDate = new Date((parsedDates[0] as string));
  const now = new Date();
  const elapsedDays = (now.getTime() - sharedDate.getTime()) / (1000 * 60 * 60 * 24);
  if (elapsedDays <= 0) return null;

  return Math.pow(current / invested, 365.25 / elapsedDays) - 1;
}

type AssetToneKey = 'stocks' | 'mutualFunds' | 'gold' | 'cash' | 'retirement' | 'realEstate' | 'credit' | 'neutral';
type AssetSortBucket = 'shortTerm' | 'longTerm' | 'liability';

const ASSET_SORT_BUCKET_ORDER: Record<AssetSortBucket, number> = {
  shortTerm: 1,
  longTerm: 2,
  liability: 3,
};

function getAssetToneKey(asset: Asset): AssetToneKey {
  const canonical = getCanonicalAssetClass(asset.assetClass).trim().toLowerCase();

  if (canonical === 'stocks') return 'stocks';
  if (canonical === 'mutual funds') return 'mutualFunds';
  if (canonical === 'gold') return 'gold';
  if (canonical.includes('cash') || canonical.includes('bank account')) return 'cash';
  if (canonical === 'pf' || canonical === 'ppf' || canonical === 'fd' || canonical === 'nps') return 'retirement';
  if (canonical.includes('real estate') || canonical.includes('property')) return 'realEstate';
  if (canonical.includes('credit') || canonical.includes('debt') || canonical.includes('loan')) return 'credit';
  return 'neutral';
}

function getAssetToneClasses(asset: Asset) {
  const tone = getAssetToneKey(asset);

  const toneMap: Record<AssetToneKey, {
    iconTile: string;
    chip: string;
    rowAccent: string;
    rowSurface: string;
    rowHover: string;
    subtotalRow: string;
    subtotalHover: string;
    mobileCard: string;
    mobileSubtotalCard: string;
  }> = {
    stocks: {
      iconTile: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
      chip: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
      rowAccent: 'border-l-blue-200 dark:border-l-blue-900/70',
      rowSurface: 'bg-blue-50/80 dark:bg-blue-950/22',
      rowHover: 'hover:bg-blue-100/80 dark:hover:bg-blue-950/35',
      subtotalRow: 'bg-blue-100/75 dark:bg-blue-950/30',
      subtotalHover: 'hover:bg-blue-100/75 dark:hover:bg-blue-950/30',
      mobileCard: 'border-blue-200 bg-blue-50/85 dark:border-blue-950/55 dark:bg-blue-950/25',
      mobileSubtotalCard: 'bg-blue-100/85 dark:bg-blue-950/35',
    },
    mutualFunds: {
      iconTile: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
      chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
      rowAccent: 'border-l-emerald-200 dark:border-l-emerald-900/70',
      rowSurface: 'bg-emerald-50/80 dark:bg-emerald-950/22',
      rowHover: 'hover:bg-emerald-100/80 dark:hover:bg-emerald-950/35',
      subtotalRow: 'bg-emerald-100/75 dark:bg-emerald-950/30',
      subtotalHover: 'hover:bg-emerald-100/75 dark:hover:bg-emerald-950/30',
      mobileCard: 'border-emerald-200 bg-emerald-50/85 dark:border-emerald-950/55 dark:bg-emerald-950/25',
      mobileSubtotalCard: 'bg-emerald-100/85 dark:bg-emerald-950/35',
    },
    gold: {
      iconTile: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      rowAccent: 'border-l-amber-200 dark:border-l-amber-900/70',
      rowSurface: 'bg-amber-50/80 dark:bg-amber-950/22',
      rowHover: 'hover:bg-amber-100/80 dark:hover:bg-amber-950/35',
      subtotalRow: 'bg-amber-100/75 dark:bg-amber-950/30',
      subtotalHover: 'hover:bg-amber-100/75 dark:hover:bg-amber-950/30',
      mobileCard: 'border-amber-200 bg-amber-50/85 dark:border-amber-950/55 dark:bg-amber-950/25',
      mobileSubtotalCard: 'bg-amber-100/85 dark:bg-amber-950/35',
    },
    cash: {
      iconTile: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
      chip: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
      rowAccent: 'border-l-cyan-200 dark:border-l-cyan-900/70',
      rowSurface: 'bg-cyan-50/80 dark:bg-cyan-950/22',
      rowHover: 'hover:bg-cyan-100/80 dark:hover:bg-cyan-950/35',
      subtotalRow: 'bg-cyan-100/75 dark:bg-cyan-950/30',
      subtotalHover: 'hover:bg-cyan-100/75 dark:hover:bg-cyan-950/30',
      mobileCard: 'border-cyan-200 bg-cyan-50/85 dark:border-cyan-950/55 dark:bg-cyan-950/25',
      mobileSubtotalCard: 'bg-cyan-100/85 dark:bg-cyan-950/35',
    },
    retirement: {
      iconTile: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
      chip: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
      rowAccent: 'border-l-violet-200 dark:border-l-violet-900/70',
      rowSurface: 'bg-violet-50/80 dark:bg-violet-950/22',
      rowHover: 'hover:bg-violet-100/80 dark:hover:bg-violet-950/35',
      subtotalRow: 'bg-violet-100/75 dark:bg-violet-950/30',
      subtotalHover: 'hover:bg-violet-100/75 dark:hover:bg-violet-950/30',
      mobileCard: 'border-violet-200 bg-violet-50/85 dark:border-violet-950/55 dark:bg-violet-950/25',
      mobileSubtotalCard: 'bg-violet-100/85 dark:bg-violet-950/35',
    },
    realEstate: {
      iconTile: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
      chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
      rowAccent: 'border-l-rose-200 dark:border-l-rose-900/70',
      rowSurface: 'bg-rose-50/80 dark:bg-rose-950/22',
      rowHover: 'hover:bg-rose-100/80 dark:hover:bg-rose-950/35',
      subtotalRow: 'bg-rose-100/75 dark:bg-rose-950/30',
      subtotalHover: 'hover:bg-rose-100/75 dark:hover:bg-rose-950/30',
      mobileCard: 'border-rose-200 bg-rose-50/85 dark:border-rose-950/55 dark:bg-rose-950/25',
      mobileSubtotalCard: 'bg-rose-100/85 dark:bg-rose-950/35',
    },
    credit: {
      iconTile: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      chip: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      rowAccent: 'border-l-red-200 dark:border-l-red-900/70',
      rowSurface: 'bg-red-50/80 dark:bg-red-950/22',
      rowHover: 'hover:bg-red-100/80 dark:hover:bg-red-950/35',
      subtotalRow: 'bg-red-100/75 dark:bg-red-950/30',
      subtotalHover: 'hover:bg-red-100/75 dark:hover:bg-red-950/30',
      mobileCard: 'border-red-200 bg-red-50/85 dark:border-red-950/55 dark:bg-red-950/25',
      mobileSubtotalCard: 'bg-red-100/85 dark:bg-red-950/35',
    },
    neutral: {
      iconTile: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
      chip: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
      rowAccent: 'border-l-slate-200 dark:border-l-slate-800',
      rowSurface: 'bg-slate-100/85 dark:bg-slate-900/45',
      rowHover: 'hover:bg-slate-200/80 dark:hover:bg-slate-800/70',
      subtotalRow: 'bg-slate-200/75 dark:bg-slate-800/70',
      subtotalHover: 'hover:bg-slate-200/75 dark:hover:bg-slate-800/70',
      mobileCard: 'border-slate-300 bg-slate-100/90 dark:border-slate-800 dark:bg-slate-900/55',
      mobileSubtotalCard: 'bg-slate-200/85 dark:bg-slate-800/80',
    },
  };

  return toneMap[tone];
}

function getAssetSortBucket(asset: Asset): AssetSortBucket {
  const canonical = getCanonicalAssetClass(asset.assetClass).trim().toLowerCase();
  const registeredHint = getRegisteredAccountHint(asset);

  if (canonical === 'credit card' || canonical.includes('debt') || canonical.includes('loan')) return 'liability';

  if (
    canonical === 'stocks' ||
    canonical === 'mutual funds' ||
    canonical === 'gold' ||
    canonical === 'cash' ||
    canonical.includes('bank account') ||
    canonical === 'tfsa' ||
    canonical === 'other'
  ) {
    return 'shortTerm';
  }

  if (
    canonical === 'pf' ||
    canonical === 'ppf' ||
    canonical === 'fd' ||
    canonical === 'nps' ||
    canonical.includes('real estate') ||
    canonical.includes('property') ||
    canonical === 'rrsp' ||
    canonical === 'fhsa'
  ) {
    return 'longTerm';
  }

  if (canonical === 'tfsa/rrsp/fhsa') {
    if (registeredHint === 'tfsa') return 'shortTerm';
    return 'longTerm';
  }

  return 'shortTerm';
}

function buildAssetSortKey(asset: Asset, currentUserIdentity: string) {
  const ownerRank = isAssetOwnedByCurrentUser(asset, currentUserIdentity) ? 1 : 2;
  const bucket = getAssetSortBucket(asset);
  const ownerBucketRank = String(ownerRank).padStart(2, '0');
  const bucketRank = String(ASSET_SORT_BUCKET_ORDER[bucket]).padStart(2, '0');
  const name = asset.name.trim().toLowerCase();
  const owner = asset.owner.trim().toLowerCase();
  const ticker = (asset.ticker || '').trim().toLowerCase();
  const id = asset.id.trim().toLowerCase();

  return `${ownerBucketRank}:${bucketRank}:${name}:${owner}:${ticker}:${id}`;
}

function isAssetOwnedByCurrentUser(asset: Asset, currentUserIdentity: string) {
  const normalizedOwner = normalizePersonKey(asset.owner);
  const normalizedIdentity = normalizePersonKey(currentUserIdentity);

  if (!normalizedOwner || !normalizedIdentity) return false;
  if (normalizedOwner === normalizedIdentity) return true;

  const ownerTokens = new Set(normalizedOwner.split(' ').filter(Boolean));
  const identityTokens = normalizedIdentity.split(' ').filter(Boolean);
  return identityTokens.some((token) => ownerTokens.has(token));
}

function getRegisteredAccountHint(asset: Asset) {
  const canonical = getCanonicalAssetClass(asset.assetClass).trim().toLowerCase();
  const combinedText = [asset.assetClass, asset.name, asset.holdingPlatform].filter(Boolean).join(' ').toLowerCase();

  if (canonical === 'tfsa' || combinedText.includes('tfsa')) return 'tfsa';
  if (canonical === 'rrsp' || combinedText.includes('rrsp')) return 'rrsp';
  if (canonical === 'fhsa' || combinedText.includes('fhsa')) return 'fhsa';
  return null;
}

function normalizePersonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/@.*/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function getAssetIcon(assetClass: string) {
  const normalized = assetClass.toLowerCase();
  if (normalized.includes('real estate') || normalized.includes('property')) return <Building2 className="h-4 w-4" />;
  if (normalized.includes('equity') || normalized.includes('stock')) return <LineChart className="h-4 w-4" />;
  if (normalized.includes('bank') || normalized.includes('cash') || normalized.includes('account')) return <Landmark className="h-4 w-4" />;
  if (normalized.includes('gold')) return <Gem className="h-4 w-4" />;
  if (normalized.includes('credit')) return <WalletCards className="h-4 w-4" />;
  if (normalized.includes('fd') || normalized.includes('pf') || normalized.includes('nps')) return <PiggyBank className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
}

function usesTickerPricing(asset: Asset) {
  return asset.autoUpdate && !['Gold', 'Cash', 'PF/NPS/FD', 'TFSA/RRSP/FHSA', 'Real Estate', 'Other', 'Credit Card'].includes(asset.assetClass);
}

function isConnectedUpstoxCloudAsset(asset: Asset) {
  return Boolean(asset.sourceManaged && asset.connectedProvider === 'upstox');
}

function isLivePricingAsset(asset: Asset) {
  return asset.autoUpdate || isConnectedUpstoxCloudAsset(asset);
}

function getPricingModeLabel(asset: Asset) {
  return isLivePricingAsset(asset) ? 'Live price enabled' : 'Manual pricing';
}

function showsTickerManagement(asset: Asset) {
  return asset.autoUpdate && (isGoldAsset(asset) || Boolean(asset.ticker) || usesTickerPricing(asset));
}

function isGoldAsset(asset: Asset) {
  return asset.assetClass === 'Gold';
}

function shouldDisplayTicker(asset: Asset) {
  return !isGoldAsset(asset);
}

function getPricingActionLabel(asset: Asset) {
  if (isGoldAsset(asset)) return 'Price settings';
  return asset.ticker ? 'Edit ticker' : 'Add ticker';
}

function getPreviousClose(asset: Asset) {
  const candidate = (asset as Asset & { previousClose?: number }).previousClose;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function getStatusColor(val: number) {
  return val >= 0 ? 'text-emerald-600' : 'text-red-600';
}

function isDebtAssetDisplay(asset: Asset) {
  if (!isDebtAssetClass(asset.assetClass)) return false;
  return getCurrentTotal(asset) < 0 || getInvestmentTotal(asset) < 0;
}

function getCanonicalAssetClass(assetClass: string) {
  const normalized = assetClass.trim().toLowerCase();
  if (normalized === 'equity' || normalized === 'stock' || normalized === 'stocks') return 'Stocks';
  if (normalized === 'mutual fund' || normalized === 'mutual funds') return 'Mutual Funds';
  if (normalized === 'bank account inr' || normalized === 'bank account' || normalized === 'cash') return assetClass.trim() === 'Cash' ? 'Cash' : 'Bank Account INR';
  if (normalized === 'tfsa') return 'TFSA';
  if (normalized === 'rrsp') return 'RRSP';
  if (normalized === 'fhsa') return 'FHSA';
  if (normalized === 'tfsa/rrsp/fhsa') return 'TFSA/RRSP/FHSA';
  if (normalized === 'pf') return 'PF';
  if (normalized === 'ppf') return 'PPF';
  if (normalized === 'fd') return 'FD';
  if (normalized === 'nps') return 'NPS';
  if (normalized === 'credit card') return 'Credit Card';
  return assetClass;
}

function isFilterableColumn(columnId: string): columnId is FilterColumnId {
  return ['name', 'assetClass', 'position', 'currentPrice', 'marketValue', 'performance', 'notes'].includes(columnId);
}

function isColumnFilterActive(filter: FilterState[FilterColumnId]) {
  return filter.selected.length > 0 || filter.min.trim() !== '' || filter.max.trim() !== '';
}

function ColumnFilterMenu({
  columnId,
  filter,
  options,
  onClose,
  onClear,
  onSearchChange,
  onSelectedChange,
  onRangeChange,
}: {
  columnId: FilterColumnId;
  filter: FilterState[FilterColumnId];
  options: string[];
  onClose: () => void;
  onClear: () => void;
  onSearchChange: (value: string) => void;
  onSelectedChange: (selected: string[]) => void;
  onRangeChange: (key: 'min' | 'max', value: string) => void;
}) {
  const filteredOptions = useMemo(() => {
    const query = filter.search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [filter.search, options]);

  const toggleOption = (value: string) => {
    if (filter.selected.includes(value)) {
      onSelectedChange(filter.selected.filter((item) => item !== value));
    } else {
      onSelectedChange([...filter.selected, value]);
    }
  };

  const isNumeric = columnId === 'position' || columnId === 'currentPrice' || columnId === 'marketValue' || columnId === 'performance';

  return (
    <div
      className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Column Filter</div>
        <button type="button" onClick={onClose} className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-100">
          Done
        </button>
      </div>

      {isNumeric ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Min</label>
              <Input value={filter.min} onChange={(event) => onRangeChange('min', event.target.value)} placeholder="No minimum" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Max</label>
              <Input value={filter.max} onChange={(event) => onRangeChange('max', event.target.value)} placeholder="No maximum" />
            </div>
          </div>
          <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            Filters use the values currently shown in the table, including converted totals when a unified currency is active.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            value={filter.search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search values..."
            className="h-9"
          />
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={() => onSelectedChange(filteredOptions)}
              className="hover:text-slate-800 dark:hover:text-slate-100"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={() => onSelectedChange([])}
              className="hover:text-slate-800 dark:hover:text-slate-100"
            >
              Clear selection
            </button>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1 dark:border-slate-800">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => toggleOption(option)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                <span className="truncate">{option}</span>
                {filter.selected.includes(option) ? <Check className="h-4 w-4 text-emerald-600" /> : null}
              </button>
            )) : (
              <div className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">No matching values.</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
        <button type="button" onClick={onClear} className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-100">
          Reset filter
        </button>
        <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          <ChevronDown className="h-3 w-3" />
          Excel-style
        </div>
      </div>
    </div>
  );
}
