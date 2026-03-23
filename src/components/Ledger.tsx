import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { Asset } from '../store/db';
import {
  ColumnDef,
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
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Building2, Check, ChevronDown, Edit, Ellipsis, Filter, Gem, Landmark, LineChart, PiggyBank, RefreshCw, ShieldCheck, Trash2, WalletCards } from 'lucide-react';
import { convertAmount, formatCurrency, formatPercent, getAssetXirr, getCurrentPrice, getCurrentTotal, getGrowthTotal, getInvestmentPrice, getInvestmentTotal, isDebtAssetClass } from '../lib/portfolioMetrics';
import { getTickerRecommendation } from '../lib/api';

type LedgerCurrency = 'CAD' | 'INR' | 'USD' | 'ORIGINAL';
type FilterColumnId = 'name' | 'assetClass' | 'position' | 'currentPrice' | 'marketValue' | 'performance' | 'notes';
type FilterState = Record<FilterColumnId, { selected: string[]; search: string; min: string; max: string }>;

const TABLE_COLUMN_WIDTHS = ['30%', '10%', '10%', '12%', '12%', '10%', '10%', '6%'] as const;

const EMPTY_FILTER_STATE: FilterState = {
  name: { selected: [], search: '', min: '', max: '' },
  assetClass: { selected: [], search: '', min: '', max: '' },
  position: { selected: [], search: '', min: '', max: '' },
  currentPrice: { selected: [], search: '', min: '', max: '' },
  marketValue: { selected: [], search: '', min: '', max: '' },
  performance: { selected: [], search: '', min: '', max: '' },
  notes: { selected: [], search: '', min: '', max: '' },
};

