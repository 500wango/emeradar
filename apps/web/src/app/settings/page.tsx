'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useI18n, Locale } from '@/lib/i18n';
import { planLabelKey, resolvePlanCode } from '@/lib/plan-display';
import type { ApiKeyItem, UserEntitlementsInfo } from '@emeradar/services';
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
  Globe,
  Layers,
  Code2,
  Check,
  MailCheck,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Field, FieldLabel, Input, Select } from '@/components/ui/Field';
import { Meter } from '@/components/ui/Meter';
import { PageFrame } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';

const BUILD_ARCHETYPES = [
  { id: 'LIGHTWEIGHT_TOOL', label: 'Lightweight Tool (Single-purpose web app)', labelZh: '轻量工具 (单任务Web应用)' },
  { id: 'MICRO_SAAS', label: 'Micro-SaaS (Workflow & Subscription)', labelZh: '微型SaaS (工作流与订阅制)' },
  { id: 'PSEO_SITE', label: 'pSEO Directory / Content Engine', labelZh: 'pSEO 搜索流量站 / 内容引擎' },
  { id: 'DIRECTORY', label: 'Curated Directory / Marketplace', labelZh: '精选垂直目录 / 细分交易市场' },
  { id: 'CONTENT_SITE', label: 'Authority Content Site', labelZh: '垂直权威内容站' },
  { id: 'TOOL', label: 'Standalone Utility Tool', labelZh: '独立功能型工具' },
];

const TARGET_MARKETS = [
  { id: 'US', label: 'United States (US · en-US)', labelZh: '美国英语搜索市场 (US · en-US)' },
];

/** A selectable archetype/market card. Selection is a hairline accent border,
 *  not a gradient or a filled pill. */
const optionCard = (selected: boolean) =>
  cn(
    'flex cursor-pointer items-center gap-3 border p-3 text-xs font-semibold transition-colors',
    selected
      ? 'border-accent bg-accent/10 text-fg'
      : 'border-line-control text-fg-muted hover:border-accent hover:text-fg'
  );

const tabClass = (active: boolean) =>
  cn(
    '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    active ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'
  );

const sectionLabelClass = 'font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle';

