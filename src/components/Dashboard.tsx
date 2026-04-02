import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { Card, CardContent } from './ui/card';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowUpRight,
  Eye,
  Filter,
  Globe,
  Info,
  Maximize2,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Button } from './ui/button';
import { Select } from './ui/select';
import {
  convertAmount,
  DisplayCurrency,
  formatCurrency,
  getCurrentTotal,
  getInvestmentTotal,
  getOriginalDisplayCurrency,
  getRelevantConversionRates,
} from '../lib/portfolioMetrics';
import { Asset } from '../store/db';
import { fetchHistoricalExchangeRate } from '../lib/api';

const COLORS = ['#00875A', '#00B8D9', '#FFAB00', '#FF5630', '#6554C0', '#36B37E', '#FF8B00', '#4C9AFF'];
const WATERFALL_COLORS = {
  deposits: '#00875A',
  market: '#4C9AFF',
  fx: '#FFAB00',
  current: '#172B4D',
};

type DashboardScope = 'ALL' | 'INDIA' | 'CANADA';
type CurrencySelection = 'ORIGINAL' | DisplayCurrency;
type HeroCurrencySelection = 'AUTO' | DisplayCurrency;
type ChartSlice = { name: string; value: number; currency?: DisplayCurrency };
type GrowthPoint = { key: string; label: string; invested: number; current: number; growth: number };
type SunburstInnerSlice = { name: string; value: number; fill: string };
type SunburstOuterSlice = { name: string; value: number; currency: string; fill: string };
type AttributionStep = { name: string; value: number; fill: string };
type MemberContributionRow = { name: string } & Record<string, string | number>;
type ExpandableChartKey =
  | 'country'
  | 'growth'
  | 'currency'
  | 'attribution'
  | 'memberContribution';
type ExpandedChartState = { key: ExpandableChartKey; currency: DisplayCurrency };
type ChartAnalytics = {
  subtitleLabel: string;
  countryData: ChartSlice[];
  countryLegend: Array<ChartSlice & { color: string; percentage: number }>;
  growthData: GrowthPoint[];
  currencySunburstData: {
    inner: SunburstInnerSlice[];
    outer: SunburstOuterSlice[];
  };
  performanceAttribution: {
    currentBalance: number;
    steps: AttributionStep[];
  };
  memberContributionData: {
    classNames: string[];
    rows: MemberContributionRow[];
  };
};

