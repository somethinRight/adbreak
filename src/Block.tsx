import type { KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import Field from '@/components/Field';
import Pick from '@/components/Pick';
import type { Block as BlockT, MediaItem, Picker as PickerT } from './types';

type Patch = Partial<PickerT & { at: string; total: number; pos: number; every: number }>;
type SetFn = (id: string, patch: Patch) => void;

const MODES = [{ value: "specific", label: "Specific media" }, { value: "filter", label: "Filter library" }];
const AMBER = "var(--amber)";
const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, +v || lo));

/** Shared by blocks and ad-break slots: specific media or combined type/tag filters. */
function Picker({ b, lib, set, hideCount }: { b: PickerT; lib: MediaItem[]; set: SetFn; hideCount: boolean }) {
  const types = [...new Set(lib.map(m => m.type))].sort().map(t => ({ value: t, label: t }));
  const media = lib.map(m => ({ value: m.id, label: `${m.title} (${m.type})` }));
  const addTag = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = e.currentTarget.value.trim().toLowerCase();
    if (v && !b.tags.includes(v)) set(b.id, { tags: [...b.tags, v] });
    e.currentTarget.value = "";
  };
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <Field label="Pick"><Pick label="Pick mode" value={b.mode} options={MODES} onChange={v => set(b.id, { mode: v as PickerT["mode"] })} /></Field>
        {b.mode === "specific" && <Field label="Media"><Pick label="Media" value={b.mediaId || null} options={media} placeholder="Choose…" onChange={v => set(b.id, { mediaId: v })} /></Field>}
        {b.mode === "filter" && <Field label="Media type"><Pick label="Media type" value={b.type} options={[{ value: "", label: "Any type" }, ...types]} onChange={v => set(b.id, { type: v })} /></Field>}
        {b.mode === "filter" && (
          <Field label="Tags" className="sm:col-span-2">
            <Input list="taglist" placeholder="Type a tag, press Enter" onKeyDown={addTag} />
            <div className="flex flex-wrap gap-1 pt-1">
              {b.tags.map((t, i) => (
                <Badge key={t} variant="outline">{t}
                  <button className="ml-1" aria-label={`Remove ${t}`} onClick={() => set(b.id, { tags: b.tags.filter((_, j) => j !== i) })}>×</button></Badge>
              ))}
            </div>
          </Field>
        )}
        {b.mode !== "specific" && !hideCount && (
          <Field label={b.kind === "ad" ? "Spots" : "Items"} className="sm:w-20">
            <Input type="number" min="1" max="20" value={b.count} onChange={e => set(b.id, { count: num(e.target.value, 1, 20) })} />
          </Field>
        )}
      </div>
      {b.mode === "filter" && (
        <div className="flex items-center gap-2 text-xs text-[var(--phosphor-dim)]">Match
          <Pick size="sm" className="w-20" label="Match" value={b.match} options={[{ value: "any", label: "any" }, { value: "all", label: "all" }]} onChange={v => set(b.id, { match: v as PickerT["match"] })} />
          of these tags</div>
      )}
    </div>
  );
}

interface Props { b: BlockT; i: number; n: number; lib: MediaItem[]; set: SetFn; act: (id: string, a: "up" | "down" | "dup" | "del") => void; addSlot: (id: string) => void; onSaveBlock: (block: BlockT) => void }

export default function Block({ b, i, n, lib, set, act, addSlot, onSaveBlock }: Props) {
  const isAd = b.kind === "ad";
  return (
    <Card accent={isAd ? AMBER : undefined}>
      <CardHeader>
        <CardTitle>{isAd ? "Ad block" : "Programming"}</CardTitle>
        <CardAction className="flex gap-1">
          <Button variant="outline" size="icon-sm" disabled={i === 0} aria-label="Move up" onClick={() => act(b.id, "up")}>↑</Button>
          <Button variant="outline" size="icon-sm" disabled={i === n - 1} aria-label="Move down" onClick={() => act(b.id, "down")}>↓</Button>
          <Button variant="outline" size="sm" onClick={() => onSaveBlock(b)}>Save</Button>
          <Button variant="outline" size="sm" onClick={() => act(b.id, "dup")}>Copy</Button>
          <Button variant="destructive" size="sm" onClick={() => act(b.id, "del")}>Delete</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <Picker b={b} lib={lib} set={set} hideCount={isAd && b.total > 0} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Start at (optional)"><Input type="time" step="1" value={b.at} onChange={e => set(b.id, { at: e.target.value })} /></Field>
          <Field label="Total time, min (optional)" className="w-40"><Input type="number" min="0" step="0.5" value={b.total || ""} onChange={e => set(b.id, { total: Math.max(0, +e.target.value || 0) })} /></Field>
        </div>
        <p className="text-xs text-[var(--phosphor-dim)]">Start at fills any gap with off-air time. Total time: {isAd ? "picks ads to fill this length as closely as possible." : "ad breaks fill whatever time the media leaves."}</p>
        {!isAd && (
          <div className="space-y-2 border-t border-dashed border-[var(--phosphor-dim)] pt-3">
            <div className="text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">Ad slots · used at each media break time</div>
            {b.adSlots.map((slot, index) => (
              <div key={slot.id} className="border-l-2 border-[var(--amber)]/60 pl-2">
                <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">
                  <span>Slot {index + 1}</span>
                  <Button size="icon-sm" variant="ghost" aria-label="Move slot up" disabled={index === 0} onClick={() => act(slot.id, "up")}>↑</Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Move slot down" disabled={index === b.adSlots.length - 1} onClick={() => act(slot.id, "down")}>↓</Button>
                  <Button className="ml-auto" size="sm" variant="destructive" onClick={() => act(slot.id, "del")}>Remove slot</Button>
                </div>
                <Picker b={slot} lib={lib} set={set} hideCount />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => addSlot(b.id)}>+ Ad slot</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
