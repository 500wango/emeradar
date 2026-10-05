import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/admin-auth';
import {
  Activity,
  Layers,
  Radio,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';
import { getServerI18n } from '@/lib/i18n/server';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const { isZh } = await getServerI18n();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Admin Bar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black tracking-wide text-white">
                      EMERADAR OPS
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                      {session.user.role}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Radar Command & Governance Console
                  </p>
                </div>
              </div>

              {/* Navigation Tabs */}
              <nav className="hidden md:flex items-center gap-1.5 ml-6 pl-6 border-l border-slate-800">
                <Link
                  href="/admin"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-1.5"
                >
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  <span>{isZh ? '流水线与大屏' : 'Pipeline & Health'}</span>
                </Link>
                <Link
                  href="/admin/candidates"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{isZh ? '候选池治理' : 'Candidate Pool'}</span>
                </Link>
                <Link
                  href="/admin/sources"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-1.5"
                >
                  <Radio className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isZh ? '采集源配置' : 'Sources & Feeds'}</span>
                </Link>
              </nav>
            </div>

            {/* Back to User Portal */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 hidden sm:inline font-mono">
                {session.user.email}
              </span>
              <Link
                href="/feed"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 bg-slate-800/80 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{isZh ? '返回前台' : 'Back to App'}</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-500 font-mono">
        Emeradar Operations Console · Strictly Restricted Access
      </footer>
    </div>
  );
}
