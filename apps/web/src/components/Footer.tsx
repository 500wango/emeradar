import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="bg-white border-t border-slate-200 mt-20">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo variant="header" className="h-7 w-auto" idPrefix="footer" />
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">
              Search Opportunity Intelligence & Commercial Signal Radar for Builders
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Cryptographic Merkle Proofs Active</span>
            </div>
            <Link href="/track-record" className="hover:text-blue-600 transition-colors">
              Verifiable Track Record
            </Link>
            <Link href="/feed" className="hover:text-blue-600 transition-colors">
              Live Feed
            </Link>
            <Link href="/billing" className="hover:text-blue-600 transition-colors">
              Pricing
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} Emeradar Systems. All rights reserved. Append-only ledger protocol sc-1.0.0.</p>
          <p>Built for indie builders, bootstrap hackers, and micro-SaaS teams.</p>
        </div>
      </div>
    </footer>
  );
}
