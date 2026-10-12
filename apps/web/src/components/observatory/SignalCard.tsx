import Link from 'next/link';
import { AxisBadge, Badge, VerdictBadge, type Band, type Verdict } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import type { FeedCardItem } from '@emeradar/services';

/**
 * One published opportunity.
 *
 * The three axes render as bands (docs/16 §3.2): the previous markup divided
 * basis points by 100 and printed `74/100` next to a progress bar, which the PRD
 * explicitly forbids.
 */
export function SignalCard({
  card,
  labels,
}: {
  card: FeedCardItem;
  labels: { report: string; workspace: string };
}) {
  return (
    <Panel brackets className="flex flex-col p-6">
      <div className="flex items-center justify-between gap-3">
        <VerdictBadge verdict={card.verdict as Verdict} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
          {card.recommendedArchetype}
        </span>
      </div>

      <h3 className="mt-5 text-base font-semibold leading-snug text-fg">{card.title}</h3>
      <p className="mt-2 truncate font-mono text-xs text-fg-subtle">{`\`${card.primaryQuery}\``}</p>

      <p className="mt-4 text-xs leading-relaxed text-fg-muted">{card.whyNowSummary}</p>

      <div className="mt-4 bg-canvas/60 p-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">
          CONCEPT
        </span>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{card.topIdea}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <AxisBadge axis="d" band={card.dBand as Band} />
        <AxisBadge axis="m" band={card.mBand as Band} />
        <AxisBadge axis="w" band={card.wBand as Band} />
        <Badge tone="neutral">{`CONF ${card.confidence}`}</Badge>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 font-mono text-[11px]">
        <Link href={`/opportunities/${card.slug}/report`} className="text-fg-muted transition-colors hover:text-fg">
          {labels.report}
        </Link>
        <Link href={`/opportunities/${card.slug}`} className="font-bold text-accent transition-colors hover:brightness-110">
          {labels.workspace} →
        </Link>
      </div>
    </Panel>
  );
}
