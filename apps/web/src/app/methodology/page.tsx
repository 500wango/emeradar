import Link from 'next/link';

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Methodology</p>
      <h1 className="mt-2 text-3xl font-extrabold text-slate-900 tracking-tight">
        How a decision gets published
      </h1>
      <p className="mt-4 text-sm text-slate-600 leading-relaxed">
        Emeradar tells an independent builder whether to ship into a US English search
        market. A row becomes a decision only after the system has watched it. The first
        time a query is seen, it is an observation.
      </p>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">From signal to published record</h2>
        <ol className="grid gap-3 sm:grid-cols-5 list-decimal pl-5">
          <li>Search signals reveal an emerging query.</li>
          <li>The query becomes a candidate, not a verdict.</li>
          <li>The system observes it for at least 14 days.</li>
          <li>Demand, commercial proof, and entry window are measured.</li>
          <li>Only qualified decisions enter the public track record.</li>
        </ol>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">Publication gate</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Autocomplete history of at least 14 days before demand can leave “insufficient”.</li>
          <li>One single-source organic SERP snapshot, also covering at least 14 days, before the window is scored.</li>
          <li>Commercial “high” requires observed pricing or checkout on two or more independent domains. Words such as “pricing” or “tool” in the query do not count.</li>
          <li>A failed source stays failed. An empty response is not a weak market and is not a closed window.</li>
        </ul>
        <p>
          Until those conditions hold, the record is a candidate: verdict WATCH, confidence
          low, hidden from the decision feed. GO and report export stay off.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">The three bands</h2>
        <p>
          Demand asks whether the query cluster is forming. Commercial proof asks whether
          money is already moving. Window asks whether the organic results are still thin.
          Bands are High, Medium, Low, or Insufficient. Insufficient is not Low, and it
          cannot produce BUILD NOW.
        </p>
        <p>
          WINDOW CLOSING is only a later state of a BUILD NOW or EARLY BET whose window
          band dropped. A new query with strong incumbents is not “closing”; it was never open
          in this ledger.
        </p>
        <p>
          EARLY BET means demand and window are high, and commercial proof is not. The card
          says the commercial case is unverified.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm text-slate-700 leading-relaxed">
        <h2 className="text-lg font-bold text-slate-900">What the pages will not claim</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>No accuracy percentage until the public track record shows both hits and misses, with the sample size and the 30/60/90 day horizon.</li>
          <li>News, repositories, Q&amp;A, and encyclopedia rows are labeled as those sources. They are not renumbered into a Google Top 10.</li>
          <li>A payment button proves a checkout exists. It does not prove revenue.</li>
          <li>BUILD NOW is meant to stay scarce: at most about 5% of published opportunities.</li>
        </ul>
      </section>

      <p className="mt-10 text-sm">
        <Link href="/feed" className="font-semibold text-blue-700 hover:underline">
          Back to today’s decisions
        </Link>
      </p>
    </div>
  );
}