export function Ledger({ onEditAsset }: { onEditAsset?: (asset: Asset) => void }) {
  const { assets, baseCurrency, rates, priceProviderSettings, removeAsset, duplicateAsset, refreshAsset, refreshPrices, refreshFailedPrices, isRefreshing } = usePortfolio();
  const [canadaSorting, setCanadaSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [indiaSorting, setIndiaSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [memberFilter, setMemberFilter] = useState('ALL');
  const [assetClassFilter, setAssetClassFilter] = useState('ALL');
  const [pricingFilter, setPricingFilter] = useState<'ALL' | 'AUTO' | 'MANUAL' | 'FAILED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [tickerRepairAsset, setTickerRepairAsset] = useState<Asset | undefined>(undefined);
  const [refreshingRowIds, setRefreshingRowIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [openColumnFilter, setOpenColumnFilter] = useState<FilterColumnId | null>(null);
  const [statsModal, setStatsModal] = useState<{ type: 'rows' | 'failed' | 'manual'; open: boolean }>({ type: 'rows', open: false });
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

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
    () => Array.from(new Set(assets.map((asset) => getCanonicalAssetClass(asset.assetClass)).filter(Boolean))).map(String).sort(),
    [assets],
  );
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
      const matchesClass = assetClassFilter === 'ALL' || getCanonicalAssetClass(asset.assetClass) === assetClassFilter;
      const matchesPricing =
        pricingFilter === 'ALL' ||
        (pricingFilter === 'AUTO' && asset.autoUpdate && asset.priceFetchStatus !== 'failed') ||
        (pricingFilter === 'MANUAL' && !asset.autoUpdate) ||
        (pricingFilter === 'FAILED' && asset.priceFetchStatus === 'failed');
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
      const tags = [asset.autoUpdate ? (asset.priceFetchStatus === 'failed' ? 'Needs Attention' : 'Live Price') : 'Manual Pricing'];
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
      columnHelper.accessor('name', {
        id: 'name',
        header: 'Asset',
        cell: (info) => {
          const asset = info.row.original;
          const supportsTickerPricing = showsTickerManagement(asset);
          const hasFailedPrice = supportsTickerPricing && asset.priceFetchStatus === 'failed';
          const providerForRecommendation = asset.priceProvider === 'finnhub' || asset.priceProvider === 'alphavantage' || asset.priceProvider === 'yahoo' ? asset.priceProvider : 'yahoo';
          const assetMeta = [asset.ticker || null, getCanonicalAssetClass(asset.assetClass), asset.owner].filter(Boolean).join(' • ');
          const isRowRefreshing = refreshingRowIds.includes(asset.id);

          return (
            <div className="space-y-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-slate-100 p-2 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  {getAssetIcon(asset.assetClass)}
                </div>
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
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  {asset.holdingPlatform || getCanonicalAssetClass(asset.assetClass)}
                </span>
              </div>
              {supportsTickerPricing ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTickerRepairAsset(asset)}
                      className={`inline-flex items-center gap-1 text-xs font-medium ${hasFailedPrice ? 'text-amber-600 hover:text-amber-700' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-100'}`}
                      title={hasFailedPrice ? `${asset.priceFetchMessage || 'Price fetch failed.'} ${getTickerRecommendation(asset.ticker || '', providerForRecommendation)}` : 'Check or update ticker/provider'}
                    >
                      {hasFailedPrice ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                      {asset.ticker ? 'Modify ticker' : 'Add ticker'}
                    </button>
                    {asset.ticker ? (
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

          return (
            <div className="space-y-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
              <div className={`text-xs ${isDebtAssetClass(asset.assetClass) ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                {isDebtAssetClass(asset.assetClass) ? `Balance per unit: ${formatCurrency(investmentPrice, displayCurrency)}` : `Avg: ${formatCurrency(investmentPrice, displayCurrency)}`}
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
          const hasFailedPrice = supportsTickerPricing && asset.priceFetchStatus === 'failed';
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
          return (
            <div className="space-y-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <div className={`text-sm font-semibold ${isDebtAssetClass(asset.assetClass) ? 'text-red-500' : 'text-slate-900 dark:text-slate-100'}`}>
                {formatCurrency(currentTotal, displayCurrency)}
              </div>
              <div className={`text-xs ${isDebtAssetClass(asset.assetClass) ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                {isDebtAssetClass(asset.assetClass) ? `Debt balance: ${formatCurrency(investmentTotal, displayCurrency)}` : `Cost basis: ${formatCurrency(investmentTotal, displayCurrency)}`}
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
                {isDebtAssetClass(asset.assetClass) ? 'XIRR: Not applicable for debt' : `XIRR: ${formatPercent(xirr)}`}
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
              <div className="text-xs text-slate-500 dark:text-slate-400">{asset.autoUpdate ? 'Live price enabled' : 'Manual pricing'}</div>
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
                </div>
              ) : null}
            </div>
          );
        },
      }),
    ];
  }, [baseCurrency, duplicateAsset, getConvertedValue, getDisplayCurrency, handleRefreshRow, onEditAsset, openRowMenuId, rates, refreshFailedPrices, refreshingRowIds, removeAsset]);

  const canadaAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.country === 'Canada'),
    [filteredAssets],
  );
  const indiaAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.country === 'India'),
    [filteredAssets],
  );
  const failedAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.priceFetchStatus === 'failed'),
    [filteredAssets],
  );
  const manualAssets = useMemo(
    () => filteredAssets.filter((asset) => !asset.autoUpdate),
    [filteredAssets],
  );
  const statsModalAssets = statsModal.type === 'failed'
    ? failedAssets
    : statsModal.type === 'manual'
      ? manualAssets
      : filteredAssets;
  const statsModalTitle = statsModal.type === 'failed'
    ? 'Failed Price Rows'
    : statsModal.type === 'manual'
      ? 'Manual Pricing Rows'
      : 'All Filtered Rows';
  const statsModalDescription = statsModal.type === 'failed'
    ? 'These rows currently have failed ticker refreshes. You can jump straight into fixing them.'
    : statsModal.type === 'manual'
      ? 'These rows are set to manual pricing and will not use ticker refreshes.'
      : 'These are the rows currently included by your active table filters.';

  const canadaTable = useReactTable<Asset>({
    data: canadaAssets,
    columns,
    state: {
      sorting: canadaSorting,
    },
    onSortingChange: setCanadaSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const indiaTable = useReactTable<Asset>({
    data: indiaAssets,
    columns,
    state: {
      sorting: indiaSorting,
    },
    onSortingChange: setIndiaSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-6">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">Assets</h1>
          <p className="text-lg text-slate-500 dark:text-slate-400">Manage your family's individual holdings</p>
        </div>
        <Button variant="outline" onClick={refreshPrices} disabled={isRefreshing} className="hidden sm:flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh Rates
        </Button>
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
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={assetClassFilter === 'ALL'} onClick={() => setAssetClassFilter('ALL')}>All Classes</FilterChip>
                  {assetClassOptions.map((assetClass) => (
                    <FilterChip key={assetClass} active={assetClassFilter === assetClass} onClick={() => setAssetClassFilter(assetClass)}>
                      {assetClass}
                    </FilterChip>
                  ))}
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
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatPill label="Rows" value={String(filteredAssets.length)} onClick={() => setStatsModal({ type: 'rows', open: true })} />
                <StatPill label="Failed" value={String(failedAssets.length)} onClick={() => setStatsModal({ type: 'failed', open: true })} />
                <StatPill label="Manual" value={String(manualAssets.length)} onClick={() => setStatsModal({ type: 'manual', open: true })} />
              </div>
              <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Canada assets appear first, followed by India. Use the header filter icons for Excel-style column filtering and quick value selection.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden space-y-6 md:block">
        <CountryTableSection
          title="Canada Assets"
          subtitle="Alphabetical by default. Click headers here to sort only Canada holdings."
          table={canadaTable}
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
          subtitle="Alphabetical by default. Click headers here to sort only India holdings."
          table={indiaTable}
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
        {[...canadaTable.getRowModel().rows, ...indiaTable.getRowModel().rows].length ? (
          [...canadaTable.getRowModel().rows, ...indiaTable.getRowModel().rows].map((row, index, allRows) => {
            const asset = row.original;
            const displayCurrency = getDisplayCurrency(asset);
            const investmentTotal = getConvertedValue(getInvestmentTotal(asset), asset.currency, baseCurrency);
            const investmentPrice = getConvertedValue(getInvestmentPrice(asset), asset.currency, baseCurrency);
            const currentPrice = getConvertedValue(getCurrentPrice(asset), asset.currency, baseCurrency);
            const currentTotal = getConvertedValue(getCurrentTotal(asset), asset.currency, baseCurrency);
            const growthTotal = getConvertedValue(getGrowthTotal(asset), asset.currency, baseCurrency);
            const xirr = getAssetXirr(asset, displayCurrency, rates);
            const isRowRefreshing = refreshingRowIds.includes(asset.id);

            return (
              <React.Fragment key={row.id}>
                <div className="rounded-lg border p-4 bg-white dark:bg-slate-950 dark:border-slate-800 space-y-3 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-slate-100 p-2 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                          {getAssetIcon(asset.assetClass)}
                        </div>
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
                      <Button variant="ghost" size="icon" onClick={() => onEditAsset?.(asset)}>
                        <Edit className="h-4 w-4 text-slate-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeAsset(asset.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
                    <div>
                      <div className="text-slate-500">Asset Class</div>
                      <div>{getCanonicalAssetClass(asset.assetClass)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Total Quantity</div>
                      <div>{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    </div>
                      <div>
                        <div className="text-slate-500">Ticker</div>
                        {showsTickerManagement(asset) ? (
                          <>
                            <div>{asset.ticker || '-'}</div>
                            <button
                              type="button"
                              onClick={() => setTickerRepairAsset(asset)}
                              className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${asset.priceFetchStatus === 'failed' ? 'text-amber-600' : 'text-slate-500'}`}
                              title={asset.priceFetchStatus === 'failed' ? asset.priceFetchMessage || 'Price fetch failed.' : 'Check or update ticker/provider'}
                            >
                              {asset.priceFetchStatus === 'failed' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                              {asset.ticker ? 'Modify ticker' : 'Add ticker'}
                            </button>
                            {asset.ticker ? (
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
                          <div>Manual pricing</div>
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
                      <div className="text-slate-500">{isDebtAssetClass(asset.assetClass) ? 'Debt Balance' : 'Investment Total'}</div>
                      <div className={isDebtAssetClass(asset.assetClass) ? 'font-medium text-red-500' : ''}>{formatCurrency(investmentTotal, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{isDebtAssetClass(asset.assetClass) ? 'Balance per Unit' : 'Investment Price'}</div>
                      <div className={isDebtAssetClass(asset.assetClass) ? 'font-medium text-red-500' : ''}>{formatCurrency(investmentPrice, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{isDebtAssetClass(asset.assetClass) ? 'Current Balance per Unit' : 'Current Price'}</div>
                      <div className={isDebtAssetClass(asset.assetClass) ? 'font-medium text-red-500' : ''}>{asset.currentPrice ? formatCurrency(currentPrice, displayCurrency) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{isDebtAssetClass(asset.assetClass) ? 'Current Debt' : 'Current Total'}</div>
                      <div className={`font-semibold ${isDebtAssetClass(asset.assetClass) ? 'text-red-500' : ''}`}>{formatCurrency(currentTotal, displayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Total Growth</div>
                      <div className={growthTotal >= 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-500'}>
                        {formatCurrency(growthTotal, displayCurrency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">XIRR</div>
                      <div>{isDebtAssetClass(asset.assetClass) ? 'Not applicable for debt' : formatPercent(xirr)}</div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
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
                        {asset.ticker ? ` • ${asset.ticker}` : ''}
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {asset.autoUpdate ? (
                          asset.priceFetchStatus === 'failed'
                            ? <span className="text-amber-600">{getVisiblePriceFetchMessage(asset, priceProviderSettings)}</span>
                            : 'Live price enabled'
                        ) : 'Manual pricing'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {supportsTickerPricing ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setTickerRepairAsset(asset)}>
                            {asset.ticker ? 'Modify ticker' : 'Add ticker'}
                          </Button>
                          {asset.ticker ? (
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

function CountryTableSection({
  title,
  subtitle,
  table,
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
  const tableRows = table.getRowModel().rows;

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <Table className="w-full table-fixed">
        <colgroup>
          {TABLE_COLUMN_WIDTHS.map((width) => (
            <col key={width} style={{ width }} />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-slate-950/95">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="min-w-0 border-b border-slate-200 bg-white/95 px-4 py-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-400">
                  {header.isPlaceholder ? null : (
                    <div className="relative">
                      <div
                        className={header.column.getCanSort() ? 'flex cursor-pointer select-none items-center gap-2 hover:text-slate-700 dark:hover:text-slate-300' : 'flex items-center gap-2'}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: <ArrowUp className="h-4 w-4" />,
                          desc: <ArrowDown className="h-4 w-4" />,
                        }[header.column.getIsSorted() as string] ?? (
                          header.column.getCanSort() ? <ArrowUpDown className="h-4 w-4 text-slate-300" /> : null
                        )}
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
          {tableRows.length ? (
            tableRows.map((row, index) => {
              return (
                <React.Fragment key={row.id}>
                  <TableRow className={`align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/50 ${index % 2 === 0 ? 'bg-white dark:bg-slate-950' : 'bg-slate-50/55 dark:bg-slate-900/40'}`}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="min-w-0 px-4 py-4 text-sm leading-6">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                </React.Fragment>
              );
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

function showsTickerManagement(asset: Asset) {
  return asset.autoUpdate && (Boolean(asset.ticker) || usesTickerPricing(asset));
}

function getPreviousClose(asset: Asset) {
  const candidate = (asset as Asset & { previousClose?: number }).previousClose;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function getStatusColor(val: number) {
  return val >= 0 ? 'text-emerald-600' : 'text-red-600';
}

function getCanonicalAssetClass(assetClass: string) {
  const normalized = assetClass.trim().toLowerCase();
  if (normalized === 'equity' || normalized === 'stock' || normalized === 'stocks') return 'Stocks';
  if (normalized === 'mutual fund' || normalized === 'mutual funds') return 'Mutual Funds';
  if (normalized === 'bank account inr' || normalized === 'bank account' || normalized === 'cash') return assetClass.trim() === 'Cash' ? 'Cash' : 'Bank Account INR';
  if (normalized === 'pf') return 'PF';
  if (normalized === 'ppf') return 'PPF';
  if (normalized === 'fd') return 'FD';
  if (normalized === 'nps') return 'NPS';
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
