import React, { useEffect, useState } from 'react';
import { PortfolioProvider, usePortfolio } from './store/PortfolioContext';
import { AuthProvider, useAuth } from './store/AuthContext';
import { Asset } from './store/db';
import { Dashboard } from './components/Dashboard';
import { Ledger } from './components/Ledger';
import { AddAssetModal } from './components/AddAssetModal';
import { Settings, type SettingsSection } from './components/Settings';
import { ImportProgressOverlay } from './components/ImportProgressOverlay';
import { Button } from './components/ui/button';
import { Select } from './components/ui/select';
import { RefreshCw, Moon, Sun, Settings as SettingsIcon, LayoutDashboard, Wallet, FileText, LogOut, ArrowRight, CheckCircle2, Globe2, Shield, Sparkles } from 'lucide-react';
import { SplitwiseProvider } from './store/SplitwiseContext';
import { ConnectedAccountsProvider } from './store/ConnectedAccountsContext';
import { parseInitialViewFromQuery } from './lib/appNavigation';

function MainApp() {
  const { user, logout } = useAuth();
  const { refreshPrices, isRefreshing, portfolios, activePortfolioId, setActivePortfolioId } = usePortfolio();
  const initialView = parseInitialViewFromQuery();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | undefined>(undefined);
  const [currentView, setCurrentView] = useState<'dashboard' | 'assets' | 'settings'>(initialView.view);
  const [settingsSection] = useState<SettingsSection | undefined>(initialView.settingsSection);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('nexus-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = storedTheme ? storedTheme === 'dark' : prefersDark;
    setIsDarkMode(shouldUseDark);
    document.documentElement.classList.toggle('dark', shouldUseDark);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode((current) => {
      const next = !current;
      document.documentElement.classList.toggle('dark', next);
      window.localStorage.setItem('nexus-theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const handleEditAsset = React.useCallback((asset: Asset) => {
    setEditingAsset(asset);
    setIsAddModalOpen(true);
  }, []);

  return (
    <div className={`min-h-screen bg-[#F8F9FA] text-slate-900 dark:bg-slate-900 dark:text-slate-50 transition-colors duration-200 font-sans`}>
      <header className="bg-white dark:bg-slate-950 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-800">
        <div className="container mx-auto px-4 py-4 grid grid-cols-1 gap-3 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center">
          <div className="flex items-center gap-3 cursor-pointer min-w-0 lg:justify-self-start" onClick={() => setCurrentView('dashboard')}>
            <div className="w-10 h-10 bg-[#00875A] rounded-xl flex items-center justify-center shadow-sm">
              <Wallet className="text-white h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight leading-tight text-slate-900 dark:text-white">Nexus Portfolio</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Track your wealth</p>
            </div>
          </div>
          
          <div className="flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-1 rounded-full border border-slate-100 dark:border-slate-800 xl:justify-self-center xl:min-w-0">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${currentView === 'dashboard' ? 'bg-[#00875A] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button 
              onClick={() => setCurrentView('assets')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${currentView === 'assets' ? 'bg-[#00875A] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Assets</span>
            </button>
            <button 
              onClick={() => setCurrentView('settings')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${currentView === 'settings' ? 'bg-[#00875A] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
            >
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 flex-wrap xl:flex-nowrap xl:justify-self-end">
            {portfolios.length > 0 && (
              <div className="hidden xl:block xl:w-[210px] 2xl:w-[240px] shrink-0">
                <Select
                  value={activePortfolioId || ''}
                  onChange={(event) => setActivePortfolioId(event.target.value)}
                  className="h-11 rounded-lg border-slate-200 dark:border-slate-800 text-sm"
                  aria-label="Active portfolio"
                >
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.name}{portfolio.isPersonal ? '' : ` • ${portfolio.ownerEmail}`}
                    </option>
                  ))}
                </Select>
              </div>
            )}

              <Button variant="outline" size="icon" onClick={refreshPrices} disabled={isRefreshing} className="h-11 w-11 rounded-lg border-slate-200 dark:border-slate-800 shrink-0">
                <RefreshCw className={`h-4 w-4 text-slate-600 dark:text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={toggleDarkMode}
              className="h-11 w-11 rounded-lg border-slate-200 dark:border-slate-800 shrink-0"
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? <Sun className="h-4 w-4 text-slate-600 dark:text-slate-400" /> : <Moon className="h-4 w-4 text-slate-600 dark:text-slate-400" />}
            </Button>

            {user && (
              <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 min-w-0 max-w-[250px]">
                <span className="truncate">{user.email}</span>
                <button type="button" onClick={() => void logout()} className="text-slate-500 hover:text-slate-900 dark:hover:text-white">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
            
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'assets' && <Ledger onEditAsset={handleEditAsset} onAddAsset={() => setIsAddModalOpen(true)} />}
        {currentView === 'settings' && <Settings initialSection={settingsSection} />}
      </main>

      <AddAssetModal 
        open={isAddModalOpen} 
        onOpenChange={(open) => {
          setIsAddModalOpen(open);
          if (!open) setEditingAsset(undefined);
        }} 
        assetToEdit={editingAsset}
      />
      <ImportProgressOverlay />
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading, authError, signInWithGoogle, logout } = useAuth();
  const { hasAccess, accessError, isPortfolioLoading } = usePortfolio();

  if (loading || (user && isPortfolioLoading)) {
    return <CenteredState title="Loading portfolio" description="Connecting to Firebase and syncing your shared portfolio..." />;
  }

  if (!user) {
    return <PublicHome authError={authError} onLaunch={() => void signInWithGoogle()} />;
  }

  if (!hasAccess) {
    return (
      <CenteredState
        title="Preparing your portfolio"
        description={accessError || 'We are creating or syncing the portfolios available to your Google account. Please refresh in a moment if this screen persists.'}
        action={(
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        )}
      />
    );
  }

  return <MainApp />;
}

function PublicHome({ authError, onLaunch }: { authError: string | null; onLaunch: () => void }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dff7eb_0%,#f7faf8_38%,#eef3f8_100%)] text-slate-900">
      <header className="border-b border-white/60 bg-white/70 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00875A] shadow-sm">
              <Wallet className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">Nexus Portfolio</div>
              <div className="text-xs font-medium text-slate-500">Shared family wealth tracking</div>
            </div>
          </div>
          <Button onClick={onLaunch} className="rounded-full bg-[#00875A] px-5 text-white hover:bg-[#007A51]">
            Launch Portfolio
          </Button>
        </div>
      </header>

      <main>
        <section className="container mx-auto grid gap-10 px-4 py-16 lg:grid-cols-[minmax(0,1.15fr)_440px] lg:items-center lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm">
              <Sparkles className="h-4 w-4" />
              Built for shared portfolios across markets
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[1.02] tracking-tight text-slate-950 sm:text-6xl">
              One portfolio home for families investing across Canada, India, and the U.S.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Track holdings, sync live pricing across providers, organize assets cleanly, and let each household member launch into the portfolio from the same shared workspace.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button onClick={onLaunch} className="h-12 rounded-full bg-[#00875A] px-6 text-base text-white hover:bg-[#007A51]">
                Launch Portfolio
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <div className="flex items-center rounded-full border border-slate-200 bg-white/80 px-5 text-sm text-slate-600 shadow-sm">
                Google sign-in only appears after launch
              </div>
            </div>

            {authError && (
              <div className="mt-5 max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {authError}
              </div>
            )}

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ['Multi-market pricing', 'Auto-match Yahoo-style tickers to the right quote source.'],
                ['Shared access', 'Invite partners and family members into the same portfolio.'],
                ['Personal overrides', 'Let each user bring their own paid provider or broker connection.'],
              ].map(([title, description]) => (
                <div key={title} className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)] backdrop-blur">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-[linear-gradient(135deg,rgba(0,135,90,0.18),rgba(15,23,42,0.08))] blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-slate-950 p-6 text-white shadow-[0_35px_90px_rgba(15,23,42,0.22)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">Live Portfolio Command</div>
                  <div className="mt-2 text-2xl font-bold">Portfolio workspace</div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  Public app shell
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Total tracked assets</span>
                    <span className="font-semibold text-white">Across shared portfolios</span>
                  </div>
                  <div className="mt-4 text-4xl font-black">Canada + India + U.S.</div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Keep one clean source of truth even when holdings span brokerages, currencies, and countries.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    [Globe2, 'Auto-routed prices', 'Massive, AMFI, Alpha Vantage, Yahoo fallback'],
                    [Shield, 'Member controls', 'Owners, partners, and local personal overrides'],
                    [CheckCircle2, 'Cleaner onboarding', 'Public landing page first, Google auth only on launch'],
                    [Sparkles, 'Portfolio-ready UI', 'Dashboard, ledger, settings, and sync tools'],
                  ].map(([Icon, title, description]) => (
                    <div key={title} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <Icon className="h-5 w-5 text-emerald-300" />
                      <div className="mt-3 text-sm font-semibold text-white">{title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function CenteredState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] px-4">
      <div className="w-full max-w-lg rounded-3xl border border-white/70 bg-white/85 p-8 text-center shadow-[0_30px_80px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00875A]">
          <Wallet className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="mt-3 text-base text-slate-600">{description}</p>
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ConnectedAccountsProvider>
        <SplitwiseProvider>
          <PortfolioProvider>
            <AuthenticatedApp />
          </PortfolioProvider>
        </SplitwiseProvider>
      </ConnectedAccountsProvider>
    </AuthProvider>
  );
}
