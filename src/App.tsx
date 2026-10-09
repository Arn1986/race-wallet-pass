/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { DashboardTab } from './components/admin/DashboardTab.tsx';
import { RacesTab } from './components/admin/RacesTab.tsx';
import { TemplatesTab } from './components/admin/TemplatesTab.tsx';
import { CsvUploaderTab } from './components/admin/CsvUploaderTab.tsx';
import { CloudflareConsoleTab } from './components/admin/CloudflareConsoleTab.tsx';
import { PassLandingPage } from './components/public/PassLandingPage.tsx';
import { LookupPage } from './components/public/LookupPage.tsx';
import {
  LayoutDashboard,
  Trophy,
  Palette,
  Upload,
  Cloud,
  Search,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  Menu,
  X,
} from 'lucide-react';

export default function App() {
  // Navigation State
  const [currentRoute, setCurrentRoute] = useState<'admin' | 'pass' | 'lookup'>('admin');
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'races' | 'templates' | 'import' | 'cloudflare'>('dashboard');
  const [currentRunnerId, setCurrentRunnerId] = useState<string>('run-marathon-1042');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>(null);

  // Synchronize route with browser URL or hash
  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;

      if (path.startsWith('/pass/') || hash.startsWith('#/pass/') || hash.startsWith('#pass/')) {
        const id = path.startsWith('/pass/')
          ? path.replace('/pass/', '')
          : hash.replace(/^#\/?pass\//, '');
        if (id) {
          setCurrentRunnerId(id);
          setCurrentRoute('pass');
          return;
        }
      }

      if (path === '/lookup' || hash === '#/lookup' || hash === '#lookup') {
        setCurrentRoute('lookup');
        return;
      }

      // Check admin subtabs in hash
      if (hash.includes('races')) setActiveAdminTab('races');
      else if (hash.includes('templates')) setActiveAdminTab('templates');
      else if (hash.includes('import')) setActiveAdminTab('import');
      else if (hash.includes('cloudflare')) setActiveAdminTab('cloudflare');
      else setActiveAdminTab('dashboard');

      setCurrentRoute('admin');
    };

    handleUrlChange();
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.success) setStats(json.data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 8000);
    return () => clearInterval(interval);
  }, []);

  const navigateToPass = (runnerId: string) => {
    setCurrentRunnerId(runnerId);
    setCurrentRoute('pass');
    window.location.hash = `#/pass/${runnerId}`;
  };

  const navigateToLookup = () => {
    setCurrentRoute('lookup');
    window.location.hash = '#/lookup';
  };

  const navigateToAdmin = (tab: string = 'dashboard') => {
    setCurrentRoute('admin');
    setActiveAdminTab(tab as any);
    window.location.hash = `#/admin/${tab}`;
    setMobileMenuOpen(false);
  };

  // If viewing a participant's verified landing page
  if (currentRoute === 'pass') {
    return (
      <PassLandingPage
        runnerId={currentRunnerId}
        onNavigateHome={() => navigateToAdmin('dashboard')}
        onNavigateLookup={navigateToLookup}
      />
    );
  }

  // If viewing self-service lookup portal
  if (currentRoute === 'lookup') {
    return (
      <LookupPage
        onNavigatePass={navigateToPass}
        onNavigateHome={() => navigateToAdmin('dashboard')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-slate-950">
      {/* Top Main Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo & Platform Name */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigateToAdmin('dashboard')}>
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white flex-shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm sm:text-base tracking-tight text-white">
                  WALLET PASS
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800">
                  CLOUDFLARE EDGE
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Multi-Tenant Athletic Pass Engine</p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-1">
            <button
              onClick={() => navigateToAdmin('dashboard')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                activeAdminTab === 'dashboard'
                  ? 'bg-slate-900 text-sky-400 border border-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => navigateToAdmin('races')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                activeAdminTab === 'races'
                  ? 'bg-slate-900 text-sky-400 border border-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Events & Rosters</span>
            </button>

            <button
              onClick={() => navigateToAdmin('templates')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                activeAdminTab === 'templates'
                  ? 'bg-slate-900 text-sky-400 border border-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Pass Studio</span>
            </button>

            <button
              onClick={() => navigateToAdmin('import')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                activeAdminTab === 'import'
                  ? 'bg-slate-900 text-sky-400 border border-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>CSV Importer</span>
            </button>

            <button
              onClick={() => navigateToAdmin('cloudflare')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                activeAdminTab === 'cloudflare'
                  ? 'bg-slate-900 text-sky-400 border border-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Edge Console</span>
            </button>
          </nav>

          {/* Right Action Shortcuts */}
          <div className="hidden sm:flex items-center space-x-2">
            <button
              onClick={navigateToLookup}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold text-xs border border-slate-800 flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Self-Service Lookup</span>
            </button>

            <button
              onClick={() => navigateToPass('run-marathon-1042')}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-sky-500/20"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Demo Runner Pass</span>
            </button>
          </div>

          {/* Mobile menu toggle */}
          <div className="lg:hidden flex items-center space-x-2">
            <button
              onClick={() => navigateToPass('run-marathon-1042')}
              className="px-2.5 py-1.5 rounded-lg bg-sky-500 text-slate-950 font-bold text-[11px]"
            >
              Pass
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-b border-slate-800 bg-slate-950 p-4 space-y-2 animate-fadeIn">
            <button
              onClick={() => navigateToAdmin('dashboard')}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <LayoutDashboard className="w-4 h-4 text-sky-400" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => navigateToAdmin('races')}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <Trophy className="w-4 h-4 text-sky-400" />
              <span>Events & Rosters</span>
            </button>
            <button
              onClick={() => navigateToAdmin('templates')}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <Palette className="w-4 h-4 text-sky-400" />
              <span>Pass Studio</span>
            </button>
            <button
              onClick={() => navigateToAdmin('import')}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <Upload className="w-4 h-4 text-sky-400" />
              <span>CSV Importer (PASS_QUEUE)</span>
            </button>
            <button
              onClick={() => navigateToAdmin('cloudflare')}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <Cloud className="w-4 h-4 text-sky-400" />
              <span>Cloudflare D1/R2 Console</span>
            </button>
            <button
              onClick={navigateToLookup}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 flex items-center space-x-2"
            >
              <Search className="w-4 h-4 text-sky-400" />
              <span>Self-Service Lookup Portal</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Container Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeAdminTab === 'dashboard' && (
          <DashboardTab
            stats={stats}
            onNavigateTab={navigateToAdmin}
            onOpenRunnerPass={navigateToPass}
          />
        )}

        {activeAdminTab === 'races' && (
          <RacesTab
            onOpenRunnerPass={navigateToPass}
            onNavigateTab={navigateToAdmin}
          />
        )}

        {activeAdminTab === 'templates' && <TemplatesTab />}

        {activeAdminTab === 'import' && (
          <CsvUploaderTab
            onOpenRunnerPass={navigateToPass}
            onNavigateTab={navigateToAdmin}
          />
        )}

        {activeAdminTab === 'cloudflare' && <CloudflareConsoleTab />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Deployed for Cloudflare Edge Workers & Pages</span>
          </div>
          <div className="flex items-center space-x-4 text-[11px]">
            <span>Cloudflare D1 (SQLite)</span>
            <span>•</span>
            <span>Cloudflare R2 Bucket</span>
            <span>•</span>
            <span>Cloudflare Queues</span>
            <span>•</span>
            <span>walletwallet.dev API</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
