'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Radar,
  FileCheck2,
  FolderKanban,
  Bell,
  CreditCard,
  Settings,
  LogOut,
  ChevronDown,
  ShieldAlert,
  Layers,
  Radio,
  Users,
} from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { planLabelKey } from '@/lib/plan-display';
import { LanguageSwitcher } from './LanguageSwitcher';
import { cn } from '@/lib/cn';

/**
 * Colours come from semantic tokens only, so the markup carries no theme
 * assumptions of its own.
 */
export function Navbar() {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();
  const { t, isZh } = useI18n();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'ANALYST';
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setDropdownOpen(false);
  }, [pathname]);

  const initials = user
    ? (user.displayName || user.email)
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'EM';

  // Colour stays per-tier; the wording comes from the shared mapping so a legacy
  // TEAM account reads "Legacy plan" here too instead of the raw enum.
  const tierBadgeClasses: Record<string, string> = {
    TEAM: 'bg-surface-2 text-fg-muted border-line',
    PRO: 'bg-signal/10 text-signal border-signal/40',
    FREE: 'bg-surface-2 text-fg-muted border-line',
  };
  const currentTier = user?.tier ?? 'PRO';
  const currentTierClasses = tierBadgeClasses[currentTier] ?? tierBadgeClasses.FREE;
  const currentTierLabel = t(planLabelKey(currentTier));

  const navItem = 'px-3.5 py-2 text-sm rounded-sm transition-colors flex items-center gap-1.5';
  const navActive = 'bg-accent/10 text-accent font-semibold';
  const navIdle = 'text-fg-muted font-medium hover:text-accent hover:bg-surface-2';
  const navIcon = 'h-4 w-4 shrink-0 opacity-70';

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-8">
            <Link href="/" className="group flex items-center py-1">
              <Logo
                variant="header"
                className="h-7 w-auto transition-opacity group-hover:opacity-95 sm:h-9"
                idPrefix="nav"
              />
            </Link>

            {/* Nav Links */}
            <nav className="hidden items-center gap-1 md:flex">
              {isAdmin ? (
                <>
                  <Link
                    href="/admin"
                    className={cn(navItem, pathname === '/admin' ? navActive : navIdle)}
                  >
                    <ShieldAlert className={navIcon} />
                    <span>{isZh ? '流水线大屏' : 'Pipeline Ops'}</span>
                  </Link>
                  <Link
                    href="/admin/candidates"
                    className={cn(
                      navItem,
                      pathname === '/admin/candidates' ? navActive : navIdle
                    )}
                  >
                    <Layers className={navIcon} />
                    <span>{isZh ? '候选池治理' : 'Candidate Pool'}</span>
                  </Link>
                  <Link
                    href="/admin/sources"
                    className={cn(navItem, pathname === '/admin/sources' ? navActive : navIdle)}
                  >
                    <Radio className={navIcon} />
                    <span>{isZh ? '采集源配置' : 'Sources & Feeds'}</span>
                  </Link>
                  <Link
                    href="/admin/users"
                    className={cn(navItem, pathname === '/admin/users' ? navActive : navIdle)}
                  >
                    <Users className={navIcon} />
                    <span>{isZh ? '用户与权限' : 'Users & Access'}</span>
                  </Link>
                  <Link
                    href="/feed"
                    className={cn(navItem, pathname.startsWith('/feed') ? navActive : navIdle)}
                  >
                    <Radar className={navIcon} />
                    <span>{isZh ? '前台预览' : 'Live Feed'}</span>
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/feed"
                    className={cn(
                      navItem,
                      pathname.startsWith('/feed') || pathname.startsWith('/opportunities')
                        ? navActive
                        : navIdle
                    )}
                  >
                    <Radar className={navIcon} />
                    {t('nav.opportunities')}
                  </Link>
                  <Link
                    href="/track-record"
                    className={cn(navItem, pathname === '/track-record' ? navActive : navIdle)}
                  >
                    <FileCheck2 className={navIcon} />
                    {t('nav.trackRecord')}
                  </Link>
                  <Link
                    href="/projects"
                    className={cn(navItem, pathname === '/projects' ? navActive : navIdle)}
                  >
                    <FolderKanban className={navIcon} />
                    {t('nav.projects')}
                  </Link>
                  <Link
                    href="/alerts"
                    className={cn(navItem, pathname === '/alerts' ? navActive : navIdle)}
                  >
                    <Bell className={navIcon} />
                    {t('nav.alerts')}
                  </Link>
                  <Link
                    href="/methodology"
                    className={cn(navItem, pathname === '/methodology' ? navActive : navIdle)}
                  >
                    {t('nav.methodology')}
                  </Link>
                  <Link
                    href="/pricing"
                    className={cn(
                      navItem,
                      pathname === '/pricing' || pathname === '/billing' ? navActive : navIdle
                    )}
                  >
                    <CreditCard className={navIcon} />
                    {t('nav.pricing')}
                  </Link>
                </>
              )}
            </nav>
          </div>

          {/* User & Auth Actions & Language Switcher */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* The dropdown variant carries a text label; below `sm` it plus the
                auth buttons together overran the bar and crushed them, so the
                label collapses to the compact `EN / 中文` toggle there. */}
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <div className="sm:hidden">
              <LanguageSwitcher variant="minimal" />
            </div>

            {isLoading ? (
              <div className="h-8 w-24 animate-pulse rounded-full bg-surface-2" />
            ) : user ? (
              <>
                {/* Tier badge removed from navbar — visible in profile dropdown only */}

                {/* Profile Pill & Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    aria-expanded={dropdownOpen}
                    aria-controls="account-menu"
                    className="flex items-center gap-2 rounded-full border border-line-control py-1 pl-2 pr-1.5 transition-colors hover:border-accent hover:bg-surface-2 sm:pl-3"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">
                      {initials}
                    </div>
                    <span className="hidden max-w-[120px] truncate text-xs font-semibold text-fg-muted sm:inline">
                      {user.displayName || user.email.split('@')[0]}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />
                  </button>

                  {/* Dropdown Menu */}
                  {dropdownOpen && (
                    <div
                      id="account-menu"
                      className="absolute right-0 z-50 mt-2 w-64 rounded-sm border border-line bg-surface py-2 shadow-xl"
                    >
                      {/* User Info Header */}
                      <div className="border-b border-line px-4 py-3">
                        <div className="truncate text-xs font-bold text-fg">
                          {user.displayName || 'Builder'}
                        </div>
                        <div className="truncate text-[11px] text-fg-subtle">{user.email}</div>
                        <div className="mt-2 flex items-center gap-1.5">
                          {isAdmin ? (
                            <span className="rounded-sm bg-warn px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-warn-fg">
                              SYSTEM ADMIN
                            </span>
                          ) : (
                            <>
                              <span
                                className={cn(
                                  'rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]',
                                  currentTierClasses
                                )}
                              >
                                {currentTierLabel}
                              </span>
                              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                                {user.role}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Menu Items */}
                      {isAdmin ? (
                        <div className="py-1">
                          <Link
                            href="/admin"
                            className="flex items-center gap-2.5 bg-accent/10 px-4 py-2 text-xs font-bold text-accent transition-colors hover:bg-accent/15"
                          >
                            <ShieldAlert className="h-4 w-4" />
                            <span>{isZh ? '雷达运维大屏' : 'Pipeline Dashboard'}</span>
                          </Link>
                          <Link
                            href="/admin/candidates"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Layers className="h-4 w-4 text-fg-subtle" />
                            <span>{isZh ? '候选生态位治理' : 'Candidate Pool'}</span>
                          </Link>
                          <Link
                            href="/admin/sources"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Radio className="h-4 w-4 text-fg-subtle" />
                            <span>{isZh ? '采集源与 RSS 配置' : 'Sources & Feeds'}</span>
                          </Link>
                          <Link
                            href="/admin/users"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Users className="h-4 w-4 text-fg-subtle" />
                            <span>{isZh ? '用户与权限治理' : 'Users & Permissions'}</span>
                          </Link>
                          <Link
                            href="/feed"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Radar className="h-4 w-4 text-fg-subtle" />
                            <span>{isZh ? '前台决策流预览' : 'Browse Live Feed'}</span>
                          </Link>
                        </div>
                      ) : (
                        <div className="py-1">
                          <Link
                            href="/settings"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Settings className="h-4 w-4 text-fg-subtle" />
                            <span>{t('nav.accountSettings')}</span>
                          </Link>
                          <Link
                            href="/projects"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <FolderKanban className="h-4 w-4 text-fg-subtle" />
                            <span>{t('nav.myProjects')}</span>
                          </Link>
                          <Link
                            href="/alerts"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <Bell className="h-4 w-4 text-fg-subtle" />
                            <span>{t('nav.alerts')}</span>
                          </Link>
                          <Link
                            href="/billing"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            <CreditCard className="h-4 w-4 text-fg-subtle" />
                            <span>{t('nav.billing')}</span>
                          </Link>
                        </div>
                      )}

                      {/* Logout */}
                      <div className="border-t border-line pt-1">
                        <button
                          type="button"
                          onClick={logout}
                          className="flex w-full items-center gap-2.5 px-4 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>{t('nav.logout')}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  href="/register"
                  className="whitespace-nowrap rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg transition-colors hover:brightness-110"
                >
                  {t('nav.signup')}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
