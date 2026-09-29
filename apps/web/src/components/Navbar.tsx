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
  Sparkles,
  Settings,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '@/lib/auth-context';

export function Navbar() {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();
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

  const tierBadgeConfig = {
    TEAM: {
      label: 'Team Scale',
      classes: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
    },
    PRO: {
      label: 'Builder Pro',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    },
    FREE: {
      label: 'Free Starter',
      classes: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
    },
  };

  const currentTierConfig = user ? tierBadgeConfig[user.tier] : tierBadgeConfig.PRO;

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center group py-1">
              <Logo
                variant="header"
                className="h-9 w-auto group-hover:opacity-95 transition-opacity"
                idPrefix="nav"
              />
            </Link>

            {/* Nav Links */}
            <nav className="hidden md:flex items-center gap-1">
              <Link
                href="/feed"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  pathname.startsWith('/feed') || pathname.startsWith('/opportunities')
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                <Radar className="w-4 h-4 text-blue-500" />
                Opportunities
              </Link>
              <Link
                href="/track-record"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  pathname === '/track-record'
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                <FileCheck2 className="w-4 h-4 text-emerald-500" />
                Track Record
              </Link>
              <Link
                href="/projects"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  pathname === '/projects'
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                <FolderKanban className="w-4 h-4 text-indigo-500" />
                Projects
              </Link>
              <Link
                href="/alerts"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  pathname === '/alerts'
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                <Bell className="w-4 h-4 text-amber-500" />
                Radar Alerts
              </Link>
              <Link
                href="/methodology"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  pathname === '/methodology'
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                Methodology
              </Link>
              <Link
                href="/pricing"
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  pathname === '/pricing' || pathname === '/billing'
                    ? 'text-blue-600 bg-blue-50/70 font-semibold'
                    : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-4 h-4 text-slate-400" />
                Pricing
              </Link>
            </nav>
          </div>

          {/* User & Auth Actions */}
          <div className="flex items-center gap-3">
            {isLoading ? (
              <div className="h-8 w-24 bg-slate-100 animate-pulse rounded-full" />
            ) : user ? (
              <>
                {/* Tier Badge Link */}
                <Link
                  href="/billing"
                  className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${currentTierConfig.classes}`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{currentTierConfig.label}</span>
                </Link>

                {/* Profile Pill & Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center gap-2 pl-2 sm:pl-3 py-1 pr-1.5 rounded-full border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-sm">
                      {initials}
                    </div>
                    <span className="text-xs font-semibold text-slate-700 hidden sm:inline max-w-[120px] truncate">
                      {user.displayName || user.email.split('@')[0]}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {/* Dropdown Menu */}
                  {dropdownOpen && (
                    <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50 py-2 z-50">
                      {/* User Info Header */}
                      <div className="px-4 py-3 border-b border-slate-100">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {user.displayName || 'Builder'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${currentTierConfig.classes}`}
                          >
                            {user.tier}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                            {user.role}
                          </span>
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="py-1">
                        <Link
                          href="/settings"
                          className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                        >
                          <Settings className="w-4 h-4 text-slate-400" />
                          <span>Account & Settings</span>
                        </Link>
                        <Link
                          href="/projects"
                          className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                        >
                          <FolderKanban className="w-4 h-4 text-slate-400" />
                          <span>My Projects</span>
                        </Link>
                        <Link
                          href="/alerts"
                          className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                        >
                          <Bell className="w-4 h-4 text-slate-400" />
                          <span>Radar Alerts</span>
                        </Link>
                        <Link
                          href="/billing"
                          className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                        >
                          <CreditCard className="w-4 h-4 text-slate-400" />
                          <span>Plans & Invoices</span>
                        </Link>
                      </div>

                      {/* Logout */}
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          onClick={logout}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                        >
                          <LogOut className="w-4 h-4 text-rose-500" />
                          <span>Sign Out</span>
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
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition"
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 transition"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