export function Dashboard() {
  const { assets, rates, refreshPrices, isRefreshing, refreshQueue } = usePortfolio();
  const [scope, setScope] = useState<DashboardScope>('ALL');
  const [memberFilter, setMemberFilter] = useState('ALL');
  const [currencySelection, setCurrencySelection] = useState<CurrencySelection>('ORIGINAL');
  const [heroCurrencySelection, setHeroCurrencySelection] = useState<HeroCurrencySelection>('AUTO');
  const [fxTrendCopy, setFxTrendCopy] = useState<Record<string, string>>({});
  const [expandedChart, setExpandedChart] = useState<ExpandedChartState | null>(null);
  const [growthWindowMonths, setGrowthWindowMonths] = useState(6);

  const scopeAssets = useMemo(() => {
    if (scope === 'INDIA') return assets.filter((asset) => asset.country === 'India');
    if (scope === 'CANADA') return assets.filter((asset) => asset.country === 'Canada');
    return assets;
  }, [assets, scope]);

  const members = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.owner).filter(Boolean))).map(String).sort(),
    [assets],
  );

  const memberChipOptions = useMemo(() => {
    const ownerOne = members[0] || '';
    const ownerTwo = members[1] || '';

    return [
      { value: ownerOne || 'OWNER_ONE', label: ownerOne || 'Owner 1', disabled: !ownerOne },
      { value: ownerTwo || 'OWNER_TWO', label: ownerTwo || 'Owner 2', disabled: !ownerTwo },
      { value: 'ALL', label: 'Both', disabled: false },
    ];
  }, [members]);

  useEffect(() => {
    if (memberFilter !== 'ALL' && !members.includes(memberFilter)) {
      setMemberFilter('ALL');
    }
  }, [memberFilter, members]);

  const filteredAssets = useMemo(
    () => (memberFilter === 'ALL' ? scopeAssets : scopeAssets.filter((asset) => asset.owner === memberFilter)),
    [memberFilter, scopeAssets],
  );

  const summaryCurrencies: DisplayCurrency[] = useMemo(() => {
    if (currencySelection !== 'ORIGINAL') return [currencySelection];

    return Array.from(new Set(filteredAssets.map((asset) => getOriginalDisplayCurrency(asset)))) as DisplayCurrency[];
  }, [currencySelection, filteredAssets]);

  const defaultHeroCurrency: DisplayCurrency = useMemo(() => {
    if (currencySelection !== 'ORIGINAL') return currencySelection;
    if (scope === 'INDIA') return 'INR';
    return 'CAD';
  }, [currencySelection, scope]);
  const heroCurrency: DisplayCurrency = heroCurrencySelection === 'AUTO' ? defaultHeroCurrency : heroCurrencySelection;
  const chartCurrencies = useMemo<DisplayCurrency[]>(
    () => (currencySelection === 'ORIGINAL' ? summaryCurrencies : [currencySelection]),
    [currencySelection, summaryCurrencies],
  );

  const getConvertedValue = React.useCallback(
    (amount: number, assetCurrency: string, currency: DisplayCurrency) => convertAmount(amount, assetCurrency, currency, rates),
    [rates],
  );

  const getStats = React.useCallback(
    (currency: DisplayCurrency, selectedAssets: Asset[]) => {
      const invested = selectedAssets.reduce(
        (sum, asset) => sum + getConvertedValue(getInvestmentTotal(asset), asset.currency, currency),
        0,
      );
      const current = selectedAssets.reduce(
        (sum, asset) => sum + getConvertedValue(getCurrentTotal(asset), asset.currency, currency),
        0,
      );
      const todayChange = selectedAssets.reduce((sum, asset) => {
        const previousClose = getPreviousClose(asset);
        if (previousClose == null || asset.currentPrice == null) return sum;
        return sum + getConvertedValue((asset.currentPrice - previousClose) * asset.quantity, asset.currency, currency);
      }, 0);
      const returns = current - invested;
      const retPct = invested > 0 ? (returns / invested) * 100 : 0;

      return { invested, current, todayChange, returns, retPct };
    },
    [getConvertedValue],
  );

  const getStatsForSelection = React.useCallback(
    (currency: DisplayCurrency, selectedAssets: Asset[]) => {
      if (currencySelection !== 'ORIGINAL') return getStats(currency, selectedAssets);
      const relevantAssets = selectedAssets.filter((asset) => getOriginalDisplayCurrency(asset) === currency);
      return getStats(currency, relevantAssets);
    },
    [currencySelection, getStats],
  );

  const heroStats = useMemo(() => getStats(heroCurrency, filteredAssets), [filteredAssets, getStats, heroCurrency]);

  const summaryCards = useMemo(
    () =>
      summaryCurrencies.map((currency) => {
        const stats = getStatsForSelection(currency, filteredAssets);
        const cardTitle =
          currencySelection === 'ORIGINAL'
            ? scope === 'ALL'
              ? `${currency === 'INR' ? 'India' : 'Canada'} Holdings`
              : `${scope === 'INDIA' ? 'India' : 'Canada'} Holdings`
            : `${scope === 'ALL' ? 'All Holdings' : scope === 'INDIA' ? 'India Holdings' : 'Canada Holdings'} in ${currency}`;

        return { currency, stats, cardTitle };
      }),
    [currencySelection, filteredAssets, getStatsForSelection, scope, summaryCurrencies],
  );

  const ownerStats = useMemo(() => {
    const owners = Array.from(new Set(filteredAssets.map((asset) => asset.owner)));
    return owners.map((owner) => {
      const ownerAssets = filteredAssets.filter((asset) => asset.owner === owner);
      return {
        name: String(owner),
        assetCount: ownerAssets.length,
        valuesByCurrency: summaryCurrencies.map((currency) => ({
          currency,
          ...getStatsForSelection(currency, ownerAssets),
        })),
      };
    });
  }, [filteredAssets, getStatsForSelection, summaryCurrencies]);

  const maxGrowthWindowMonths = useMemo(() => {
    const referenceDates = filteredAssets
      .map((asset) => {
        const purchaseDate = asset.purchaseDate ? new Date(asset.purchaseDate) : null;
        if (purchaseDate && !Number.isNaN(purchaseDate.getTime())) return purchaseDate;
        const updatedDate = asset.lastUpdated ? new Date(asset.lastUpdated) : null;
        return updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate : null;
      })
      .filter((value): value is Date => value instanceof Date);

    if (referenceDates.length === 0) return 6;

    const firstDate = new Date(Math.min(...referenceDates.map((date) => date.getTime())));
    return Math.max(differenceInCalendarMonths(new Date(), new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)) + 1, 1);
  }, [filteredAssets]);

  useEffect(() => {
    setGrowthWindowMonths((current) => Math.min(Math.max(current, 1), maxGrowthWindowMonths));
  }, [maxGrowthWindowMonths]);

  const chartDataByCurrency = useMemo<Record<DisplayCurrency, ChartAnalytics>>(() => {
    const buildGrowthData = (selectedAssets: Asset[], currency: DisplayCurrency) => {
      const monthBuckets = selectedAssets.reduce((acc, asset) => {
        const referenceDate = asset.purchaseDate ? new Date(asset.purchaseDate) : null;
        const date = referenceDate && !Number.isNaN(referenceDate.getTime())
          ? referenceDate
          : asset.lastUpdated
            ? new Date(asset.lastUpdated)
            : null;
        if (!date || Number.isNaN(date.getTime())) return acc;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        if (!acc[key]) {
          acc[key] = { key, label, invested: 0, current: 0 };
        }
        acc[key].invested += getConvertedValue(getInvestmentTotal(asset), asset.currency, currency);
        acc[key].current += getConvertedValue(getCurrentTotal(asset), asset.currency, currency);
        return acc;
      }, {} as Record<string, { key: string; label: string; invested: number; current: number }>);

      const referenceDates = selectedAssets
        .map((asset) => {
          const purchaseDate = asset.purchaseDate ? new Date(asset.purchaseDate) : null;
          if (purchaseDate && !Number.isNaN(purchaseDate.getTime())) return purchaseDate;
          const updatedDate = asset.lastUpdated ? new Date(asset.lastUpdated) : null;
          return updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate : null;
        })
        .filter((value): value is Date => value instanceof Date);

      if (referenceDates.length === 0) return [];

      const firstDate = new Date(Math.min(...referenceDates.map((date) => date.getTime())));
      const startMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      const endMonth = new Date();
      const monthCount = differenceInCalendarMonths(endMonth, startMonth) + 1;
      const boundedWindow = Math.min(Math.max(growthWindowMonths, 1), monthCount);
      const visibleStartIndex = Math.max(monthCount - boundedWindow, 0);

      return Array.from({ length: monthCount }, (_, index) => {
        const monthDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + index, 1);
        const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
        const label = monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return monthBuckets[key] || { key, label, invested: 0, current: 0 };
      })
        .slice(visibleStartIndex)
        .map(
          (entry): GrowthPoint => ({
            ...entry,
            growth: entry.current - entry.invested,
          }),
        );
    };

    return Object.fromEntries(
      chartCurrencies.map((currency) => {
        const selectedAssets =
          currencySelection === 'ORIGINAL'
            ? filteredAssets.filter((asset) => getOriginalDisplayCurrency(asset) === currency)
            : filteredAssets;

        const countryData = Object.entries(
          selectedAssets.reduce((acc, asset) => {
            const convertedValue = convertAmount(getCurrentTotal(asset), asset.currency, currency, rates);
            const key = asset.country;
            if (!acc[key]) {
              acc[key] = { value: 0, currency };
            }
            acc[key].value += convertedValue;
            return acc;
          }, {} as Record<string, { value: number; currency: DisplayCurrency }>),
        )
          .map((entry): ChartSlice => {
            const [name, payload] = entry as [string, { value: number; currency: DisplayCurrency }];
            return { name, value: Number(payload.value), currency: payload.currency };
          })
          .sort((a, b) => b.value - a.value);

        const countryTotal = countryData.reduce((sum, entry) => sum + entry.value, 0);
        const countryLegend = countryData.map((item, index) => ({
          ...item,
          color: COLORS[(index + 2) % COLORS.length],
          percentage: countryTotal > 0
            ? (item.value / countryTotal) * 100
            : 0,
        }));

        const totalsByCurrency = selectedAssets.reduce((acc, asset) => {
          const originalCurrency = getOriginalDisplayCurrency(asset);
          const classKey = asset.assetClass || 'Unknown';
          const value = convertAmount(getCurrentTotal(asset), asset.currency, currency, rates);

          if (!acc[originalCurrency]) {
            acc[originalCurrency] = { total: 0, classes: {} as Record<string, number> };
          }
          acc[originalCurrency].total += value;
          acc[originalCurrency].classes[classKey] = (acc[originalCurrency].classes[classKey] || 0) + value;
          return acc;
        }, {} as Record<string, { total: number; classes: Record<string, number> }>);

        const currencySunburstData = {
          inner: Object.entries(totalsByCurrency).map((entry, index): SunburstInnerSlice => {
            const [name, payload] = entry as [string, { total: number; classes: Record<string, number> }];
            return {
              name,
              value: payload.total,
              fill: COLORS[index % COLORS.length],
            };
          }),
          outer: Object.entries(totalsByCurrency).flatMap((entry, currencyIndex): SunburstOuterSlice[] => {
            const [originalCurrency, payload] = entry as [string, { total: number; classes: Record<string, number> }];
            return Object.entries(payload.classes)
              .sort((a, b) => b[1] - a[1])
              .map(([name, value], classIndex): SunburstOuterSlice => ({
                name: `${originalCurrency} · ${name}`,
                value: Number(value),
                currency: originalCurrency,
                fill: COLORS[(currencyIndex + classIndex + 1) % COLORS.length],
              }));
          }),
        };

        const newDeposits = selectedAssets.reduce(
          (sum, asset) => sum + getConvertedValue(getInvestmentTotal(asset), asset.currency, currency),
          0,
        );
        const currentBalance = selectedAssets.reduce(
          (sum, asset) => sum + getConvertedValue(getCurrentTotal(asset), asset.currency, currency),
          0,
        );
        const fxImpact = selectedAssets.reduce((sum, asset) => {
          if (!rates || !asset.originalCurrency || !asset.exchangeRate || asset.originalCurrency === asset.currency) return sum;
          const currentFxRate = convertAmount(1, asset.originalCurrency, asset.currency, rates as Record<string, number>);
          const originalInvested = asset.costBasis / asset.exchangeRate;
          const impactInStoredCurrency = originalInvested * (currentFxRate - asset.exchangeRate);
          return sum + getConvertedValue(impactInStoredCurrency, asset.currency, currency);
        }, 0);
        const marketGains = currentBalance - newDeposits - fxImpact;

        const classNames: string[] = Array.from(
          new Set(selectedAssets.map((asset) => String(asset.assetClass || 'Unknown'))),
        );
        const owners: string[] = Array.from(
          new Set(selectedAssets.map((asset) => String(asset.owner)).filter(Boolean)),
        );
        const memberContributionData = {
          classNames,
          rows: owners.map((owner) => {
            const ownerAssets = selectedAssets.filter((asset) => asset.owner === owner);
            const row: MemberContributionRow = { name: owner };
            classNames.forEach((assetClass) => {
              row[assetClass] = ownerAssets
                .filter((asset) => (asset.assetClass || 'Unknown') === assetClass)
                .reduce((sum, asset) => sum + getConvertedValue(getCurrentTotal(asset), asset.currency, currency), 0);
            });
            return row;
          }),
        };

        return [
          currency,
          {
            subtitleLabel: currencySelection === 'ORIGINAL' ? `${currency} original values` : currency,
            countryData,
            countryLegend,
            growthData: buildGrowthData(selectedAssets, currency),
            currencySunburstData,
            performanceAttribution: {
              currentBalance,
              steps: [
                { name: 'New Deposits', value: newDeposits, fill: WATERFALL_COLORS.deposits },
                { name: 'Market Gains/Losses', value: marketGains, fill: marketGains >= 0 ? WATERFALL_COLORS.market : '#DE350B' },
                { name: 'FX Impact', value: fxImpact, fill: fxImpact >= 0 ? WATERFALL_COLORS.fx : '#FF8B00' },
                { name: 'Current Balance', value: currentBalance, fill: WATERFALL_COLORS.current },
              ],
            },
            memberContributionData,
          } satisfies ChartAnalytics,
        ] as const;
      }),
    ) as Record<DisplayCurrency, ChartAnalytics>;
  }, [chartCurrencies, currencySelection, filteredAssets, getConvertedValue, growthWindowMonths, rates]);

  const scopeCopy = {
    ALL: 'All filters apply first, then dashboard totals and charts are shown in the selected currency logic.',
    INDIA: 'Only India holdings are considered before charting and conversion.',
    CANADA: 'Only Canada holdings are considered before charting and conversion.',
  } as const;

  const relevantRates = useMemo(() => getRelevantConversionRates(rates), [rates]);

  useEffect(() => {
    if (!rates) {
      setFxTrendCopy({});
      return;
    }

    let isCancelled = false;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 7);
    const formattedDate = targetDate.toISOString().slice(0, 10);
    const pairs = [
      { label: 'USD → INR', from: 'USD', to: 'INR' },
      { label: 'USD → CAD', from: 'USD', to: 'CAD' },
      { label: 'CAD → INR', from: 'CAD', to: 'INR' },
      { label: 'CAD → USD', from: 'CAD', to: 'USD' },
      { label: 'INR → USD', from: 'INR', to: 'USD' },
      { label: 'INR → CAD', from: 'INR', to: 'CAD' },
    ] as const;

    void Promise.all(
      pairs.map(async (pair) => {
        const priorRate = await fetchHistoricalExchangeRate(formattedDate, pair.from, pair.to);
        const currentRate = convertAmount(1, pair.from, pair.to, rates);
        if (!priorRate || !Number.isFinite(currentRate)) {
          return [pair.label, '7-day trend unavailable right now.'] as const;
        }
        const deltaPct = ((currentRate - priorRate) / priorRate) * 100;
        const direction = deltaPct >= 0 ? 'up' : 'down';
        return [pair.label, `${pair.from} is ${direction} ${Math.abs(deltaPct).toFixed(2)}% against ${pair.to} this week.`] as const;
      }),
    ).then((entries) => {
      if (!isCancelled) setFxTrendCopy(Object.fromEntries(entries));
    });

    return () => {
      isCancelled = true;
    };
  }, [rates]);

  const renderCountryChart = (currency: DisplayCurrency, expanded = false) => {
    const analytics = chartDataByCurrency[currency];
    return analytics.countryData.length === 0 ? (
      <EmptyChartState message="No assets to summarize yet" />
    ) : (
      <div className={`grid gap-4 ${expanded ? 'xl:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)]' : 'md:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)]'}`}>
        <div className={expanded ? 'h-[360px]' : 'h-[240px]'}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={analytics.countryData} cx="50%" cy="50%" innerRadius={expanded ? 86 : 58} outerRadius={expanded ? 132 : 86} paddingAngle={4} dataKey="value">
                {analytics.countryData.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[(index + 2) % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, _name: string, item: { payload?: ChartSlice }) => formatCurrency(value, item?.payload?.currency || currency)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          {analytics.countryLegend.map((item) => (
            <div key={item.name}>
              <LegendRow label={item.name} value={`${item.percentage.toFixed(1)}%`} color={item.color} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderGrowthChart = (currency: DisplayCurrency, expanded = false) => {
    const analytics = chartDataByCurrency[currency];
    return analytics.growthData.length === 0 ? (
      <EmptyChartState message="Add purchase dates to unlock this chart." />
    ) : (
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Last
            <select
              value={String(growthWindowMonths)}
              onChange={(event) => setGrowthWindowMonths(Number(event.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium tracking-normal text-slate-900 outline-none transition-colors focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {Array.from({ length: maxGrowthWindowMonths }, (_, index) => {
                const value = index + 1;
                return (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'month' : 'months'}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className={expanded ? 'h-[420px]' : 'h-[280px]'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.growthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => compactNumber(value)} tickLine={false} axisLine={false} width={56} />
              <Tooltip formatter={(value: number) => formatCurrency(value, currency)} />
              <Bar dataKey="current" fill="#172B4D" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderCurrencyChart = (currency: DisplayCurrency, expanded = false) => {
    const analytics = chartDataByCurrency[currency];
    return analytics.currencySunburstData.inner.length === 0 ? (
      <EmptyChartState message="No currency allocation to show yet." />
    ) : (
      <div className={`grid gap-4 ${expanded ? 'xl:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)]' : 'md:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)]'}`}>
        <div className={expanded ? 'h-[400px]' : 'h-[280px]'}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={analytics.currencySunburstData.inner} dataKey="value" cx="50%" cy="50%" innerRadius={expanded ? 46 : 30} outerRadius={expanded ? 92 : 62}>
                {analytics.currencySunburstData.inner.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Pie data={analytics.currencySunburstData.outer} dataKey="value" cx="50%" cy="50%" innerRadius={expanded ? 102 : 70} outerRadius={expanded ? 156 : 108}>
                {analytics.currencySunburstData.outer.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, _name: string, item: { payload?: SunburstInnerSlice | SunburstOuterSlice }) => {
                const payload = item?.payload;
                const payloadCurrency = payload && 'currency' in payload && payload.currency ? payload.currency as DisplayCurrency : payload && 'name' in payload ? (payload.name as DisplayCurrency) : currency;
                return formatCurrency(value, payloadCurrency);
              }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          {analytics.currencySunburstData.inner.map((item) => (
            <div key={item.name}>
              <LegendRow label={item.name} value={formatCurrency(item.value, item.name as DisplayCurrency)} color={item.fill} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAttributionChart = (currency: DisplayCurrency, expanded = false) => {
    const analytics = chartDataByCurrency[currency];
    return (
    <div className="space-y-4">
      <div className={expanded ? 'h-[400px]' : 'h-[260px]'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={analytics.performanceAttribution.steps} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(value) => compactNumber(value)} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={(value: number) => formatCurrency(value, currency)} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {analytics.performanceAttribution.steps.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
              <LabelList dataKey="value" position="top" formatter={(value: number) => compactCurrency(value, currency)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CompactAttribution label="Deposits" value={analytics.performanceAttribution.steps[0].value} currency={currency} />
        <CompactAttribution label="Current Balance" value={analytics.performanceAttribution.currentBalance} currency={currency} />
      </div>
    </div>
  );
  };

  const renderMemberContributionChart = (currency: DisplayCurrency, expanded = false) => {
    const analytics = chartDataByCurrency[currency];
    return analytics.memberContributionData.rows.length === 0 ? (
      <EmptyChartState message="No member data available." />
    ) : (
      <div className={expanded ? 'h-[420px]' : 'h-[320px]'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={analytics.memberContributionData.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(value) => compactNumber(value)} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={(value: number) => formatCurrency(value, currency)} />
            {analytics.memberContributionData.classNames.map((assetClass, index) => (
              <Bar key={assetClass} dataKey={assetClass} stackId="members" fill={COLORS[index % COLORS.length]} radius={index === analytics.memberContributionData.classNames.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const expandedChartMeta = expandedChart
    ? {
        country: {
          title: 'By Country',
          subtitle: `Current allocation in ${chartDataByCurrency[expandedChart.currency].subtitleLabel}`,
          content: renderCountryChart(expandedChart.currency, true),
        },
        growth: {
          title: 'Growth over time',
          subtitle: `Month-by-month view for the last ${growthWindowMonths} ${growthWindowMonths === 1 ? 'month' : 'months'} in ${chartDataByCurrency[expandedChart.currency].subtitleLabel}`,
          content: renderGrowthChart(expandedChart.currency, true),
        },
        currency: {
          title: 'Multi-Currency Allocation',
          subtitle: `Nested allocation view in ${chartDataByCurrency[expandedChart.currency].subtitleLabel}`,
          content: renderCurrencyChart(expandedChart.currency, true),
        },
        attribution: {
          title: 'Performance Attribution',
          subtitle: 'Why did family wealth change based on current holdings?',
          content: renderAttributionChart(expandedChart.currency, true),
        },
        memberContribution: {
          title: 'Member Contribution',
          subtitle: `Stacked by asset class in ${chartDataByCurrency[expandedChart.currency].subtitleLabel}`,
          content: renderMemberContributionChart(expandedChart.currency, true),
        },
      }[expandedChart.key]
    : null;

  return (
    <div className="space-y-6">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-lg text-slate-500 dark:text-slate-400">Your family's wealth at a glance</p>
        </div>
        <Button variant="outline" onClick={refreshPrices} disabled={isRefreshing} className="w-full sm:w-auto">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh Rates
        </Button>
      </div>
      {refreshQueue.pending > 0 && refreshQueue.nextRunAt ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          {refreshQueue.pending} U.S. stock row{refreshQueue.pending === 1 ? '' : 's'} are queued for the next Massive window at {new Date(refreshQueue.nextRunAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}.
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-3xl border-none bg-[radial-gradient(circle_at_top_left,_rgba(0,135,90,0.22),_transparent_40%),linear-gradient(135deg,_#052e2b,_#0f3d37_55%,_#0b5b46)] text-white shadow-[0_30px_90px_rgba(5,46,43,0.28)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(61,255,191,0.18),_transparent_42%),linear-gradient(135deg,_#020617,_#052e2b_55%,_#0b5b46)]">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100/85">Total Combined Family Wealth</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ['AUTO', `Auto (${defaultHeroCurrency})`],
                  ['CAD', 'CAD'],
                  ['USD', 'USD'],
                  ['INR', 'INR'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setHeroCurrencySelection(value)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${
                      heroCurrencySelection === value
                        ? 'bg-white text-emerald-900'
                        : 'bg-white/10 text-emerald-50 hover:bg-white/20'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <h2 className="text-4xl font-black tracking-tight sm:text-5xl">{formatCurrency(heroStats.current, heroCurrency)}</h2>
              <p className="max-w-2xl text-sm text-emerald-50/85">
                {heroCurrencySelection === 'AUTO'
                  ? `Hero total is normalized into ${heroCurrency} so you can see the full family wealth in one number. Country and member filters are already applied.`
                  : `Hero total is being shown in ${heroCurrency}. This switch only changes the banner and leaves the rest of the dashboard as-is.`}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HeroMetric label="Invested" value={formatCurrency(heroStats.invested, heroCurrency)} />
              <HeroMetric label="Today's Change" value={formatCurrency(heroStats.todayChange, heroCurrency)} tone={heroStats.todayChange >= 0 ? 'positive' : 'negative'} />
              <HeroMetric label="Returns" value={`${formatCurrency(heroStats.returns, heroCurrency)} (${heroStats.retPct >= 0 ? '+' : ''}${heroStats.retPct.toFixed(2)}%)`} tone={heroStats.returns >= 0 ? 'positive' : 'negative'} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-none bg-gradient-to-r from-emerald-50 via-white to-cyan-50 shadow-sm dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            <Filter className="h-4 w-4" />
            Dashboard Filters
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr_1fr]">
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">View</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ['ALL', 'All Holdings'],
                  ['INDIA', 'India Only'],
                  ['CANADA', 'Canada Only'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setScope(value)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${scope === value ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{scopeCopy[scope]}</p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Members</p>
              <div className="flex flex-wrap gap-2">
                {memberChipOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMemberFilter(option.value)}
                    disabled={option.disabled}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      memberFilter === option.value
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    } ${option.disabled ? 'cursor-not-allowed opacity-50 hover:bg-white dark:hover:bg-slate-900' : ''}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Currency</p>
              <Select value={currencySelection} onChange={(event) => setCurrencySelection(event.target.value as CurrencySelection)}>
                <option value="ORIGINAL">Original</option>
                <option value="USD">USD</option>
                <option value="INR">INR</option>
                <option value="CAD">CAD</option>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {currencySelection === 'ORIGINAL'
                  ? 'Original keeps India holdings in INR and Canada holdings in CAD. Canada USD positions are converted into CAD first.'
                  : `All values are shown in ${currencySelection}.`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.72fr)_320px]">
        <div className="space-y-6">
          <div className={`grid gap-4 ${summaryCards.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
            {summaryCards.map(({ currency, stats, cardTitle }) => (
              <Card key={currency} className="overflow-hidden rounded-2xl border-none shadow-sm">
                <CardContent className="p-0">
                  <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{currency}</p>
                        <h3 className="truncate text-lg font-bold text-slate-900 dark:text-white">{cardTitle}</h3>
                      </div>
                      <div className="rounded-full bg-slate-100 p-2 dark:bg-slate-800">
                        <Wallet className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 p-4 sm:grid-cols-2">
                    <CompactMetricTile label="Invested" value={formatCurrency(stats.invested, currency)} icon={<Wallet className="h-4 w-4 text-slate-400" />} tone={stats.invested < 0 ? 'negative' : 'neutral'} />
                    <CompactMetricTile label="Current" value={formatCurrency(stats.current, currency)} icon={<TrendingUp className="h-4 w-4 text-slate-400" />} tone={stats.current < 0 ? 'negative' : 'neutral'} />
                    <CompactMetricTile label="Today's Change" value={formatCurrency(stats.todayChange, currency)} icon={<ArrowUpRight className="h-4 w-4 text-slate-400" />} tone={stats.todayChange >= 0 ? 'positive' : 'negative'} />
                    <CompactMetricTile label="Returns" value={`${formatCurrency(stats.returns, currency)} · ${stats.retPct >= 0 ? '+' : ''}${stats.retPct.toFixed(2)}%`} icon={<TrendingUp className="h-4 w-4 text-slate-400" />} tone={stats.returns >= 0 ? 'positive' : 'negative'} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {currencySelection === 'ORIGINAL' ? (
            <div className="space-y-6">
              <div className={`grid gap-6 ${chartCurrencies.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {chartCurrencies.map((currency) => {
                  const analytics = chartDataByCurrency[currency];
                  return (
                    <div key={`country-${currency}`}>
                      <ChartCard
                        title="By Country"
                        subtitle={`Current allocation in ${analytics.subtitleLabel}`}
                        onExpand={() => setExpandedChart({ key: 'country', currency })}
                      >
                        {renderCountryChart(currency)}
                      </ChartCard>
                    </div>
                  );
                })}
              </div>

              <div className={`grid gap-6 ${chartCurrencies.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {chartCurrencies.map((currency) => {
                  const analytics = chartDataByCurrency[currency];
                  return (
                    <div key={`growth-${currency}`}>
                      <ChartCard
                        title="Growth over time"
                        subtitle={`Month-by-month view for the last ${growthWindowMonths} ${growthWindowMonths === 1 ? 'month' : 'months'} in ${analytics.subtitleLabel}`}
                        onExpand={() => setExpandedChart({ key: 'growth', currency })}
                      >
                        {renderGrowthChart(currency)}
                      </ChartCard>
                    </div>
                  );
                })}
              </div>

              <div className={`grid gap-6 ${chartCurrencies.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {chartCurrencies.map((currency) => {
                  const analytics = chartDataByCurrency[currency];
                  return (
                    <div key={`currency-${currency}`}>
                      <ChartCard
                        title="Multi-Currency Allocation"
                        subtitle={`Nested allocation view in ${analytics.subtitleLabel}`}
                        onExpand={() => setExpandedChart({ key: 'currency', currency })}
                      >
                        {renderCurrencyChart(currency)}
                      </ChartCard>
                    </div>
                  );
                })}
              </div>

              <div className={`grid gap-6 ${chartCurrencies.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {chartCurrencies.map((currency) => (
                  <div key={`attribution-${currency}`}>
                    <ChartCard
                      title="Performance Attribution"
                      subtitle="Why did family wealth change based on current holdings?"
                      onExpand={() => setExpandedChart({ key: 'attribution', currency })}
                    >
                      {renderAttributionChart(currency)}
                    </ChartCard>
                  </div>
                ))}
              </div>

              <div className={`grid gap-6 ${chartCurrencies.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {chartCurrencies.map((currency) => {
                  const analytics = chartDataByCurrency[currency];
                  return (
                    <div key={`memberContribution-${currency}`}>
                      <ChartCard
                        title="Member Contribution"
                        subtitle={`Stacked by asset class in ${analytics.subtitleLabel}`}
                        onExpand={() => setExpandedChart({ key: 'memberContribution', currency })}
                      >
                        {renderMemberContributionChart(currency)}
                      </ChartCard>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            chartCurrencies.map((currency) => {
              const analytics = chartDataByCurrency[currency];

              return (
                <div key={`charts-${currency}`} className="space-y-6">
                  <div className="grid gap-6">
                    <ChartCard title="By Country" subtitle={`Current allocation in ${analytics.subtitleLabel}`} onExpand={() => setExpandedChart({ key: 'country', currency })}>
                      {renderCountryChart(currency)}
                    </ChartCard>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <ChartCard title="Growth over time" subtitle={`Month-by-month view for the last ${growthWindowMonths} ${growthWindowMonths === 1 ? 'month' : 'months'} in ${analytics.subtitleLabel}`} onExpand={() => setExpandedChart({ key: 'growth', currency })}>
                      {renderGrowthChart(currency)}
                    </ChartCard>

                    <ChartCard title="Multi-Currency Allocation" subtitle={`Nested allocation view in ${analytics.subtitleLabel}`} onExpand={() => setExpandedChart({ key: 'currency', currency })}>
                      {renderCurrencyChart(currency)}
                    </ChartCard>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <ChartCard title="Performance Attribution" subtitle="Why did family wealth change based on current holdings?" onExpand={() => setExpandedChart({ key: 'attribution', currency })}>
                      {renderAttributionChart(currency)}
                    </ChartCard>

                    <ChartCard title="Member Contribution" subtitle={`Stacked by asset class in ${analytics.subtitleLabel}`} onExpand={() => setExpandedChart({ key: 'memberContribution', currency })}>
                      {renderMemberContributionChart(currency)}
                    </ChartCard>
                  </div>
                </div>
              );
            })
          )}

          <div className="grid gap-6 md:grid-cols-2">
            {ownerStats.map((owner) => (
              <Card key={owner.name} className="rounded-2xl border-none shadow-sm">
                <CardContent className="p-6">
                  <div className="mb-6 flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00875A] text-xl font-bold text-white">
                      {owner.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xl font-bold">{owner.name}</h3>
                      <p className="text-sm text-slate-500">{owner.assetCount} assets</p>
                    </div>
                    <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => setMemberFilter(owner.name)} title={`View only ${owner.name}`}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-4">
                    {owner.valuesByCurrency.map((stats) => (
                      <div key={stats.currency} className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{stats.currency}</div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="mb-1 text-sm text-slate-500">Invested</p>
                            <p className={`text-xl font-semibold ${stats.invested < 0 ? 'text-red-500' : ''}`}>{formatCurrency(stats.invested, stats.currency)}</p>
                          </div>
                          <div>
                            <p className="mb-1 text-sm text-slate-500">Current</p>
                            <p className={`text-xl font-semibold ${stats.current < 0 ? 'text-red-500' : ''}`}>{formatCurrency(stats.current, stats.currency)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <Card className="rounded-2xl border-none shadow-sm">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Live FX Rates</div>
                <Info className="h-4 w-4 text-slate-400" />
              </div>
              <div className="space-y-3">
                {relevantRates.map((rate) => (
                  <div key={rate.label} className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900" title={fxTrendCopy[rate.label] || 'Loading 7-day trend...'}>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{rate.label}</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{rate.value.toFixed(4)}</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{fxTrendCopy[rate.label] || 'Loading 7-day trend...'}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-sm">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Globe className="h-5 w-5 text-slate-600" />
                <h3 className="text-lg font-semibold">Quick Geography</h3>
              </div>
              <div className="space-y-3">
                {chartCurrencies.map((currency) => (
                  <div key={`geo-${currency}`} className="space-y-3">
                    {chartCurrencies.length > 1 ? (
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {currency}
                      </div>
                    ) : null}
                    {chartDataByCurrency[currency].countryLegend.map((item) => (
                      <div key={`${currency}-${item.name}`} className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="font-medium text-slate-700 dark:text-slate-200">{item.name}</span>
                          </div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.percentage.toFixed(1)}%</span>
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">{formatCurrency(item.value, item.currency || currency)}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-sm">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-slate-600" />
                <h3 className="text-lg font-semibold">Attribution Notes</h3>
              </div>
              <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                  Saving vs investing is separated in the performance attribution chart so you can see how much growth came from contributions versus market movement.
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                  FX impact is strongest on holdings that store both original currency and purchase exchange rate, especially cross-border Canada USD assets.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(expandedChartMeta)} onOpenChange={(open) => !open && setExpandedChart(null)}>
        {expandedChartMeta ? (
          <>
            <DialogHeader className="pr-10">
              <DialogTitle className="text-2xl">{expandedChartMeta.title}</DialogTitle>
              <DialogDescription>{expandedChartMeta.subtitle}</DialogDescription>
            </DialogHeader>
            <div className="max-h-[72vh] overflow-y-auto pr-1">
              {expandedChartMeta.content}
            </div>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-100' : tone === 'negative' ? 'text-rose-100' : 'text-white';

  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100/80">{label}</div>
      <div className={`mt-2 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function CompactMetricTile({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-500'
        : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="min-w-0 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        {icon}
      </div>
      <p className={`break-words text-lg font-semibold tracking-tight ${toneClass}`}>{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  onExpand,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onExpand?: () => void;
}) {
  return (
    <Card className="rounded-2xl border-none shadow-sm">
      <CardContent className="p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
          {onExpand ? (
            <Button type="button" variant="outline" size="icon" className="shrink-0 rounded-full" onClick={onExpand} title={`Expand ${title}`}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function LegendRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-3 dark:bg-slate-900">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function EmptyChartState({ message }: { message: string }) {
  return <div className="flex min-h-[220px] items-center justify-center text-center text-slate-500">{message}</div>;
}

function CompactAttribution({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: DisplayCurrency;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-2 text-lg font-semibold ${value >= 0 ? 'text-slate-900 dark:text-slate-100' : 'text-red-500'}`}>
        {formatCurrency(value, currency)}
      </div>
    </div>
  );
}

function compactNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}

function compactCurrency(value: number, currency: DisplayCurrency) {
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  const symbol = currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : '₹';
  if (abs >= 1_000_000) return `${prefix}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${symbol}${(abs / 1_000).toFixed(0)}k`;
  return `${prefix}${symbol}${abs.toFixed(0)}`;
}

function differenceInCalendarMonths(laterDate: Date, earlierDate: Date) {
  return (laterDate.getFullYear() - earlierDate.getFullYear()) * 12 + (laterDate.getMonth() - earlierDate.getMonth());
}

function getPreviousClose(asset: Asset) {
  const candidate = (asset as Asset & { previousClose?: number }).previousClose;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
