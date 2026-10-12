import { Panel } from '@/components/ui/Panel';

/**
 * Replaces `report_preview.jpg`, a screenshot of the report UI. Re-shooting that
 * image has to wait until the app pages are migrated, so for now the section
 * shows the report's *structure* drawn in code.
 *
 * It deliberately contains no numbers: a skeleton with plausible figures would
 * read as real report content, which docs/15 forbids on public pages.
 */

const sections = [
  { id: '01', label: 'WHY NOW', lines: ['w-full', 'w-11/12', 'w-2/3'] },
  { id: '02', label: 'SERP GAPS', lines: ['w-full', 'w-5/6'] },
  { id: '03', label: 'ARCHETYPE', lines: ['w-full', 'w-3/4', 'w-1/2'] },
  { id: '04', label: 'KILL CRITERIA', lines: ['w-full', 'w-2/3'] },
];

export function ReportSkeleton({ caption }: { caption: string }) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        <span>REPORT · STRUCTURE</span>
        <span className="text-signal">DRAFT</span>
      </div>

      <div className="divide-y divide-line">
        {sections.map((section) => (
          <div key={section.id} className="flex items-start gap-5 px-5 py-5">
            <div className="w-24 shrink-0">
              <div className="font-mono text-[10px] tracking-[0.16em] text-fg-subtle">SEC {section.id}</div>
              <div className="mt-1 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                {section.label}
              </div>
            </div>
            <div className="flex-1 space-y-3 pt-1.5">
              {section.lines.map((width, index) => (
                <div key={index} className={`h-px bg-line-strong ${width}`} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="border-t border-line px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
        {caption}
      </p>
    </Panel>
  );
}
