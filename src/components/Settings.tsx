import React, { useRef } from 'react';
import Papa from 'papaparse';
import { usePortfolio } from '../store/PortfolioContext';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Download, Upload, Trash2, Users, PieChart, TrendingUp, Plus, RefreshCw, UserPlus, Shield, UserX } from 'lucide-react';
import { GoogleDriveSync } from './GoogleDriveSync';
import { Asset, AssetClassDef, getAllAssetClasses, getAllAssets, getSetting } from '../store/db';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { DEFAULT_PRICE_PROVIDER_SETTINGS, PriceProvider, PriceProviderSettings, fetchHistoricalExchangeRate } from '../lib/api';
import { AddAssetClassModal } from './AddAssetClassModal';
import { AssetClassLogo } from '../lib/assetClassBranding';
import { SYSTEM_ASSET_CLASSES } from '../lib/systemAssetClasses';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { DEFAULT_BROKER_CONNECTIONS, DEFAULT_USER_PROVIDER_OVERRIDES, type BrokerConnectionConfig, type UserBrokerConnections, type UserProviderOverrides } from '../store/userPreferences';

export type SettingsSection = 'manage-members' | 'price-providers' | 'asset-classes-overview' | 'price-updates' | 'data-management' | 'cloud-sync';
type SettingsTab = 'access' | 'pricing' | 'structure' | 'data';

function getTabForSection(section?: SettingsSection): SettingsTab {
  switch (section) {
    case 'manage-members':
      return 'access';
    case 'price-providers':
    case 'price-updates':
      return 'pricing';
    case 'asset-classes-overview':
      return 'structure';
    case 'data-management':
    case 'cloud-sync':
      return 'data';
    default:
      return 'pricing';
  }
}