function SettingsContent() {
  const { user, preferences, isLoading, updatePreferences } = useAuth();
  const { locale: i18nLocale, setLocale: setI18nLocale, t, isZh } = useI18n();
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'api-keys' | 'billing'>('profile');

  // Preferences form state
  const [locale, setLocale] = useState<Locale>(i18nLocale);
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

  // Entitlements and quotas state
  const [entitlements, setEntitlements] = useState<UserEntitlementsInfo | null>(null);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const resendVerification = async () => {
    setVerificationSending(true);
    setVerificationSent(false);
    try {
      const response = await fetch('/api/v1/auth/resend-verification', { method: 'POST' });
      if (response.ok) setVerificationSent(true);
    } finally {
      setVerificationSending(false);
    }
  };

  const loadEntitlements = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingEntitlements(true);
      const res = await fetch('/api/v1/billing');
      if (res.ok) {
        const data = await res.json();
        setEntitlements(data);
      }
    } catch (err) {
      console.error('Failed to load entitlements:', err);
    } finally {
      setLoadingEntitlements(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadEntitlements();
    }
  }, [user, loadEntitlements]);

  // Sync preferences from context or i18n
  useEffect(() => {
    if (preferences) {
      setLocale(preferences.uiLocale || i18nLocale);
      setSelectedMarkets(preferences.preferredMarkets || ['US']);
      setSelectedArchetypes(preferences.preferredBuildTypes || ['LIGHTWEIGHT_TOOL', 'MICRO_SAAS']);
    } else {
      setLocale(i18nLocale);
    }
  }, [preferences, i18nLocale]);

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
      setI18nLocale(locale);
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
    if (!confirm(t('settings.confirmRevokeKey'))) {
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
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // If not logged in
  if (!user) {
    return (
      <PageFrame width="prose" className="text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center border border-line bg-surface-2 text-accent">
          <User className="h-8 w-8" />
        </div>
        <h1 className="font-display text-2xl font-bold text-fg">{t('settings.signInTitle')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
          {t('settings.signInDesc')}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login" className={buttonVariants({ size: 'md', className: 'w-full sm:w-auto' })}>
            {t('nav.login')}
          </Link>
          <Link
            href="/register"
            className={buttonVariants({ variant: 'outline', size: 'md', className: 'w-full sm:w-auto' })}
          >
            {t('nav.signup')}
          </Link>
        </div>
      </PageFrame>
    );
  }

  const userInitials = (user.displayName || user.email)
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Until the entitlements request lands, name the plan from the session payload;
  // afterwards use the subscription-aware read so this card cannot disagree with
  // the quota gauges rendered directly beneath it. Both branches go through
  // `resolvePlanCode`, which prefers the resolved `planCode` the profile now
  // carries over the raw `tier` mirror — falling back to the mirror here would
  // reintroduce the disagreement this branch exists to avoid.
  const currentPlan = entitlements ? resolvePlanCode(entitlements) : resolvePlanCode(user);

  const planTone: 'info' | 'signal' | 'neutral' =
    currentPlan === 'TEAM' ? 'info' : currentPlan === 'PRO' ? 'signal' : 'neutral';

  const dateLocale = isZh ? 'zh-CN' : undefined;

  const billingNote = entitlements?.renewsAt
    ? t('settings.billingRenews', { date: entitlements.renewsAt.slice(0, 10) })
    : currentPlan === 'FREE'
    ? t('settings.billingFree')
    : t('settings.billingLegacy');

  const quotas = entitlements
    ? [
        {
          key: 'projects',
          label: t('pricing.trackedProjects'),
          used: entitlements.currentProjectsCount,
          limit: entitlements.maxProjects,
          tone: 'signal' as const,
          note: t('settings.slotsRemaining', {
            count: Math.max(0, entitlements.maxProjects - entitlements.currentProjectsCount),
          }),
        },
        {
          key: 'reports',
          label: t('pricing.monthlyReports'),
          used: entitlements.reportGenerationUsed,
          limit: entitlements.reportGenerationMonthlyLimit,
          tone: 'accent' as const,
          note: t('settings.generationsRemaining', { count: entitlements.remainingReportGenerations }),
        },
        {
          key: 'exports',
          label: t('pricing.reportExports'),
          used: entitlements.exportReportsUsed,
          limit: entitlements.exportReportsMonthlyLimit,
          tone: 'neutral' as const,
          note: t('settings.exportsRemaining', { count: entitlements.remainingReports }),
        },
        {
          key: 'alerts',
          label: t('pricing.alertRules'),
          used: entitlements.currentAlertsCount,
          limit: entitlements.maxAlerts,
          tone: 'warn' as const,
          note: t('settings.rulesActive', { count: entitlements.currentAlertsCount }),
        },
        {
          key: 'scans',
          label: t('settings.liveScans'),
          used: entitlements.liveScansUsedToday || 0,
          limit: entitlements.liveScanDailyLimit || 3,
          tone: 'warn' as const,
          note: t('settings.scansRemaining', { count: entitlements.remainingLiveScansToday ?? 3 }),
        },
      ]
    : [];

  return (
    <PageFrame width="wide">
      {/* Profile bar — a hairline band, not a floating card. */}
      <section className="flex flex-col justify-between gap-6 border-b border-line pb-8 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <div className="on-inverse flex h-16 w-16 shrink-0 items-center justify-center border border-inverse-line bg-inverse font-display text-xl font-extrabold text-inverse-fg">
            {userInitials}
          </div>
          {/* min-w-0：这个块里是「显示名 + 两枚 nowrap 徽章」和一行 mono 的
              User ID，不给它收缩权限，整块 315px 的 min-content 会连同左侧头像
              把页面顶出 23px。 */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-xl font-bold text-fg sm:text-2xl">
                {user.displayName || user.email.split('@')[0]}
              </h1>
              <Badge tone={planTone}>{t(planLabelKey(currentPlan))}</Badge>
              <Badge tone="accent">{user.role}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-fg-muted">
              <span className="break-all">{user.email}</span>
              <span className="text-fg-subtle">•</span>
              <span className="break-all font-mono text-xs text-fg-subtle">ID: {user.id}</span>
            </p>
          </div>
        </div>

        <Link href="/pricing" className={buttonVariants({ variant: 'outline', size: 'md' })}>
          <CreditCard className="h-3.5 w-3.5" />
          <span>{t('settings.managePlan')}</span>
        </Link>
      </section>

      {/* Tabs navigation */}
      <div
        role="tablist"
        aria-label={t('settings.sectionsAria')}
        className="mb-10 flex items-center gap-1 overflow-x-auto border-b border-line"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          aria-controls="settings-panel-profile"
          onClick={() => setActiveTab('profile')}
          className={tabClass(activeTab === 'profile')}
        >
          <User className="h-4 w-4" />
          <span>{t('settings.tabProfile')}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preferences'}
          aria-controls="settings-panel-preferences"
          onClick={() => setActiveTab('preferences')}
          className={tabClass(activeTab === 'preferences')}
        >
          <Sliders className="h-4 w-4" />
          <span>{t('settings.tabPreferences')}</span>
        </button>

        {user?.role === 'ADMIN' && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'api-keys'}
            aria-controls="settings-panel-api-keys"
            onClick={() => setActiveTab('api-keys')}
            className={tabClass(activeTab === 'api-keys')}
          >
            <KeyRound className="h-4 w-4" />
            <span>{t('settings.tabApiKeys')}</span>
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'billing'}
          aria-controls="settings-panel-billing"
          onClick={() => setActiveTab('billing')}
          className={tabClass(activeTab === 'billing')}
        >
          <CreditCard className="h-4 w-4" />
          <span>{t('settings.tabBilling')}</span>
        </button>
      </div>

      {/* TAB 1: Profile */}
      {activeTab === 'profile' && (
        <div id="settings-panel-profile" role="tabpanel" aria-label={t('settings.tabProfile')} className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <section>
              <h2 className={sectionLabelClass}>{t('settings.accountInfoTitle')}</h2>
              <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t('settings.accountInfoDesc')}</p>

              <div className="mt-6 space-y-5 border-t border-line pt-6">
                {!user.emailVerifiedAt && (
                  <div className="border border-warn/40 bg-warn/10 p-4" role="status">
                    <div className="flex items-start gap-3">
                      <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-fg">{t('settings.verifyEmailTitle')}</p>
                        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t('settings.verifyEmailDesc')}</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={resendVerification}
                          disabled={verificationSending}
                          className="mt-3"
                        >
                          {verificationSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
                          {verificationSending ? t('settings.sending') : t('settings.resendVerification')}
                        </Button>
                        {verificationSent && (
                          <p className="mt-2 text-xs font-medium text-signal">{t('settings.verificationSent')}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <Field label={t('auth.nameLabel')} htmlFor="settings-display-name">
                  <Input
                    id="settings-display-name"
                    name="displayName"
                    autoComplete="name"
                    type="text"
                    readOnly
                    value={user.displayName || ''}
                  />
                </Field>

                <Field label={t('auth.emailLabel')} htmlFor="settings-email">
                  <Input
                    id="settings-email"
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    type="email"
                    readOnly
                    value={user.email}
                  />
                </Field>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel>{t('settings.accountRole')}</FieldLabel>
                    <div className="mt-2 border border-line-control bg-surface px-3 py-2 text-sm font-medium text-fg">
                      {user.role}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t('settings.accountStatus')}</FieldLabel>
                    <div className="mt-2 flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-3 py-2 text-sm font-semibold text-signal">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{user.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            <Panel tone="inverse" className="p-6">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-inverse-fg-subtle">
                {t('settings.currentPlanCard')}
              </span>
              <h3 className="mt-1 font-display text-2xl font-extrabold text-inverse-fg">
                {t(planLabelKey(currentPlan))}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-inverse-fg-muted">{t('settings.currentPlanDesc')}</p>
              <div className="mt-6 flex items-center justify-between border-t border-inverse-line pt-4 text-xs">
                <span className="text-inverse-fg-subtle">{t('settings.entitlements')}</span>
                <span className="font-semibold text-signal">{t('settings.activeValidated')}</span>
              </div>
              <Link href="/pricing" className={cn(buttonVariants({ size: 'sm' }), 'mt-4 w-full')}>
                {t('pricing.upgradeToPro')} →
              </Link>
            </Panel>

            <section className="border-t border-line pt-6">
              <div className="flex items-center gap-1.5 text-xs font-bold text-fg">
                <ShieldCheck className="h-4 w-4 text-signal" />
                <span>{t('settings.securityCard')}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t('settings.securityCardDesc')}</p>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: Preferences */}
      {activeTab === 'preferences' && (
        <form id="settings-panel-preferences" role="tabpanel" aria-label={t('settings.tabPreferences')} onSubmit={handleSavePreferences} className="max-w-3xl space-y-8">
          <section>
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg">
              <Globe className="h-4 w-4 text-accent" />
              {t('settings.targetMarketsTitle')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t('settings.targetMarketsDesc')}</p>
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {TARGET_MARKETS.map((m) => {
                const checked = selectedMarkets.includes(m.id);
                return (
                  <label key={m.id} className={optionCard(checked)}>
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
                    />
                    <span>{isZh ? m.labelZh : m.label}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="border-t border-line pt-6">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg">
              <Layers className="h-4 w-4 text-accent" />
              {t('settings.preferredArchetypesTitle')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t('settings.preferredArchetypesDesc')}</p>
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {BUILD_ARCHETYPES.map((a) => {
                const checked = selectedArchetypes.includes(a.id);
                return (
                  <label key={a.id} className={optionCard(checked)}>
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
                    />
                    <span>{isZh ? a.labelZh : a.label}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="border-t border-line pt-6">
            <h2 className="font-display text-base font-bold text-fg">{t('settings.languageTitle')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t('settings.languageDesc')}</p>
            <Field label={t('settings.languageSelect')} className="mt-4 sm:max-w-xs">
              <Select
                value={locale}
                onChange={(e) => {
                  const nextLoc = e.target.value as Locale;
                  setLocale(nextLoc);
                  setI18nLocale(nextLoc);
                }}
              >
                <option value="zh-CN">简体中文 (Simplified Chinese)</option>
                <option value="en-US">English (United States)</option>
              </Select>
            </Field>
          </section>

          <div className="flex items-center gap-3 border-t border-line pt-6">
            <Button type="submit" disabled={savingPrefs}>
              {savingPrefs ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('common.saving')}</span>
                </>
              ) : (
                <span>{t('settings.savePreferencesBtn')}</span>
              )}
            </Button>
            {prefsSaved && (
              <span className="flex items-center gap-1 text-xs font-semibold text-signal">
                <CheckCircle2 className="h-4 w-4" />
                {t('settings.preferencesUpdated')}
              </span>
            )}
          </div>
        </form>
      )}

      {/* TAB 3: Developer API Keys */}
      {activeTab === 'api-keys' && (
        <div id="settings-panel-api-keys" role="tabpanel" aria-label={t('settings.tabApiKeys')} className="space-y-8">
          {/* Header */}
          <section className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg">
                <Code2 className="h-5 w-5 text-accent" />
                {t('settings.apiKeysTitle')}
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted">{t('settings.apiKeysDesc')}</p>
            </div>

            <form onSubmit={handleCreateApiKey} className="flex items-center gap-2">
              <Input
                id="api-key-label"
                name="apiKeyLabel"
                autoComplete="off"
                type="text"
                placeholder={t('settings.keyLabelPlaceholder')}
                maxLength={60}
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                className="w-full sm:w-64"
              />
              <Button type="submit" size="sm" disabled={isGeneratingKey} className="shrink-0">
                {isGeneratingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                <span>{t('settings.generateKeyBtn')}</span>
              </Button>
            </form>
          </section>

          {keyError && (
            <Panel tone="raised" className="flex items-center gap-2 border-danger/40 p-4 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
              <span>{keyError}</span>
            </Panel>
          )}

          {/* One-time secret display */}
          {generatedSecret && (
            <Panel tone="raised" className="border-warn/40 p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-warn">
                  <AlertCircle className="h-4 w-4" />
                  {t('settings.saveSecretTitle')}
                </span>
                <button
                  type="button"
                  onClick={() => setGeneratedSecret(null)}
                  className="text-xs font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {t('common.close')}
                </button>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-fg-muted">{t('settings.secretWarning')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all overflow-x-auto border border-line-control bg-surface px-3 py-2 font-mono text-xs text-fg">
                  {generatedSecret}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopySecret} className="shrink-0">
                  {copiedKey ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>{t('settings.copiedKeyBtn')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>{t('settings.copyKeyBtn')}</span>
                    </>
                  )}
                </Button>
              </div>
            </Panel>
          )}

          {/* Keys list */}
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-4">
              <span className={sectionLabelClass}>
                {t('settings.activeKeys')} ({apiKeys.length})
              </span>
              <button
                type="button"
                onClick={loadApiKeys}
                className="flex items-center gap-1 text-xs text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <RefreshCw className="h-3 w-3" />
                <span>{t('settings.refresh')}</span>
              </button>
            </div>

            {loadingKeys ? (
              <div className="p-8 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
                <span className="mt-2 block text-xs text-fg-subtle">{t('settings.loadingKeys')}</span>
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="p-12 text-center">
                <KeyRound className="mx-auto mb-2 h-8 w-8 text-fg-subtle" />
                <p className="text-sm font-semibold text-fg">{t('settings.noKeys')}</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('settings.noKeysDesc')}</p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {apiKeys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt);
                  return (
                    <div
                      key={key.id}
                      className="flex flex-col justify-between gap-3 p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:px-6"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-fg">{key.label}</span>
                          {isRevoked ? (
                            <Badge tone="danger">REVOKED</Badge>
                          ) : (
                            <Badge tone="signal" dot>ACTIVE</Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
                          <code className="font-mono text-fg-muted">{key.keyPrefix}</code>
                          <span>•</span>
                          <span>{t('settings.keyCreatedAt', { date: new Date(key.createdAt).toLocaleDateString(dateLocale) })}</span>
                          {key.lastUsedAt && (
                            <>
                              <span>•</span>
                              <span>{t('settings.keyLastUsedAt', { date: new Date(key.lastUsedAt).toLocaleDateString(dateLocale) })}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {!isRevoked && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => handleRevokeApiKey(key.id)}
                          className="self-start sm:self-auto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{t('settings.revokeBtn')}</span>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* cURL example */}
          <Panel tone="inverse" className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-inverse-fg-subtle">
                {t('settings.apiExampleTitle')}
              </span>
              <span className="font-mono text-xs text-signal">REST / JSON</span>
            </div>
            <pre className="overflow-x-auto bg-overlay p-3 font-mono text-xs text-signal">
{`curl -X GET "https://emeradar.com/api/v1/opportunities?verdict=GO_SIGNAL&limit=10" \\
  -H "Authorization: Bearer emd_live_YOUR_SECRET_KEY" \\
  -H "Accept: application/json"`}
            </pre>
          </Panel>
        </div>
      )}

      {/* TAB 4: Billing & Quotas */}
      {activeTab === 'billing' && (
        <div id="settings-panel-billing" role="tabpanel" aria-label={t('settings.tabBilling')} className="space-y-8">
          <section className="border-b border-line pb-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  {t('settings.subscriptionStatus')}
                </span>
                <h2 className="mt-1 font-display text-2xl font-extrabold text-fg">
                  {t(planLabelKey(currentPlan))}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{billingNote}</p>
              </div>

              <Link
                href="/pricing"
                className={buttonVariants({ size: 'md', className: 'self-start sm:self-auto' })}
              >
                {t('settings.changePlan')}
              </Link>
            </div>
          </section>

          {/* Quota meters */}
          {loadingEntitlements && !entitlements ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
            </div>
          ) : entitlements ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
              {quotas.map((quota) => (
                <div key={quota.key} className="border-t border-line pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={sectionLabelClass}>{quota.label}</span>
                    <span className="font-mono text-xs font-bold tabular-nums text-fg">
                      {quota.used} / {quota.limit}
                    </span>
                  </div>
                  <Meter className="mt-3" value={quota.used} max={quota.limit} tone={quota.tone} />
                  <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">{quota.note}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-subtle">—</p>
          )}
        </div>
      )}
    </PageFrame>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
