import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Asset {
  id: string;
  name: string;
  ticker?: string;
  quantity: number;
  costBasis: number;
  currency: 'CAD' | 'INR' | 'USD';
  owner: string;
  country: 'India' | 'Canada';
  assetClass: string;
  autoUpdate: boolean;
  currentPrice?: number;
  previousClose?: number;
  lastUpdated?: number;
  purchaseDate?: string;
  originalCurrency?: 'USD' | 'CAD' | 'INR';
  exchangeRate?: number;
  holdingPlatform?: string;
  comments?: string;
  preferredPriceProvider?: 'yahoo' | 'alphavantage' | 'finnhub';
  priceConversionFactor?: number;
  priceUnitConversionFactor?: number;
  priceSourceCurrency?: 'USD' | 'CAD' | 'INR';
  priceTargetCurrency?: 'USD' | 'CAD' | 'INR';
  priceFormula?: string;
  priceFetchStatus?: 'idle' | 'success' | 'failed';
  priceFetchMessage?: string;
  priceProvider?: string;
  sourceType?: 'manual' | 'connected';
  sourceManaged?: boolean;
  connectedProvider?: 'upstox' | 'splitwise';
  connectedHoldingId?: string;
  connectedAccountId?: string;
  holdingKind?: 'holding' | 'position';
  positionSide?: 'long' | 'short' | 'unknown';
  hiddenFromDashboard?: boolean;
  possibleDuplicateOf?: string;
  splitwiseOriginalBreakdown?: Array<{ currency: string; amount: number }>;
  splitwiseConvertedCurrency?: 'CAD' | 'INR' | 'USD';
  splitwiseConversionNote?: string;
}

export interface AssetClassDef {
  id: string;
  country: string;
  name: string;
  image?: string;
}

interface PortfolioDB extends DBSchema {
  assets: {
    key: string;
    value: Asset;
    indexes: { 'by-owner': string; 'by-country': string };
  };
  assetClasses: {
    key: string;
    value: AssetClassDef;
  };
  settings: {
    key: string;
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<PortfolioDB>> | null = null;

export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PortfolioDB>('nexus-portfolio', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('by-owner', 'owner');
          assetStore.createIndex('by-country', 'country');
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('assetClasses', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllAssets(): Promise<Asset[]> {
  const db = await getDB();
  return db.getAll('assets');
}

export async function saveAsset(asset: Asset): Promise<void> {
  const db = await getDB();
  await db.put('assets', asset);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('assets', id);
}

export async function clearAssets(): Promise<void> {
  const db = await getDB();
  await db.clear('assets');
}

export async function saveAllAssets(assets: Asset[], onProgress?: (current: number, total: number) => void): Promise<void> {
  const db = await getDB();
  await db.clear('assets');
  
  let current = 0;
  const total = assets.length;
  if (onProgress) onProgress(0, total);

  const chunkSize = 50;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = assets.slice(i, i + chunkSize);
    const tx = db.transaction('assets', 'readwrite');
    await Promise.all(chunk.map(asset => tx.store.put(asset)));
    await tx.done;
    
    current += chunk.length;
    if (onProgress) onProgress(current, total);
    // Yield to event loop to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function getAllAssetClasses(): Promise<AssetClassDef[]> {
  const db = await getDB();
  return db.getAll('assetClasses');
}

export async function clearAssetClasses(): Promise<void> {
  const db = await getDB();
  await db.clear('assetClasses');
}

export async function saveAllAssetClasses(classes: AssetClassDef[], onProgress?: (current: number, total: number) => void): Promise<void> {
  const db = await getDB();
  await db.clear('assetClasses');
  
  let current = 0;
  const total = classes.length;
  if (onProgress) onProgress(0, total);

  const chunkSize = 50;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = classes.slice(i, i + chunkSize);
    const tx = db.transaction('assetClasses', 'readwrite');
    await Promise.all(chunk.map(c => tx.store.put(c)));
    await tx.done;
    
    current += chunk.length;
    if (onProgress) onProgress(current, total);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function saveAssetClass(cls: AssetClassDef): Promise<void> {
  const db = await getDB();
  await db.put('assetClasses', cls);
}

export async function deleteAssetClass(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('assetClasses', id);
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await getDB();
  return (await db.get('settings', key)) ?? null;
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}