export function Settings({ initialSection }: { initialSection?: SettingsSection } = {}) {
  const showDeveloperMigrationTools =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
  const {
    importAssets,
    importAssetClasses,
    replaceCloudPortfolio,
    removeAssetClass,
    clearAllAssets,
    clearAllAssetClasses,
    assets,
    assetClasses,
    refreshPrices,
    isRefreshing,
    rates,
    baseCurrency,
    sharedPriceProviderSettings,
    priceProviderSettings,
    updatePriceProviderSettings,
    userProviderOverrides,
    updateUserProviderOverrides,
    userBrokerConnections,
    updateUserBrokerConnections,
    members,
    inviteMember,
    removeMember,
    currentUserRole,
    setImportProgress,
  } = usePortfolio();
  const indiaFileRef = useRef<HTMLInputElement>(null);
  const canadaFileRef = useRef<HTMLInputElement>(null);
  const classesFileRef = useRef<HTMLInputElement>(null);

  const [confirmDialog, setConfirmDialog] = React.useState<{ open: boolean, title: string, description: string, onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} });
  const [alertDialog, setAlertDialog] = React.useState<{ open: boolean, title: string, description: string }>({ open: false, title: '', description: '' });
  const [isAssetClassModalOpen, setIsAssetClassModalOpen] = React.useState(false);
  const [classToEdit, setClassToEdit] = React.useState<AssetClassDef | null>(null);
  const [sharedProviderForm, setSharedProviderForm] = React.useState<PriceProviderSettings>(DEFAULT_PRICE_PROVIDER_SETTINGS);
  const [overrideForm, setOverrideForm] = React.useState<UserProviderOverrides>(DEFAULT_USER_PROVIDER_OVERRIDES);
  const [brokerForm, setBrokerForm] = React.useState<UserBrokerConnections>(DEFAULT_BROKER_CONNECTIONS);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<'owner' | 'partner'>('partner');
  const [migrationPreview, setMigrationPreview] = React.useState<{
    loading: boolean;
    localAssets: Asset[];
    localClasses: AssetClassDef[];
    localBaseCurrency: 'CAD' | 'INR' | 'USD' | 'ORIGINAL' | null;
    localPriceProviderSettings: PriceProviderSettings | null;
  }>({
    loading: true,
    localAssets: [],
    localClasses: [],
    localBaseCurrency: null,
    localPriceProviderSettings: null,
  });
  const [replaceConfirmText, setReplaceConfirmText] = React.useState('');
  const [isReplacingCloud, setIsReplacingCloud] = React.useState(false);
  const [migrationSource, setMigrationSource] = React.useState<'screen' | 'local'>('screen');
  const [activeTab, setActiveTab] = React.useState<SettingsTab>(() => getTabForSection(initialSection));
  const [personalPricingMode, setPersonalPricingMode] = React.useState<'system' | 'override'>('system');
  const [brokerPricingMode, setBrokerPricingMode] = React.useState<'system' | 'override'>('system');
  const [showAdvancedProviderRouting, setShowAdvancedProviderRouting] = React.useState(false);

  React.useEffect(() => {
    setSharedProviderForm(sharedPriceProviderSettings);
  }, [sharedPriceProviderSettings]);

  React.useEffect(() => {
    setOverrideForm(userProviderOverrides);
  }, [userProviderOverrides]);

  React.useEffect(() => {
    setBrokerForm(userBrokerConnections);
  }, [userBrokerConnections]);

  React.useEffect(() => {
    setPersonalPricingMode(userProviderOverrides.enabled ? 'override' : 'system');
  }, [userProviderOverrides.enabled]);

  React.useEffect(() => {
    setBrokerPricingMode((userBrokerConnections.upstox.enabled || userBrokerConnections.groww.enabled) ? 'override' : 'system');
  }, [userBrokerConnections]);

  React.useEffect(() => {
    void loadMigrationPreview();
  }, []);

  React.useEffect(() => {
    if (!initialSection) return;
    setActiveTab(getTabForSection(initialSection));
  }, [initialSection]);

  const downloadIndiaTemplate = () => {
    const csv = "Purchase Date,Owner,Holding Name,Ticker,Type,Holding Platform,Comments,Qty,Average Purchase Price,Purchase Value,Current Price,Current Value";
    downloadCSV(csv, "india_holdings_template.csv");
  };

  const downloadIndiaSampleTemplate = () => {
    const rows = buildSampleHoldingsRows('India', assets);
    const csv = Papa.unparse(rows, {
      columns: ['Purchase Date', 'Owner', 'Holding Name', 'Ticker', 'Type', 'Holding Platform', 'Comments', 'Qty', 'Average Purchase Price', 'Purchase Value', 'Current Price', 'Current Value'],
    });
    downloadCSV(csv, "india_holdings_template_sample_data.csv");
  };

  const downloadCanadaTemplate = () => {
    const csv = "Purchase Date,Owner,Holding Name,Ticker,Type,Holding Platform,Comments,Qty,Avg Purchase Price,Purchase Value,Current Price,Current Value,US or CAD";
    downloadCSV(csv, "canada_holdings_template.csv");
  };

  const downloadCanadaSampleTemplate = () => {
    const rows = buildSampleHoldingsRows('Canada', assets);
    const csv = Papa.unparse(rows, {
      columns: ['Purchase Date', 'Owner', 'Holding Name', 'Ticker', 'Type', 'Holding Platform', 'Comments', 'Qty', 'Avg Purchase Price', 'Purchase Value', 'Current Price', 'Current Value', 'US or CAD'],
    });
    downloadCSV(csv, "canada_holdings_template_sample_data.csv");
  };

  const downloadClassesTemplate = () => {
    const knownClasses = new Map<string, { country: string; name: string; imageUrl: string }>();

    [...SYSTEM_ASSET_CLASSES, ...assetClasses].forEach((assetClass) => {
      const key = `${assetClass.country}::${assetClass.name}`.toLowerCase();
      if (!knownClasses.has(key)) {
        knownClasses.set(key, {
          country: assetClass.country,
          name: assetClass.name,
          imageUrl: assetClass.imageUrl || '',
        });
      }
    });

    assets.forEach((asset) => {
      const key = `${asset.country}::${asset.assetClass}`.toLowerCase();
      if (!knownClasses.has(key)) {
        knownClasses.set(key, {
          country: asset.country,
          name: asset.assetClass,
          imageUrl: '',
        });
      }
    });

    const rows = Array.from(knownClasses.values())
      .sort((left, right) =>
        left.country.localeCompare(right.country) || left.name.localeCompare(right.name),
      )
      .map((assetClass) => ({
        'Country': assetClass.country,
        'Asset Class Name': assetClass.name,
        'Image URL': assetClass.imageUrl,
      }));

    const csv = Papa.unparse(rows, {
      columns: ['Country', 'Asset Class Name', 'Image URL'],
    });
    downloadCSV(csv, "asset_classes_template.csv");
  };

  const exportHoldings = (targetCountry: 'India' | 'Canada') => {
    const countryAssets = assets.filter((asset) => asset.country === targetCountry);
    if (countryAssets.length === 0) {
      setAlertDialog({
        open: true,
        title: 'Nothing To Export',
        description: `There are no ${targetCountry} holdings available to export right now.`,
      });
      return;
    }

    const rows = countryAssets.map((asset) => {
      const quantity = Number.isFinite(asset.quantity) ? asset.quantity : 0;
      const averagePurchasePrice = quantity > 0 ? asset.costBasis / quantity : 0;
      const currentPrice = typeof asset.currentPrice === 'number' && Number.isFinite(asset.currentPrice) ? asset.currentPrice : 0;
      const currentValue = currentPrice > 0 && quantity > 0 ? currentPrice * quantity : 0;

      if (targetCountry === 'India') {
        return {
          'Purchase Date': asset.purchaseDate || '',
          'Owner': asset.owner || '',
          'Holding Name': asset.name || '',
          'Ticker': asset.ticker || '',
          'Type': asset.assetClass || '',
          'Holding Platform': asset.holdingPlatform || '',
          'Comments': asset.comments || '',
          'Qty': quantity || '',
          'Average Purchase Price': averagePurchasePrice || '',
          'Purchase Value': asset.costBasis || '',
          'Current Price': currentPrice || '',
          'Current Value': currentValue || '',
        };
      }

      return {
        'Purchase Date': asset.purchaseDate || '',
        'Owner': asset.owner || '',
        'Holding Name': asset.name || '',
        'Ticker': asset.ticker || '',
        'Type': asset.assetClass || '',
        'Holding Platform': asset.holdingPlatform || '',
        'Comments': asset.comments || '',
        'Qty': quantity || '',
        'Avg Purchase Price': averagePurchasePrice || '',
        'Purchase Value': asset.costBasis || '',
        'Current Price': currentPrice || '',
        'Current Value': currentValue || '',
        'US or CAD': asset.originalCurrency === 'USD' ? 'USD' : 'CAD',
      };
    });

    const csv = Papa.unparse(rows, { columns: Object.keys(rows[0]) });
    downloadCSV(
      csv,
      targetCountry === 'India' ? 'india_holdings_export.csv' : 'canada_holdings_export.csv',
    );
  };

  const downloadCSV = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const buildSampleHoldingsRows = (targetCountry: 'India' | 'Canada', sourceAssets: Asset[]) => {
    const countryAssets = sourceAssets.filter((asset) => asset.country === targetCountry);
    const seedAssets = countryAssets.length > 0
      ? countryAssets.slice(0, Math.min(countryAssets.length, 8))
      : buildFallbackSampleAssets(targetCountry);

    return seedAssets.map((asset, index) => {
      const sample = buildSampleHoldingRow(asset, targetCountry, index);
      if (targetCountry === 'India') {
        return {
          'Purchase Date': sample.purchaseDate,
          'Owner': sample.owner,
          'Holding Name': sample.name,
          'Ticker': sample.ticker,
          'Type': sample.assetClass,
          'Holding Platform': sample.holdingPlatform,
          'Comments': sample.comments,
          'Qty': sample.quantity,
          'Average Purchase Price': sample.averagePurchasePrice,
          'Purchase Value': sample.purchaseValue,
          'Current Price': sample.currentPrice,
          'Current Value': sample.currentValue,
        };
      }

      return {
        'Purchase Date': sample.purchaseDate,
        'Owner': sample.owner,
        'Holding Name': sample.name,
        'Ticker': sample.ticker,
        'Type': sample.assetClass,
        'Holding Platform': sample.holdingPlatform,
        'Comments': sample.comments,
        'Qty': sample.quantity,
        'Avg Purchase Price': sample.averagePurchasePrice,
        'Purchase Value': sample.purchaseValue,
        'Current Price': sample.currentPrice,
        'Current Value': sample.currentValue,
        'US or CAD': sample.originalCurrency,
      };
    });
  };

  const buildFallbackSampleAssets = (targetCountry: 'India' | 'Canada'): Asset[] => {
    const fallbackClasses = [...SYSTEM_ASSET_CLASSES, ...assetClasses]
      .filter((assetClass) => assetClass.country === targetCountry)
      .slice(0, 6);

    return fallbackClasses.map((assetClass, index) => ({
      id: `sample-${targetCountry}-${index}`,
      name: `${assetClass.name} Sample ${index + 1}`,
      ticker: assetClass.name.toLowerCase().includes('stock')
        ? (targetCountry === 'India' ? `NSE:SAMPLE${index + 1}` : `NASDAQ:SAMPLE${index + 1}`)
        : '',
      quantity: 1,
      costBasis: 0,
      currency: targetCountry === 'India' ? 'INR' : 'CAD',
      owner: index % 2 === 0 ? 'Shubham Gupta' : 'Mayuri Garg',
      country: targetCountry,
      assetClass: assetClass.name,
      autoUpdate: false,
      holdingPlatform: targetCountry === 'India' ? 'Sample Platform' : 'Sample Brokerage',
      comments: '',
      originalCurrency: targetCountry === 'Canada' ? 'CAD' : undefined,
    }));
  };

  const buildSampleHoldingRow = (asset: Asset, targetCountry: 'India' | 'Canada', index: number) => {
    const isLiability = asset.assetClass.trim().toLowerCase() === 'credit card';
    const quantity = isLiability ? 1 : Number(((index + 2) * 7.5).toFixed(2));
    const averagePurchasePrice = Number((getSampleBasePrice(asset, targetCountry, index) * (isLiability ? 1 : 1)).toFixed(2));
    const currentPrice = Number((averagePurchasePrice * (1 + getSampleDrift(index, isLiability))).toFixed(2));
    const purchaseValue = Number((quantity * averagePurchasePrice).toFixed(2));
    const currentValue = Number((quantity * currentPrice).toFixed(2));

    return {
      purchaseDate: `2024-${String((index % 9) + 1).padStart(2, '0')}-15`,
      owner: asset.owner || (index % 2 === 0 ? 'Shubham Gupta' : 'Mayuri Garg'),
      name: asset.name || `${asset.assetClass} Sample ${index + 1}`,
      ticker: asset.ticker || '',
      assetClass: asset.assetClass || 'Other',
      holdingPlatform: asset.holdingPlatform || (targetCountry === 'India' ? 'Groww' : 'Wealthsimple'),
      comments: asset.comments ? 'Sample import row based on existing structure' : '',
      quantity,
      averagePurchasePrice,
      purchaseValue,
      currentPrice,
      currentValue,
      originalCurrency: targetCountry === 'Canada' ? (asset.originalCurrency === 'USD' ? 'USD' : 'CAD') : undefined,
    };
  };

  const getSampleBasePrice = (asset: Asset, targetCountry: 'India' | 'Canada', index: number) => {
    const canonical = asset.assetClass.trim().toLowerCase();
    if (canonical.includes('gold')) return targetCountry === 'India' ? 6450 + index * 120 : 118 + index * 7;
    if (canonical.includes('credit')) return targetCountry === 'India' ? 12000 + index * 2500 : 1800 + index * 350;
    if (canonical.includes('cash') || canonical.includes('bank')) return targetCountry === 'India' ? 1 : 1;
    if (canonical === 'pf' || canonical === 'ppf' || canonical === 'fd' || canonical === 'nps') return targetCountry === 'India' ? 102 + index * 11 : 55 + index * 6;
    if (canonical.includes('real estate')) return targetCountry === 'India' ? 2500000 + index * 150000 : 450000 + index * 25000;
    if (canonical.includes('mutual')) return targetCountry === 'India' ? 82 + index * 9 : 24 + index * 4;
    return targetCountry === 'India' ? 135 + index * 18 : 42 + index * 6;
  };

  const getSampleDrift = (index: number, isLiability: boolean) => {
    const drift = [0.14, -0.06, 0.09, 0.03, -0.02, 0.11, 0.05, -0.04][index % 8];
    return isLiability ? Math.abs(drift) : drift;
  };

  const parseCurrencyStr = (val: any) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    const strVal = String(val);
    const parsed = parseFloat(strVal.replace(/[^0-9.-]+/g, ""));
    return isNaN(parsed) ? 0 : parsed;
  };

  const parseDateValue = (val: any) => {
    if (!val) return '';
    const raw = String(val).trim();
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return raw;
  };

  const getRowValue = (row: Record<string, any>, keys: string[]) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return row[key];
      }
    }
    return '';
  };

  const isHeaderLikeValue = (value: string, labels: string[]) => {
    const normalizedValue = value.trim().toLowerCase();
    return labels.some((label) => normalizedValue === label.trim().toLowerCase());
  };

  const isHeaderRow = (row: Record<string, any>) => {
    const owner = String(getRowValue(row, ['Owner', 'Member', 'owner']) || '');
    const holdingName = String(getRowValue(row, ['Holding Name', '\uFEFFHolding Name', 'Asset Name', 'Name', 'name']) || '');
    const type = String(getRowValue(row, ['Type', 'Asset Class', 'assetClass']) || '');
    const ticker = String(getRowValue(row, ['Ticker', 'Google Finance', 'Google Finance Name', 'ticker']) || '');

    return (
      isHeaderLikeValue(owner, ['Owner', 'Member']) ||
      isHeaderLikeValue(holdingName, ['Holding Name', 'Asset Name', 'Name']) ||
      isHeaderLikeValue(type, ['Type', 'Asset Class']) ||
      isHeaderLikeValue(ticker, ['Ticker', 'Google Finance', 'Google Finance Name'])
    );
  };

  const mapTicker = (googleTicker: string) => {
    if (!googleTicker) return '';
    return String(googleTicker).trim();
  };

  const resolvePurchaseTriangle = (qtyValue: number, avgPurchasePriceValue: number, purchaseValueValue: number) => {
    let qty = qtyValue;
    let avgPurchasePrice = avgPurchasePriceValue;
    let purchaseValue = purchaseValueValue;

    if (!qty && purchaseValue > 0 && avgPurchasePrice > 0) {
      qty = purchaseValue / avgPurchasePrice;
    }
    if (!avgPurchasePrice && purchaseValue > 0 && qty > 0) {
      avgPurchasePrice = purchaseValue / qty;
    }
    if (!purchaseValue && qty > 0 && avgPurchasePrice > 0) {
      purchaseValue = qty * avgPurchasePrice;
    }

    return { qty, avgPurchasePrice, purchaseValue };
  };

  const resolveCurrentTriangle = ({
    qty,
    currentPriceValue,
    currentValueValue,
  }: {
    qty: number;
    currentPriceValue: number;
    currentValueValue: number;
  }) => {
    let currentPrice = currentPriceValue;
    let currentValue = currentValueValue;

    if (!currentPrice && qty > 0 && currentValue > 0) {
      currentPrice = currentValue / qty;
    }
    if (!currentValue && qty > 0 && currentPrice > 0) {
      currentValue = qty * currentPrice;
    }

    return { currentPrice, currentValue };
  };

  const handleHoldingsUpload = (event: React.ChangeEvent<HTMLInputElement>, targetCountry: 'India' | 'Canada') => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      error: (error) => {
        setImportProgress({ visible: false, current: 0, total: 0, message: '' });
        setAlertDialog({
          open: true,
          title: 'Import Failed',
          description: `Could not parse the CSV file: ${error.message}`,
        });
      },
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          const parsedAssets: Array<Asset | null> = [];
          setImportProgress({ visible: true, current: 0, total: rows.length, message: `Parsing ${targetCountry} holdings...` });

          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            if (isHeaderRow(row)) {
              setImportProgress({ visible: true, current: index + 1, total: rows.length, message: `Parsing ${targetCountry} holdings...` });
              continue;
            }

            const holdingName = getRowValue(row, ['Holding Name', '\uFEFFHolding Name', 'Asset Name', 'Name']);
            const isCustomFormat = Boolean(holdingName || getRowValue(row, ['Type', 'Qty', 'Owner', 'Ticker', 'Google Finance', 'Google Finance Name']));
          
            if (isCustomFormat) {
              const owner = String(getRowValue(row, ['Owner', 'Member']) || '').trim();
              const name = String(holdingName || '').trim();
              const assetClass = String(getRowValue(row, ['Type', 'Asset Class']) || '').trim();
              if (!owner || !name || !assetClass) {
                parsedAssets.push(null);
                setImportProgress({ visible: true, current: index + 1, total: rows.length, message: `Parsing ${targetCountry} holdings...` });
                continue;
              }

              const qtyFromSheet = parseCurrencyStr(getRowValue(row, ['Qty', 'Quantity']));
              const purchasePriceFromSheet = parseCurrencyStr(getRowValue(row, ['Average Purchase Price', 'Avg Purchase Price', 'Purchase Price']));
              const purchaseValueFromSheet = parseCurrencyStr(getRowValue(row, ['Purchase Value', 'Cost', 'Total Cost']));
              const { qty, purchaseValue } = resolvePurchaseTriangle(qtyFromSheet, purchasePriceFromSheet, purchaseValueFromSheet);

              let currency: Asset['currency'] = 'USD';
              let country: Asset['country'] = targetCountry;
              let originalCurrency: Asset['originalCurrency'] = undefined;
              let exchangeRate: number | undefined = undefined;

              const purchaseDateStr = parseDateValue(getRowValue(row, ['Purchase Date', '\uFEFFPurchase Date', 'Avg Purchase Date', '\uFEFFAvg Purchase Date']));
              const ticker = mapTicker(getRowValue(row, ['Ticker', 'Google Finance Name', 'Google Finance']));
              const currentPriceFromSheet = parseCurrencyStr(getRowValue(row, ['Current Price', 'Price']));
              const currentValueFromSheet = parseCurrencyStr(getRowValue(row, ['Current Value', 'Market Value']));
              const resolvedCurrent = resolveCurrentTriangle({
                qty,
                currentPriceValue: currentPriceFromSheet,
                currentValueValue: currentValueFromSheet,
              });

              let costBasis = purchaseValue;
              let currentPrice = resolvedCurrent.currentPrice;

              if (targetCountry === 'Canada') {
                const currencyFlag = String(getRowValue(row, ['US or CAD', 'Currency Flag']) || 'CAD').trim().toUpperCase();
                const isUS = currencyFlag === 'US' || currencyFlag === 'USD';
                currency = 'CAD';
                
                if (isUS) {
                  originalCurrency = 'USD';
                  let rate = 1;
                  if (purchaseDateStr) {
                    const dateObj = new Date(purchaseDateStr);
                    if (!isNaN(dateObj.getTime())) {
                      const formattedDate = dateObj.toISOString().split('T')[0];
                      const historicalRate = await fetchHistoricalExchangeRate(formattedDate, 'USD', 'CAD');
                      if (historicalRate) {
                        rate = historicalRate;
                      } else if (rates && rates['CAD']) {
                        rate = rates['CAD'];
                      }
                    } else if (rates && rates['CAD']) {
                      rate = rates['CAD'];
                    }
                  } else if (rates && rates['CAD']) {
                    rate = rates['CAD'];
                  }
                  exchangeRate = rate;
                  costBasis = costBasis * rate;
                  
                  if (currentPrice > 0 && rates && rates['CAD']) {
                    currentPrice = currentPrice * rates['CAD'];
                  }
                }
              } else if (targetCountry === 'India') {
                currency = 'INR';
                costBasis = purchaseValue;
              }

              parsedAssets.push({
                id: crypto.randomUUID(),
                name,
                ticker: ticker,
                quantity: qty,
                costBasis: costBasis,
                currency: currency,
                owner,
                country: country,
                assetClass: assetClass,
                autoUpdate: Boolean(ticker),
                currentPrice: currentPrice,
                lastUpdated: Date.now(),
                purchaseDate: purchaseDateStr,
                originalCurrency: originalCurrency,
                exchangeRate: exchangeRate,
                holdingPlatform: String(getRowValue(row, ['Holding Platform', 'Platform']) || '').trim() || undefined,
                comments: String(getRowValue(row, ['Comments', 'Comment', 'Notes']) || '').trim() || undefined,
              });
            } else {
              const owner = String(getRowValue(row, ['Owner', 'owner']) || '').trim();
              const name = String(getRowValue(row, ['Asset Name', 'name']) || '').trim();
              const assetClass = String(getRowValue(row, ['Asset Class', 'assetClass']) || '').trim();
              if (!owner || !name || !assetClass) {
                parsedAssets.push(null);
                setImportProgress({ visible: true, current: index + 1, total: rows.length, message: `Parsing ${targetCountry} holdings...` });
                continue;
              }

              parsedAssets.push({
                id: crypto.randomUUID(),
                name,
                ticker: String(getRowValue(row, ['Ticker', 'ticker']) || '').trim(),
                quantity: parseFloat(getRowValue(row, ['Quantity', 'quantity']) || '0'),
                costBasis: parseFloat(getRowValue(row, ['Cost', 'cost']) || '0'),
                currency: (getRowValue(row, ['Currency', 'currency']) || 'USD') as Asset['currency'],
                owner,
                country: (getRowValue(row, ['Country', 'country']) || 'India') as Asset['country'],
                assetClass,
                autoUpdate: getRowValue(row, ['Auto Update', 'autoUpdate']) === 'true',
                currentPrice: parseFloat(getRowValue(row, ['Current Price', 'currentPrice']) || '0'),
                lastUpdated: Date.now(),
                holdingPlatform: String(getRowValue(row, ['Holding Platform', 'Platform', 'platform']) || '').trim() || undefined,
                comments: String(getRowValue(row, ['Comments', 'Comment', 'Notes', 'comments']) || '').trim() || undefined,
              });
            }

            setImportProgress({ visible: true, current: index + 1, total: rows.length, message: `Parsing ${targetCountry} holdings...` });
          }

          const newAssets = parsedAssets.filter((asset): asset is Asset => asset !== null);

          if (newAssets.length === 0) {
            setImportProgress({ visible: false, current: 0, total: 0, message: '' });
            setAlertDialog({ open: true, title: 'Nothing Imported', description: `No valid ${targetCountry} holdings were found in that file. Please check the template headers and required fields.` });
            return;
          }

          setImportProgress({ visible: true, current: newAssets.length, total: newAssets.length, message: `Saving ${targetCountry} holdings to Firebase...` });
          await importAssets([...assets, ...newAssets]);
          setImportProgress({ visible: false, current: 0, total: 0, message: '' });
          if (targetCountry === 'India' && indiaFileRef.current) indiaFileRef.current.value = '';
          if (targetCountry === 'Canada' && canadaFileRef.current) canadaFileRef.current.value = '';
          setAlertDialog({ open: true, title: 'Import Successful', description: `Successfully imported ${newAssets.length} ${targetCountry} holdings! Prices can be refreshed afterwards.` });
        } catch (error) {
          setImportProgress({ visible: false, current: 0, total: 0, message: '' });
          setAlertDialog({
            open: true,
            title: 'Import Failed',
            description: error instanceof Error ? error.message : `Failed to import ${targetCountry} holdings.`,
          });
        }
      },
    });
  };

  const handleClassesUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      error: (error) => {
        setImportProgress({ visible: false, current: 0, total: 0, message: '' });
        setAlertDialog({
          open: true,
          title: 'Import Failed',
          description: `Could not parse the CSV file: ${error.message}`,
        });
      },
      complete: async (results) => {
        try {
          setImportProgress({ visible: true, current: 0, total: results.data.length, message: 'Parsing asset classes...' });
          const newClasses: AssetClassDef[] = results.data
            .filter((row: any) => !isHeaderLikeValue(String(row['Asset Class Name'] || row['Name'] || ''), ['Asset Class Name', 'Name']))
            .map((row: any) => ({
              id: crypto.randomUUID(),
              country: row['Country'] || 'India',
              name: row['Asset Class Name'] || row['Name'] || 'Unknown',
              image: row['Image URL'] || row['Image'] || '',
            }));

          if (newClasses.length === 0) {
            setImportProgress({ visible: false, current: 0, total: 0, message: '' });
            setAlertDialog({ open: true, title: 'Nothing Imported', description: 'No valid asset classes were found in that file.' });
            return;
          }

          setImportProgress({ visible: true, current: newClasses.length, total: newClasses.length, message: 'Saving asset classes to Firebase...' });
          await importAssetClasses([...assetClasses, ...newClasses]);
          setImportProgress({ visible: false, current: 0, total: 0, message: '' });
          if (classesFileRef.current) classesFileRef.current.value = '';
          setAlertDialog({ open: true, title: 'Import Successful', description: `Successfully imported ${newClasses.length} asset classes!` });
        } catch (error) {
          setImportProgress({ visible: false, current: 0, total: 0, message: '' });
          setAlertDialog({
            open: true,
            title: 'Import Failed',
            description: error instanceof Error ? error.message : 'Failed to import asset classes.',
          });
        }
      },
    });
  };

  const owners = Array.from(new Set(assets.map(a => a.owner).filter(Boolean))).map(String);
  
  const allAssetClasses = [...SYSTEM_ASSET_CLASSES, ...assetClasses];

  // Group asset classes by country
  const assetClassesByCountry = allAssetClasses.reduce((acc, cls) => {
    if (!acc[cls.country]) acc[cls.country] = [];
    acc[cls.country].push(cls);
    return acc;
  }, {} as Record<string, AssetClassDef[]>);

  // Find used classes that aren't in assetClasses (legacy or imported without class def)
  const usedClassNames = Array.from(new Set(assets.map(a => a.assetClass).filter(Boolean)));
  const definedClassNames = new Set(allAssetClasses.map(c => c.name));
  const undefinedUsedClasses = usedClassNames.filter(name => !definedClassNames.has(name));
  
  if (undefinedUsedClasses.length > 0) {
    if (!assetClassesByCountry['Other']) assetClassesByCountry['Other'] = [];
    undefinedUsedClasses.forEach(name => {
      assetClassesByCountry['Other'].push({ id: `temp-${name}`, country: 'Other', name });
    });
  }

  const saveSharedProviderPreferences = async () => {
    await updatePriceProviderSettings(sharedProviderForm);
    setAlertDialog({ open: true, title: 'Saved', description: 'Shared provider defaults have been updated.' });
  };

  const savePersonalProviderOverrides = async () => {
    await updateUserProviderOverrides({ ...overrideForm, enabled: true });
    setAlertDialog({ open: true, title: 'Saved', description: 'Your personal provider overrides are stored on this device.' });
  };

  const saveSystemProvidedPricing = async () => {
    await updateUserProviderOverrides({ ...overrideForm, enabled: false });
    setAlertDialog({ open: true, title: 'Using System Pricing', description: 'This device will use the shared app pricing setup.' });
  };

  const saveBrokerConnections = async () => {
    await updateUserBrokerConnections(brokerForm);
    setAlertDialog({ open: true, title: 'Saved', description: 'Broker connection details are stored on this device.' });
  };

  const saveSystemBrokerRouting = async () => {
    await updateUserBrokerConnections({
      ...brokerForm,
      upstox: { ...brokerForm.upstox, enabled: false },
      groww: { ...brokerForm.groww, enabled: false },
    });
    setAlertDialog({ open: true, title: 'Using System Routing', description: 'This device will keep using the shared/default India stock routing.' });
  };

  const handleInvite = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) return;
    await inviteMember(normalizedEmail, inviteRole);
    setInviteEmail('');
    setInviteRole('partner');
    setAlertDialog({ open: true, title: 'Member Added', description: `${normalizedEmail} can now access this shared portfolio.` });
  };

  const loadMigrationPreview = async () => {
    setMigrationPreview((current) => ({ ...current, loading: true }));
    try {
      const [localAssets, localClasses, localBaseCurrency, localProviderSettings] = await Promise.all([
        getAllAssets(),
        getAllAssetClasses(),
        getSetting<'CAD' | 'INR' | 'USD' | 'ORIGINAL'>('baseCurrency'),
        getSetting<PriceProviderSettings>('priceProviderSettings'),
      ]);

      setMigrationPreview({
        loading: false,
        localAssets,
        localClasses,
        localBaseCurrency: localBaseCurrency || null,
        localPriceProviderSettings: localProviderSettings || null,
      });
    } catch {
      setMigrationPreview({
        loading: false,
        localAssets: [],
        localClasses: [],
        localBaseCurrency: null,
        localPriceProviderSettings: null,
      });
    }
  };

  const handleReplaceCloudPortfolio = async () => {
    if (replaceConfirmText.trim() !== 'REPLACE') return;
    setIsReplacingCloud(true);
    const sourceAssets = migrationSource === 'screen' ? assets : migrationPreview.localAssets;
    const sourceAssetClasses = migrationSource === 'screen' ? assetClasses : migrationPreview.localClasses;
    const sourceBaseCurrency = migrationSource === 'screen' ? baseCurrency : migrationPreview.localBaseCurrency || undefined;
    const sourcePriceProviderSettings = migrationSource === 'screen'
      ? sharedPriceProviderSettings
      : migrationPreview.localPriceProviderSettings || undefined;
    try {
      await replaceCloudPortfolio({
        assets: sourceAssets,
        assetClasses: sourceAssetClasses,
        baseCurrency: sourceBaseCurrency,
        priceProviderSettings: sourcePriceProviderSettings,
      });
      setReplaceConfirmText('');
      setConfirmDialog({ open: false, title: '', description: '', onConfirm: () => {} });
      setAlertDialog({
        open: true,
        title: 'Cloud Replaced',
        description: `Live Firebase data now matches your ${migrationSource === 'screen' ? 'current app view' : 'browser local snapshot'}: ${sourceAssets.length} assets and ${sourceAssetClasses.length} asset classes.`,
      });
    } catch (error) {
      setAlertDialog({
        open: true,
        title: 'Replacement Failed',
        description: error instanceof Error ? error.message : 'Could not replace live Firebase data.',
      });
    } finally {
      setIsReplacingCloud(false);
    }
  };

  const updateBrokerConfig = (
    broker: keyof UserBrokerConnections,
    field: keyof BrokerConnectionConfig,
    value: string | boolean,
  ) => {
    setBrokerForm((current) => ({
      ...current,
      [broker]: {
        ...current[broker],
        [field]: value,
      },
    }));
  };

  const providerOptions: Array<{ value: PriceProvider; label: string }> = [
    { value: 'yahoo', label: 'Yahoo Finance' },
    { value: 'alphavantage', label: 'Alpha Vantage' },
    { value: 'finnhub', label: 'Finnhub' },
  ];

  const tabItems: Array<{ id: SettingsTab; label: string; description: string }> = [
    { id: 'access', label: 'Access', description: 'Members and roles' },
    { id: 'pricing', label: 'Pricing', description: 'Providers and brokers' },
    { id: 'structure', label: 'Structure', description: 'Classes and organization' },
    { id: 'data', label: 'Data', description: 'Imports, sync, migration' },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="mb-8 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">Settings</h1>
            <p className="text-lg text-slate-500 dark:text-slate-400">Configure your portfolio tracker without digging through one long page.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Members</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{members.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Assets</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{assets.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Classes</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{allAssetClasses.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Base Currency</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{baseCurrency}</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-2 md:grid-cols-4">
            {tabItems.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={isActive}
                  className={`relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-emerald-200 bg-white text-slate-950 shadow-md ring-1 ring-emerald-100 dark:border-emerald-800 dark:bg-slate-950 dark:text-white dark:ring-emerald-900/60'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/80 hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-950/60 dark:hover:text-white'
                  }`}
                >
                  {isActive && (
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-emerald-500 dark:bg-emerald-400" />
                  )}
                  <div className={`text-sm font-semibold ${isActive ? 'text-slate-950 dark:text-white' : ''}`}>{tab.label}</div>
                  <div className={`mt-1 text-xs ${isActive ? 'text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>{tab.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'access' && (
        <>
      <Card id="manage-members" className="border-none shadow-sm rounded-2xl mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            <CardTitle>Family Members</CardTitle>
          </div>
          <CardDescription>The portfolio owners tracked in this app</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {owners.length > 0 ? owners.map(owner => (
              <div key={owner} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="w-8 h-8 rounded-full bg-[#00875A] flex items-center justify-center text-white font-bold">
                  {owner.charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-slate-700 dark:text-slate-200">{owner}</span>
              </div>
            )) : (
              <p className="text-sm text-slate-500">No family members found. Import assets to see them here.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card id="member-access" className="border-none shadow-sm rounded-2xl mb-6">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              <CardTitle>Manage Members</CardTitle>
            </div>
            <CardDescription>Authorized Google accounts that can access and edit this shared Firebase portfolio.</CardDescription>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
            Your role: {currentUserRole || 'viewer'}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            {members.length > 0 ? members.map((member) => (
              <div key={member.email} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between dark:border-slate-800 dark:bg-slate-950">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">{member.email}</div>
                  <div className="text-sm text-slate-500">Role: {member.role}</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void removeMember(member.email)}
                  disabled={currentUserRole !== 'owner'}
                  className="rounded-full"
                >
                  <UserX className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>
            )) : (
              <p className="text-sm text-slate-500">No authorized members yet.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <UserPlus className="h-4 w-4" />
              Invite by Email
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <Input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="partner@example.com"
                disabled={currentUserRole !== 'owner'}
              />
              <Select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as 'owner' | 'partner')}
                disabled={currentUserRole !== 'owner'}
              >
                <option value="partner">Partner</option>
                <option value="owner">Owner</option>
              </Select>
              <Button onClick={() => void handleInvite()} disabled={currentUserRole !== 'owner' || !inviteEmail.trim()} className="rounded-full bg-[#00875A] text-white hover:bg-[#007A51]">
                Add Member
              </Button>
            </div>
            {currentUserRole !== 'owner' && (
              <p className="mt-3 text-sm text-slate-500">Only portfolio owners can change the member list.</p>
            )}
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {activeTab === 'pricing' && (
        <>
      <Card id="price-providers" className="border-none shadow-sm rounded-2xl mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            <CardTitle>Price Provider Settings</CardTitle>
          </div>
          <CardDescription>Set up each asset type in one pass. For every route, users can stay on the system setup or override with their own credentials on this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <Table className="[&_td]:py-3 [&_th]:py-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Asset Type</TableHead>
                  <TableHead>System Source</TableHead>
                  <TableHead className="w-[240px]">Choice</TableHead>
                  <TableHead>Meaning</TableHead>
                  <TableHead className="pr-5 text-right">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="pl-5">
                    <div className="font-semibold text-slate-900 dark:text-white">U.S. & Canada Stocks / ETFs</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Market-data powered prices</div>
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">Shared market-data route</TableCell>
                  <TableCell>
                    <Select
                      value={personalPricingMode}
                      onChange={(event) => setPersonalPricingMode(event.target.value as 'system' | 'override')}
                      className="min-w-[220px]"
                    >
                      <option value="system">System provided API</option>
                      <option value="override">Override with my credentials</option>
                    </Select>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {personalPricingMode === 'override'
                      ? 'Use a personal data key on this device only.'
                      : 'Use the shared route and shared quota.'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      personalPricingMode === 'override'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    }`}>
                      {personalPricingMode === 'override' ? 'Needs config' : 'System'}
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5">
                    <div className="font-semibold text-slate-900 dark:text-white">India Mutual Funds</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">No manual setup</div>
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">AMFI public feed</TableCell>
                  <TableCell>No override needed</TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">Handled automatically without user credentials.</TableCell>
                  <TableCell className="pr-5 text-right">
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Ready
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5">
                    <div className="font-semibold text-slate-900 dark:text-white">India Stocks</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Broker-backed option</div>
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">Shared/default India route</TableCell>
                  <TableCell>
                    <Select
                      value={brokerPricingMode}
                      onChange={(event) => setBrokerPricingMode(event.target.value as 'system' | 'override')}
                      className="min-w-[220px]"
                    >
                      <option value="system">System provided route</option>
                      <option value="override">Override with my credentials</option>
                    </Select>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {brokerPricingMode === 'override'
                      ? 'Use broker credentials saved on this device.'
                      : 'Use the shared/default India stock route.'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      brokerPricingMode === 'override'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    }`}>
                      {brokerPricingMode === 'override' ? 'Needs config' : 'System'}
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {personalPricingMode === 'override' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Stocks & ETFs Override Credentials</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Private to this device. Other users keep using the shared setup.</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Alpha Vantage API Key</label>
                  <Input
                    type="password"
                    value={overrideForm.alphaVantageApiKey}
                    onChange={(event) => setOverrideForm((prev) => ({ ...prev, alphaVantageApiKey: event.target.value.trim() }))}
                    placeholder="Enter your Alpha Vantage key"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Finnhub API Key</label>
                  <Input
                    type="password"
                    value={overrideForm.finnhubApiKey}
                    onChange={(event) => setOverrideForm((prev) => ({ ...prev, finnhubApiKey: event.target.value.trim() }))}
                    placeholder="Enter your Finnhub key"
                  />
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Primary Override</label>
                  <Select
                    value={overrideForm.primaryProviderOverride}
                    onChange={(event) => setOverrideForm((prev) => ({ ...prev, primaryProviderOverride: event.target.value as UserProviderOverrides['primaryProviderOverride'] }))}
                  >
                    <option value="app-default">Use app default</option>
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Secondary Override</label>
                  <Select
                    value={overrideForm.secondaryProviderOverride}
                    onChange={(event) => setOverrideForm((prev) => ({ ...prev, secondaryProviderOverride: event.target.value as UserProviderOverrides['secondaryProviderOverride'] }))}
                  >
                    <option value="app-default">Use app default</option>
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button className="rounded-full bg-[#00875A] text-white hover:bg-[#007A51]" onClick={savePersonalProviderOverrides}>
                  Save Personal Credentials
                </Button>
              </div>
            </div>
          )}

          {brokerPricingMode === 'override' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">India Stocks Override Credentials</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Private to this device. Pick whichever broker this user wants to rely on.</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {([
                  ['upstox', 'Upstox', 'Good fit for India stock pricing and instrument matching.'],
                  ['groww', 'Groww', 'Useful if this user wants to rely on their Groww account instead.'],
                ] as const).map(([brokerKey, brokerLabel, brokerDescription]) => (
                  <div key={brokerKey} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{brokerLabel}</div>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{brokerDescription}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={brokerForm[brokerKey].enabled}
                          onChange={(event) => updateBrokerConfig(brokerKey, 'enabled', event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#00875A] focus:ring-[#00875A]"
                        />
                        Use
                      </label>
                    </div>
                    <div className="grid gap-3">
                      <Input
                        value={brokerForm[brokerKey].accountLabel}
                        onChange={(event) => updateBrokerConfig(brokerKey, 'accountLabel', event.target.value)}
                        placeholder={`${brokerLabel} account label`}
                        disabled={!brokerForm[brokerKey].enabled}
                      />
                      <Input
                        value={brokerForm[brokerKey].clientId}
                        onChange={(event) => updateBrokerConfig(brokerKey, 'clientId', event.target.value.trim())}
                        placeholder="Client ID / API key"
                        disabled={!brokerForm[brokerKey].enabled}
                      />
                      <Input
                        type="password"
                        value={brokerForm[brokerKey].clientSecret}
                        onChange={(event) => updateBrokerConfig(brokerKey, 'clientSecret', event.target.value.trim())}
                        placeholder="Client secret"
                        disabled={!brokerForm[brokerKey].enabled}
                      />
                      <Input
                        value={brokerForm[brokerKey].redirectUri}
                        onChange={(event) => updateBrokerConfig(brokerKey, 'redirectUri', event.target.value.trim())}
                        placeholder="Redirect URI"
                        disabled={!brokerForm[brokerKey].enabled}
                      />
                      <Input
                        type="password"
                        value={brokerForm[brokerKey].accessToken}
                        onChange={(event) => updateBrokerConfig(brokerKey, 'accessToken', event.target.value.trim())}
                        placeholder="Access token"
                        disabled={!brokerForm[brokerKey].enabled}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button className="rounded-full bg-[#00875A] text-white hover:bg-[#007A51]" onClick={saveBrokerConnections}>
                  Save Broker Credentials
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Advanced fallback order</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Most users do not need this. Auto-routing already picks the right source for the asset type.
                </p>
              </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    {sharedProviderForm.primaryProvider}{' -> '}{sharedProviderForm.secondaryProvider}
                  </div>
                <Button variant="outline" className="rounded-full" onClick={() => setShowAdvancedProviderRouting((current) => !current)}>
                  {showAdvancedProviderRouting ? 'Hide advanced routing' : 'Edit advanced routing'}
                </Button>
              </div>
            </div>

            {showAdvancedProviderRouting && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Primary Fallback</label>
                    <Select
                      value={sharedProviderForm.primaryProvider}
                      onChange={(event) => setSharedProviderForm((prev) => ({ ...prev, primaryProvider: event.target.value as PriceProvider }))}
                    >
                      {providerOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Secondary Fallback</label>
                    <Select
                      value={sharedProviderForm.secondaryProvider}
                      onChange={(event) => setSharedProviderForm((prev) => ({ ...prev, secondaryProvider: event.target.value as PriceProvider }))}
                    >
                      {providerOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  This only affects shared/system routes that still need a fallback chain. It does not override asset-type auto-routing like AMFI for India mutual funds or Upstox for India stocks.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button className="rounded-full bg-[#00875A] text-white hover:bg-[#007A51]" onClick={saveSharedProviderPreferences}>
                    Save Advanced Routing
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      <Card id="price-updates" className="border-none shadow-sm rounded-2xl mb-12">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              <CardTitle>Price Updates</CardTitle>
            </div>
            <CardDescription>Refresh live prices using your configured provider fallback order.</CardDescription>
          </div>
          <Button variant="outline" onClick={refreshPrices} disabled={isRefreshing} className="rounded-full">
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh All Prices
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-1">Assets with valid tickers will have their prices updated automatically.</p>
          <p className="text-sm text-slate-500">Ticker format: use `EXCHANGE:TICKER` where needed (e.g., `NASDAQ:AAPL`, `NSE:RELIANCE`).</p>
        </CardContent>
      </Card>
        </>
      )}

      {activeTab === 'structure' && (
        <>
      <Card id="asset-classes-overview" className="border-none shadow-sm rounded-2xl mb-6">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              <CardTitle>Asset Classes</CardTitle>
            </div>
            <CardDescription>Categories for organizing your assets</CardDescription>
          </div>
          <Button 
            className="bg-[#00875A] hover:bg-[#007A51] text-white rounded-full"
            onClick={() => {
              setClassToEdit(null);
              setIsAssetClassModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Class
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {Object.keys(assetClassesByCountry).length > 0 ? (
              Object.entries(assetClassesByCountry).map(([country, classes]) => (
                <div key={country} className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">{country}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(classes as AssetClassDef[]).map(cls => {
                      const count = assets.filter(a => a.assetClass === cls.name).length;
                      return (
                        <div key={cls.id} className="flex items-center justify-between p-4 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl shadow-sm hover:border-slate-200 dark:hover:border-slate-700 transition-colors cursor-pointer" onClick={() => {
                          if (cls.id.startsWith('temp-') || cls.id.startsWith('system-')) return;
                          setClassToEdit(cls);
                          setIsAssetClassModalOpen(true);
                        }}>
                          <div className="flex items-center gap-3">
                            <AssetClassLogo name={cls.name} image={cls.image} className="h-12 w-12 shrink-0" />
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-200">{cls.name}</p>
                              <p className="text-xs text-slate-500">{count} assets</p>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (cls.id.startsWith('system-')) {
                                setAlertDialog({ open: true, title: 'System Class', description: 'Credit Card is a built-in asset class and cannot be deleted.' });
                                return;
                              }
                              if (cls.id.startsWith('temp-')) {
                                setAlertDialog({ open: true, title: 'Cannot Delete', description: 'This class is currently in use by imported assets. Reassign those assets first.' });
                                return;
                              }
                              setConfirmDialog({
                                open: true,
                                title: 'Delete Asset Class',
                                description: `Are you sure you want to delete ${cls.name}?`,
                                onConfirm: async () => {
                                  await removeAssetClass(cls.id);
                                  setConfirmDialog(prev => ({ ...prev, open: false }));
                                }
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No asset classes found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Asset Class Library</CardTitle>
          <CardDescription>Import, export, or erase custom asset class definitions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadClassesTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download Template
            </Button>
            <input type="file" accept=".csv,.tsv" className="hidden" ref={classesFileRef} onChange={handleClassesUpload} />
            <Button variant="outline" onClick={() => classesFileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Import Asset Classes
            </Button>
            <Button variant="destructive" onClick={() => {
              setConfirmDialog({
                open: true,
                title: 'Erase All Classes',
                description: 'Are you sure you want to erase ALL custom asset classes? This cannot be undone.',
                onConfirm: () => {
                  clearAllAssetClasses();
                  setConfirmDialog(prev => ({ ...prev, open: false }));
                }
              });
            }}>
              <Trash2 className="mr-2 h-4 w-4" />
              Erase All Classes
            </Button>
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {activeTab === 'data' && (
      <div id="data-management" className="space-y-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Data Management & Sync</h2>
          <p className="text-slate-500 dark:text-slate-400">Manage your raw data imports, exports, and cloud synchronization.</p>
        </div>
      
      <Card id="cloud-sync" className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Cloud Sync</CardTitle>
          <CardDescription>Sync your portfolio data across devices using Google Drive.</CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleDriveSync />
        </CardContent>
      </Card>

      {showDeveloperMigrationTools && (
      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Local To Cloud Migration</CardTitle>
          <CardDescription>Replace the live Firebase portfolio using either the portfolio currently loaded on screen or the browser IndexedDB snapshot from this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={migrationSource === 'screen' ? 'default' : 'outline'}
              className={`rounded-full ${migrationSource === 'screen' ? 'bg-[#00875A] text-white hover:bg-[#007A51]' : ''}`}
              onClick={() => setMigrationSource('screen')}
            >
              Use Current App Data
            </Button>
            <Button
              type="button"
              variant={migrationSource === 'local' ? 'default' : 'outline'}
              className={`rounded-full ${migrationSource === 'local' ? 'bg-[#00875A] text-white hover:bg-[#007A51]' : ''}`}
              onClick={() => setMigrationSource('local')}
            >
              Use Browser Local Snapshot
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`rounded-2xl border p-4 ${migrationSource === 'screen' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900'}`}>
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Current App Portfolio (On Screen)</div>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <div>Assets: <span className="font-semibold text-slate-900 dark:text-white">{assets.length}</span></div>
                <div>Asset Classes: <span className="font-semibold text-slate-900 dark:text-white">{assetClasses.length}</span></div>
                <div>Base Currency: <span className="font-semibold text-slate-900 dark:text-white">{baseCurrency}</span></div>
                <div>Primary Provider: <span className="font-semibold text-slate-900 dark:text-white">{sharedPriceProviderSettings.primaryProvider}</span></div>
              </div>
            </div>
            <div className={`rounded-2xl border p-4 ${migrationSource === 'local' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950'}`}>
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Browser Local IndexedDB Snapshot</div>
              {migrationPreview.loading ? (
                <p className="text-sm text-slate-500">Loading browser local data...</p>
              ) : (
                <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div>Assets: <span className="font-semibold text-slate-900 dark:text-white">{migrationPreview.localAssets.length}</span></div>
                  <div>Asset Classes: <span className="font-semibold text-slate-900 dark:text-white">{migrationPreview.localClasses.length}</span></div>
                  <div>Base Currency: <span className="font-semibold text-slate-900 dark:text-white">{migrationPreview.localBaseCurrency || 'Not stored locally'}</span></div>
                  <div>Primary Provider: <span className="font-semibold text-slate-900 dark:text-white">{migrationPreview.localPriceProviderSettings?.primaryProvider || 'Not stored locally'}</span></div>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            This is a full replacement. It overwrites cloud assets, asset classes, base currency, and price-provider settings with the selected source. Member access stays intact so you do not lose login access.
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void loadMigrationPreview()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Snapshot
            </Button>
            <Button
              variant="destructive"
              disabled={migrationPreview.loading}
              onClick={() => {
                setReplaceConfirmText('');
                const sourceAssetsCount = migrationSource === 'screen' ? assets.length : migrationPreview.localAssets.length;
                const sourceClassesCount = migrationSource === 'screen' ? assetClasses.length : migrationPreview.localClasses.length;
                setConfirmDialog({
                  open: true,
                  title: 'Replace Live Portfolio',
                  description: `Type REPLACE to overwrite the live Firebase portfolio with ${sourceAssetsCount} assets and ${sourceClassesCount} asset classes from the ${migrationSource === 'screen' ? 'current app view' : 'browser local snapshot'}.`,
                  onConfirm: () => {},
                });
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              Push Selected Data To Cloud
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Holdings Data</CardTitle>
          <CardDescription>Import, export, or erase your asset holdings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">India Holdings</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadIndiaTemplate}>
                <Download className="mr-2 h-4 w-4" />
                India Template
              </Button>
              <Button variant="outline" onClick={downloadIndiaSampleTemplate}>
                <Download className="mr-2 h-4 w-4" />
                India Sample Template
              </Button>
              <Button variant="outline" onClick={() => exportHoldings('India')}>
                <Download className="mr-2 h-4 w-4" />
                Export India Holdings
              </Button>
              <input type="file" accept=".csv,.tsv" className="hidden" ref={indiaFileRef} onChange={(e) => handleHoldingsUpload(e, 'India')} />
              <Button variant="outline" onClick={() => indiaFileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import India Holdings
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Canada Holdings</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadCanadaTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Canada Template
              </Button>
              <Button variant="outline" onClick={downloadCanadaSampleTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Canada Sample Template
              </Button>
              <Button variant="outline" onClick={() => exportHoldings('Canada')}>
                <Download className="mr-2 h-4 w-4" />
                Export Canada Holdings
              </Button>
              <input type="file" accept=".csv,.tsv" className="hidden" ref={canadaFileRef} onChange={(e) => handleHoldingsUpload(e, 'Canada')} />
              <Button variant="outline" onClick={() => canadaFileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import Canada Holdings
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Asset Class Data</CardTitle>
          <CardDescription>Import, export, or erase custom asset class definitions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Asset Class Library</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadClassesTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download Template
            </Button>
            <input type="file" accept=".csv,.tsv" className="hidden" ref={classesFileRef} onChange={handleClassesUpload} />
            <Button variant="outline" onClick={() => classesFileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Import Asset Classes
            </Button>
            <Button variant="destructive" onClick={() => {
              setConfirmDialog({
                open: true,
                title: 'Erase All Classes',
                description: 'Are you sure you want to erase ALL custom asset classes? This cannot be undone.',
                onConfirm: () => {
                  clearAllAssetClasses();
                  setConfirmDialog(prev => ({ ...prev, open: false }));
                }
              });
            }}>
              <Trash2 className="mr-2 h-4 w-4" />
              Erase All Classes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>Erase imported holdings if you need to reset the portfolio data.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => {
            setConfirmDialog({
              open: true,
              title: 'Erase All Holdings',
              description: 'Are you sure you want to erase ALL holdings? This cannot be undone.',
              onConfirm: () => {
                clearAllAssets();
                setConfirmDialog(prev => ({ ...prev, open: false }));
              }
            });
          }}>
            <Trash2 className="mr-2 h-4 w-4" />
            Erase All Holdings
          </Button>
        </CardContent>
      </Card>
      </div>
      )}

      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <DialogHeader>
          <DialogTitle>{confirmDialog.title}</DialogTitle>
          <DialogDescription>{confirmDialog.description}</DialogDescription>
        </DialogHeader>
        {confirmDialog.title === 'Replace Live Portfolio' ? (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type REPLACE to confirm</label>
              <Input value={replaceConfirmText} onChange={(event) => setReplaceConfirmText(event.target.value)} placeholder="REPLACE" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>Cancel</Button>
              <Button variant="destructive" disabled={replaceConfirmText.trim() !== 'REPLACE' || isReplacingCloud} onClick={() => void handleReplaceCloudPortfolio()}>
                {isReplacingCloud ? 'Replacing...' : 'Replace Live Data'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDialog.onConfirm}>Confirm</Button>
          </div>
        )}
      </Dialog>

      <Dialog open={alertDialog.open} onOpenChange={(open) => setAlertDialog(prev => ({ ...prev, open }))}>
        <DialogHeader>
          <DialogTitle>{alertDialog.title}</DialogTitle>
          <DialogDescription>{alertDialog.description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end mt-4">
          <Button onClick={() => setAlertDialog(prev => ({ ...prev, open: false }))}>OK</Button>
        </div>
      </Dialog>

      <AddAssetClassModal 
        open={isAssetClassModalOpen} 
        onOpenChange={setIsAssetClassModalOpen} 
        classToEdit={classToEdit} 
      />
    </div>
  );
}
