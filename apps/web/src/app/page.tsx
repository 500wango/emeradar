import Link from 'next/link';
import { ArrowRight, Search, ShieldCheck, Zap } from 'lucide-react';
import { Logo } from '@/components/Logo';

export default async function HomePage() {
  return (
    <div className="flex flex-col">
      <section className="border-b border-slate-200 bg-white pt-16 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Logo variant="full" className="h-16 w-auto" idPrefix="hero-main" />
          <p className="mt-8 text-xs font-bold uppercase tracking-widest text-blue-700">
            US English search · decisions, not keyword audits
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
            Decide what to build before the window closes.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Emeradar watches a query until demand, commercial proof, and the competitive
            window are each evidenced. Today’s feed publishes only those decisions.
            A query you just submitted is an observation, not a verdict.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/feed"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Today’s decisions
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/methodology"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              How a verdict is published
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Free and Pro
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Search,
              title: 'Demand',
              body: 'Whether the query cluster is forming across repeated autocomplete observations. One snapshot is insufficient, not high.',
            },
            {
              icon: ShieldCheck,
              title: 'Commercial proof',
              body: 'Observed pricing or checkout on independent domains. A payment button is not revenue. A commercial word in the query is not proof.',
            },
            {
              icon: Zap,
              title: 'Window',
              body: 'Scored only on a single-source organic SERP. WINDOW CLOSING means a published build decision later got harder, not that today looks competitive.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <item.icon className="w-5 h-5 text-blue-700" />
              <h2 className="mt-4 text-base font-bold text-slate-900">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Published BUILD NOW</h2>
              <p className="mt-1 text-sm text-slate-500">
                At most a small share of tracked opportunities. Empty means the gate held.
              </p>
            </div>
            <Link href="/feed" className="text-sm font-semibold text-blue-700 hover:underline">
              Open the feed
            </Link>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
            Published decisions are available inside the authenticated decision feed.
            Candidates stay out of that list until they have enough history.{' '}
            <Link href="/login?next=%2Ffeed" className="font-semibold text-blue-700 hover:underline">
              Sign in to view the feed
            </Link>
            .
          </div>
        </div>
      </section>
    </div>
  );
}
