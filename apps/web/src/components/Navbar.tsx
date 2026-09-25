import Link from 'next/link';
import {
  Radar,
  FileCheck2,
  FolderKanban,
  Bell,
  CreditCard,
  Sparkles,
} from 'lucide-react';

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Radar className="w-5 h-5 animate-pulse" />
              </div>
              <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                Emeradar
              </span>
            </Link>

            {/* Nav Links */}
            <nav className="hidden md:flex items-center gap-1">
              <Link
                href="/feed"
                className="px-3.5 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Radar className="w-4 h-4 text-blue-500" />
                Opportunities
              </Link>
              <Link
                href="/track-record"
                className="px-3.5 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <FileCheck2 className="w-4 h-4 text-emerald-500" />
                Track Record
              </Link>
              <Link
                href="/projects"
                className="px-3.5 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <FolderKanban className="w-4 h-4 text-indigo-500" />
                Projects
              </Link>
              <Link
                href="/alerts"
                className="px-3.5 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Bell className="w-4 h-4 text-amber-500" />
                Radar Alerts
              </Link>
              <Link
                href="/billing"
                className="px-3.5 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <CreditCard className="w-4 h-4 text-slate-400" />
                Plans & Quotas
              </Link>
            </nav>
          </div>

          {/* User & Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/billing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Builder Pro Tier</span>
            </Link>

            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center border border-blue-200">
                SB
              </div>
              <span className="text-xs font-medium text-slate-600 hidden sm:inline">
                pro@emeradar.com
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
