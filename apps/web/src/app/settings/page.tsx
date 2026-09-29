'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import type { ApiKeyItem } from '@emeradar/services';
import {
  User,
  Sliders,
  KeyRound,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
  LogOut,
  Globe,
  Layers,
  Code2,
  Check,
} from 'lucide-react';

const BUILD_ARCHETYPES = [
  { id: 'LIGHTWEIGHT_TOOL', label: 'Lightweight Tool (Single-purpose web app)' },
  { id: 'MICRO_SAAS', label: 'Micro-SaaS (Workflow & Subscription)' },
  { id: 'WORKFLOW_ENGINE', label: 'Workflow Engine & Automation' },
  { id: 'AI_AGENT', label: 'AI Agent & LLM Wrapper' },
  { id: 'DATA_SERVICE', label: 'Data-as-a-Service / Curated Directory' },
  { id: 'API_FIRST', label: 'API-First Micro-Service' },
];

const TARGET_MARKETS = [
  { id: 'US', label: 'United States (US)' },
  { id: 'GLOBAL', label: 'Global English' },
  { id: 'EU', label: 'European Union (EU)' },
  { id: 'APAC', label: 'Asia-Pacific' },
  { id: 'CN', label: 'Greater China' },
];

function SettingsContent() {
  const { user, preferences, isLoading, updatePreferences, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'api-keys' | 'billing'>('profile');

  // Preferences form state
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['US']);
  const [selectedArchetypes, setSelectedArchetypes] = useState<string[]>(['LIGHTWEIGHT_TOOL', 'MICRO_SAAS']);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  // API keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Sync preferences from context
  useEffect(() => {
    if (preferences) {
      setLocale(preferences.uiLocale || 'zh-CN');
      setSelectedMarkets(preferences.preferredMarkets || ['US']);
      setSelectedArchetypes(preferences.preferredBuildTypes || ['LIGHTWEIGHT_TOOL', 'MICRO_SAAS']);
    }
  }, [preferences]);

  // Load API keys when api-keys tab is clicked
  const loadApiKeys = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingKeys(true);
      const res = await fetch('/api/v1/user/api-keys');
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoadingKeys(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'api-keys' && user) {
      loadApiKeys();
    }
  }, [activeTab, user, loadApiKeys]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingPrefs(true);
      await updatePreferences({
        uiLocale: locale,
        preferredMarkets: selectedMarkets,
        preferredBuildTypes: selectedArchetypes,
      });
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 3000);
    } catch (err) {
      console.error('Error saving preferences:', err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsGeneratingKey(true);
      setKeyError(null);
      const res = await fetch('/api/v1/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel || 'Live Production Key' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate API Key');
      }
      setGeneratedSecret(data.rawSecretKey);
      setNewKeyLabel('');
      await loadApiKeys();
    } catch (err: any) {
      setKeyError(err.message);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API Key? Any scripts using it will lose access immediately.')) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/user/api-keys/${keyId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      }
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  };

  const handleCopySecret = () => {
    if (generatedSecret) {
      navigator.clipboard.writeText(generatedSecret);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    }
  };

  // If loading session
  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // If not logged in
  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-6">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Sign in to access Account Dashboard</h2>
        <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
          Manage your research preferences, API keys, project track record, and plan entitlements.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/login"
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition"
          >
            Sign In with Email
          </Link>
          <Link
            href="/register"
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition"
          >
            Create New Account
          </Link>
        </div>

      </div>
    );
  }

  const userInitials = (user.displayName || user.email)
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const tierBadgeColor =
    user.tier === 'TEAM'
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : user.tier === 'PRO'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header Profile Bar */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-xl flex items-center justify-center shadow-md shadow-blue-500/20">
            {userInitials}
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                {user.displayName || user.email.split('@')[0]}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${tierBadgeColor}`}>
                {user.tier} TIER
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {user.role}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <span>{user.email}</span>
              <span>•</span>
              <span className="text-xs text-slate-400">ID: {user.id}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/billing"
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition flex items-center gap-1.5"
          >
            <CreditCard className="w-3.5 h-3.5 text-slate-500" />
            <span>Manage Plan</span>
          </Link>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-500" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 mb-8 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === 'profile'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <User className="w-4 h-4" />
          <span>Profile & Account</span>
        </button>

        <button
          onClick={() => setActiveTab('preferences')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === 'preferences'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Radar Preferences</span>
        </button>

        <button
          onClick={() => setActiveTab('api-keys')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === 'api-keys'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Developer API Keys</span>
        </button>

        <button
          onClick={() => setActiveTab('billing')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === 'billing'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Quotas & Subscription</span>
        </button>
      </div>

      {/* TAB 1: Profile */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <h3 className="text-base font-bold text-slate-900 mb-1">Account Information</h3>
              <p className="text-xs text-slate-500 mb-6">
                Personal details and login credentials associated with your account.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={user.displayName || ''}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    readOnly
                    value={user.email}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Account Role
                    </label>
                    <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800">
                      {user.role}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Account Status
                    </label>
                    <div className="px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>{user.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Current Plan</span>
              <h4 className="text-2xl font-extrabold mt-1">{user.tier} TIER</h4>
              <p className="text-xs text-slate-300 mt-2">
                Real-time SERP weakness indicators, commercial proof ledger, and opportunity scoring.
              </p>
              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400">Entitlements</span>
                <span className="font-semibold text-emerald-400">Active & Validated</span>
              </div>
              <Link
                href="/billing"
                className="mt-4 block w-full py-2.5 text-center rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-xs transition"
              >
                View Plans & Upgrade →
              </Link>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-xs text-slate-600 space-y-3">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Security & Storage</span>
              </div>
              <p>
                Credentials and session keys are secured with PBKDF2/scrypt key derivation. All database transactions are strictly isolated.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Preferences */}
      {activeTab === 'preferences' && (
        <form onSubmit={handleSavePreferences} className="max-w-3xl space-y-8">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                Target Search Markets
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Select the geographical and linguistic search indexes you want the Radar scanner to prioritize.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {TARGET_MARKETS.map((m) => {
                  const checked = selectedMarkets.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition ${
                        checked ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            setSelectedMarkets(selectedMarkets.filter((x) => x !== m.id));
                          } else {
                            setSelectedMarkets([...selectedMarkets, m.id]);
                          }
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-semibold text-slate-800">{m.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                Preferred Build Archetypes
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Filter radar alerts and recommendation feeds based on your technical execution capabilities.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {BUILD_ARCHETYPES.map((a) => {
                  const checked = selectedArchetypes.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition ${
                        checked ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            setSelectedArchetypes(selectedArchetypes.filter((x) => x !== a.id));
                          } else {
                            setSelectedArchetypes([...selectedArchetypes, a.id]);
                          }
                        }}
                        className="rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-semibold text-slate-800">{a.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-base font-bold text-slate-900 mb-1">UI Language & Digest</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Interface Language
                  </label>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  >
                    <option value="zh-CN">简体中文 (Simplified Chinese)</option>
                    <option value="en-US">English (United States)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={savingPrefs}
                className="px-5 py-2.5 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 transition flex items-center gap-2"
              >
                {savingPrefs ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Preferences</span>
                )}
              </button>
              {prefsSaved && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Preferences updated!
                </span>
              )}
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: Developer API Keys */}
      {activeTab === 'api-keys' && (
        <div className="space-y-8">
          {/* Header Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Code2 className="w-5 h-5 text-blue-600" />
                Developer API Keys
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                Use live API keys (`emd_live_...`) to query the search opportunity catalog, export reports programmatically, or connect internal validation bots.
              </p>
            </div>

            <form onSubmit={handleCreateApiKey} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Key label (e.g. Scraper Bot)"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                className="px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={isGeneratingKey}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-1.5 shrink-0"
              >
                {isGeneratingKey ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Generate Key</span>
              </button>
            </form>
          </div>

          {keyError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{keyError}</span>
            </div>
          )}

          {/* One-time Key Display Modal/Card */}
          {generatedSecret && (
            <div className="p-5 rounded-2xl bg-amber-50 border border-amber-300 shadow-md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  Save Your Secret API Key
                </span>
                <button
                  onClick={() => setGeneratedSecret(null)}
                  className="text-xs text-amber-700 hover:text-amber-900 font-semibold"
                >
                  Dismiss
                </button>
              </div>
              <p className="text-xs text-amber-800 mb-3">
                This secret key will <strong>never be shown again</strong>. Please copy and store it securely in your environment variables.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs px-3 py-2 bg-white rounded-xl border border-amber-300 text-slate-800 select-all overflow-x-auto">
                  {generatedSecret}
                </code>
                <button
                  onClick={handleCopySecret}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition flex items-center gap-1.5 shrink-0"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Keys Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Active API Keys ({apiKeys.length})
              </span>
              <button
                onClick={loadApiKeys}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            {loadingKeys ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
                <span className="text-xs text-slate-500 mt-2 block">Loading API keys...</span>
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <KeyRound className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No API keys created yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  Create your first key above to access EmeRadar data programmatically.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {apiKeys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt);
                  return (
                    <div
                      key={key.id}
                      className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{key.label}</span>
                          {isRevoked ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              Revoked
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                          <code className="font-mono text-slate-600">{key.keyPrefix}</code>
                          <span>•</span>
                          <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                          {key.lastUsedAt && (
                            <>
                              <span>•</span>
                              <span>Last used {new Date(key.lastUsedAt).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {!isRevoked && (
                        <button
                          onClick={() => handleRevokeApiKey(key.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 transition flex items-center gap-1 self-start sm:self-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* cURL Example */}
          <div className="p-5 rounded-2xl bg-slate-900 text-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Example API Request
              </span>
              <span className="text-xs text-emerald-400 font-mono">REST / JSON</span>
            </div>
            <pre className="font-mono text-xs overflow-x-auto p-3 bg-slate-950 rounded-xl text-emerald-300">
{`curl -X GET "https://emeradar.com/api/v1/opportunities?verdict=GO_SIGNAL&limit=10" \\
  -H "Authorization: Bearer emd_live_YOUR_SECRET_KEY" \\
  -H "Accept: application/json"`}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 4: Billing & Quotas */}
      {activeTab === 'billing' && (
        <div className="space-y-8">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
                  Subscription Status
                </span>
                <h3 className="text-2xl font-extrabold text-slate-900 mt-1">
                  {user.tier === 'TEAM' ? 'Team Scale Plan' : user.tier === 'PRO' ? 'Builder Pro Plan' : 'Free Starter Plan'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Billing cycle renews automatically. You can upgrade, downgrade, or cancel at any time.
                </p>
              </div>

              <Link
                href="/billing"
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition self-start sm:self-auto"
              >
                Change Plan / Manage Invoices →
              </Link>
            </div>

            {/* Quota Progress */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                  <span>Tracked Projects</span>
                  <span className="text-blue-600 font-bold">3 / 10 Active</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: '30%' }} />
                </div>
                <p className="text-[11px] text-slate-400 mt-2">7 project slots remaining</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                  <span>Deep Report Exports</span>
                  <span className="text-emerald-600 font-bold">12 / 30 Monthly</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-emerald-600 h-2 rounded-full" style={{ width: '40%' }} />
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Resets on 1st of next month</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                  <span>Radar Webhook Alerts</span>
                  <span className="text-purple-600 font-bold">5 / 5 Enabled</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-purple-600 h-2 rounded-full" style={{ width: '100%' }} />
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Instant SERP shift notifications</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
