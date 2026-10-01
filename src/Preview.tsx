import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { clock, fmt } from './schedule';
import type { RunResult } from './types';

const DOT: Record<string, string> = { program: "bg-[var(--phosphor)]", ad: "bg-[var(--amber)]", gap: "bg-[var(--phosphor-dim)]" };

interface Props { result: RunResult; sm: number; onRoll: () => void; onPlay: () => void }

export default function Preview({ result, sm, onRoll, onPlay }: Props) {
  const { rows, end } = result;
  return (
    <Card accent={false}>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardAction className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onRoll}>Roll a run</Button>
          <Button size="sm" variant="primary" onClick={onPlay}>▶ Open in player</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length ? <>
          {rows.map((r, idx) => r.info
            ? <div key={idx} className={`pl-24 text-xs ${r.warn ? "text-[var(--warning)]" : "text-[var(--phosphor-dim)]"}`}>{r.info}</div>
            : r.err
              ? <div key={idx} className="flex gap-2 border-b border-[var(--phosphor-dim)]/40 py-1.5 text-sm text-[var(--warning)]"><span className="w-24 shrink-0">—</span>{r.err}</div>
              : <div key={idx} className={`flex items-baseline gap-2 border-b border-[var(--phosphor-dim)]/40 py-1.5 text-sm ${r.kind === "gap" ? "text-[var(--phosphor-dim)]" : ""}`}>
                  <span className="w-24 shrink-0 tabular-nums text-[var(--phosphor-dim)]">{clock(sm + r.t)}</span>
                  <span className={`size-2.5 shrink-0 ${DOT[r.kind ?? "gap"]}`} />
                  <span className="min-w-0">{r.title} <small className="text-[var(--phosphor-dim)]">{[r.type, r.note, fmt(r.dur ?? 0)].filter(Boolean).join(" · ")}</small></span>
                </div>)}
          <div className="flex gap-2 py-1.5 text-sm font-semibold"><span className="w-24 shrink-0 tabular-nums">{clock(sm + end)}</span>Ends · {fmt(end)} total</div>
        </> : <p className="text-sm text-[var(--phosphor-dim)]">Add blocks to see a sample run.</p>}
      </CardContent>
    </Card>
  );
}
