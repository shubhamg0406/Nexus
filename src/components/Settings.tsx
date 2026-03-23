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

export type SettingsSection = 'manage-members' | 'price-providers' | 'asset-classes-overview' | 'price-updates' | 'data-management' | 'cloud-sync';

export function Settings({ initialSection }: { initialSection?: SettingsSection } = {}) {
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
    priceProviderSettings,
    updatePriceProviderSettings,
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
  const [providerForm, setProviderForm] = React.useState<PriceProviderSettings>(DEFAULT_PRICE_PROVIDER_SETTINGS);
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

  React.useEffect(() => {
    setProviderForm(priceProviderSettings);
  }, [priceProviderSettings]);

  React.useEffect(() => {
    void loadMigrationPreview();
  }, []);

  React.useEffect(() => {
    if (!initialSection) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(initialSection)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection]);

  const downloadIndiaTemplate = () => {
    const csv = "Purchase Date,Owner,Holding Name,Ticker,Type,Holding Platform,Comments,Qty,Average Purchase Price,Purchase Value,Current Price,Current Value";
    downloadCSV(csv, "india_holdings_template.csv");
  };

  const downloadCanadaTemplate = () => {
    const csv = "Purchase Date,Owner,Holding Name,Ticker,Type,Holding Platform,Comments,Qty,Avg Purchase Price,Purchase Value,Current Price,Current Value,US or CAD";
    downloadCSV(csv, "canada_holdings_template.csv");
  };

  const downloadClassesTemplate = () => {
    const csv = "Country,Asset Class Name,Image URL";
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

  const saveProviderPreferences = async () => {
    await updatePriceProviderSettings(providerForm);
    setAlertDialog({ open: true, title: 'Saved', description: 'Price provider settings have been updated.' });
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
      ? priceProviderSettings
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2">Settings</h1>
          <p className="text-lg text-slate-500 dark:text-slate-400">Configure your portfolio tracker</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="rounded-full px-6"
            onClick={() => document.getElementById('manage-members')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Users className="mr-2 h-4 w-4" />
            Manage Members
          </Button>
          <Button 
            className="bg-[#00875A] hover:bg-[#007A51] text-white rounded-full px-6"
            onClick={() => document.getElementById('data-management')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Assets
          </Button>
        </div>
      </div>

      {/* Family Members Card */}
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

      <Card id="price-providers" className="border-none shadow-sm rounded-2xl mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            <CardTitle>Price Provider Settings</CardTitle>
          </div>
          <CardDescription>Set API keys and choose which provider to try first when fetching live prices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Alpha Vantage API Key</label>
              <Input
                value={providerForm.alphaVantageApiKey}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, alphaVantageApiKey: event.target.value.trim() }))}
                placeholder="Enter Alpha Vantage key"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Finnhub API Key</label>
              <Input
                value={providerForm.finnhubApiKey}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, finnhubApiKey: event.target.value.trim() }))}
                placeholder="Enter Finnhub key"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Primary Provider</label>
              <Select
                value={providerForm.primaryProvider}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, primaryProvider: event.target.value as PriceProvider }))}
              >
                <option value="yahoo">Yahoo Finance</option>
                <option value="alphavantage">Alpha Vantage</option>
                <option value="finnhub">Finnhub</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Secondary Provider</label>
              <Select
                value={providerForm.secondaryProvider}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, secondaryProvider: event.target.value as PriceProvider }))}
              >
                <option value="yahoo">Yahoo Finance</option>
                <option value="alphavantage">Alpha Vantage</option>
                <option value="finnhub">Finnhub</option>
              </Select>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            The app will try the primary provider first, wait 500ms, and then fall back to the secondary provider if needed. Failed rows keep their last known price and will be highlighted in the Assets table.
          </div>
          <div className="flex justify-end">
            <Button className="rounded-full bg-[#00875A] text-white hover:bg-[#007A51]" onClick={saveProviderPreferences}>
              Save Provider Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Asset Classes Card */}
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

      {/* Price Updates Card */}
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

      {/* Data Management Section */}
      <div id="data-management" className="pt-8 border-t border-slate-200 dark:border-slate-800 space-y-6">
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
                <div>Primary Provider: <span className="font-semibold text-slate-900 dark:text-white">{priceProviderSettings.primaryProvider}</span></div>
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

          <div className="pt-4 border-t">
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
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle>Asset Classes</CardTitle>
          <CardDescription>Manage custom asset classes for different countries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
      </div>

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
