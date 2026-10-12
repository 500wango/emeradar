import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/admin-auth';
import {
  Activity,
  Layers,
  Radio,
  Users,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';
import { getServerI18n } from '@/lib/i18n/server';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const { t } = await getServerI18n();

  const navItems = [
    { href: '/admin', icon: Activity, label: t('admin.navPipeline'), iconTone: 'text-accent' },
    { href: '/admin/candidates', icon: Layers, label: t('admin.navCandidates'), iconTone: 'text-signal' },
    { href: '/admin/sources', icon: Radio, label: t('admin.navSources'), iconTone: 'text-warn' },
    { href: '/admin/users', icon: Users, label: t('admin.navUsers'), iconTone: 'text-info' },
  ];

  return (
    <div className="flex flex-col bg-canvas text-fg">
      {/* Top Admin Bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-warn/40 bg-warn/20 text-warn">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black tracking-wide text-fg">
                      EMERADAR OPS
                    </span>
                    <Badge tone="warn">{session.user.role}</Badge>
                  </div>
                  <p className="font-mono text-[10px] text-fg-subtle">
                    Radar Command &amp; Governance Console
                  </p>
                </div>
              </div>

              {/* Navigation Tabs */}
              <nav className="ml-6 hidden items-center gap-1.5 border-l border-line pl-6 md:flex">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                    >
                      <Icon className={`h-3.5 w-3.5 ${item.iconTone}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Back to User Portal */}
            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-xs text-fg-subtle sm:inline">
                {session.user.email}
              </span>
              <Link href="/feed" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{t('admin.backToApp')}</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-line py-4 text-center font-mono text-xs text-fg-subtle">
        Emeradar Operations Console · Strictly Restricted Access
      </footer>
    </div>
  );
}
