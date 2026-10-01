import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import Pick from '@/components/Pick';
import BASE from './library';
import { buildRun, findObj, mk, toMin, uid } from './schedule';
import type { Block as BlockT, Break, MediaItem, Picker as PickerT, Schedule, Segment } from './types';
import Block from './Block';
import Preview from './Preview';
import PlayerTab from './PlayerTab';
import YouTubeBox from './YouTubeBox';
import NoiseMachineTab from './NoiseMachineTab';
import type { SoundLayer } from './types';

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const EMPTY: Schedule = { name: "", start: "18:00", blocks: [] };
const normPicker = (raw: Record<string, any>): PickerT => ({ ...raw, id: raw.id ?? uid(), kind: raw.kind === "program" ? "program" : "ad", mediaId: raw.mediaId ?? "",
  mode: raw.mode === "type" || raw.mode === "tags" ? "filter" : raw.mode ?? "filter", type: raw.mode === "tags" ? "" : raw.type ?? "",
  tags: raw.tags ?? [], match: raw.match ?? "any", count: raw.count ?? 1 });
const norm = (o: Partial<Schedule>): Schedule => ({ ...EMPTY, ...o, blocks: (o.blocks || []).map(rawBlock => {
  const raw = rawBlock as BlockT & Record<string, any>;
  const rawBreaks = raw.legacyBreaks ?? raw.breaks ?? [];
  const legacyBreaks: Break[] = rawBreaks.map((rawBreak: Record<string, any>) => ({
    id: rawBreak.id ?? uid(), pos: rawBreak.pos ?? 10, every: rawBreak.every ?? 0,
    slots: Array.isArray(rawBreak.slots) ? rawBreak.slots.map((slot: Record<string, any>) => normPicker(slot)) : [normPicker({ ...rawBreak, id: uid(), kind: "ad" })],
  }));
  const adSlots = (Array.isArray(raw.adSlots) ? raw.adSlots : legacyBreaks.flatMap(b => b.slots)).map((slot: Record<string, any>) => normPicker(slot));
  const { breaks: _breaks, ...rest } = raw;
  return { ...rest, ...normPicker(raw), at: raw.at ?? "", total: raw.total ?? 0, adSlots, legacyBreaks };
}) });
const normMedia = (item: MediaItem): MediaItem => {
  const raw = item as MediaItem & { mins?: number };
  const { mins, ...rest } = raw;
  return { ...rest, seconds: Number.isFinite(raw.seconds) ? raw.seconds : Math.round((mins ?? 5) * 60), tags: raw.tags ?? [], adBreaksSeconds: raw.adBreaksSeconds };
};

export default function App() {
  const [S, setS] = useState(() => norm(load("schedule-builder-v1", EMPTY)));
  const [saved, setSaved] = useState(() => load<Record<string, Schedule>>("schedule-library-v1", {}));
  const [custom, setCustom] = useState(() => load<MediaItem[]>("custom-media-v1", []).map(normMedia));
  const [soundLayers, setSoundLayers] = useState(() => load<SoundLayer[]>("soundscape-layers-v1", []));
  const [soundGain, setSoundGain] = useState(() => load("soundscape-gain-v1", 1));
  const [seed, setSeed] = useState(0);
  const [tab, setTab] = useState("builder");
  const [playRun, setPlayRun] = useState<Segment[] | null>(null);
  const [playerPaused, setPlayerPaused] = useState(true);
  const [playSm, setPlaySm] = useState<number | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [json, setJson] = useState<string | null>(null);

  const lib = useMemo(() => [...BASE, ...custom], [custom]);
  const tags = useMemo(() => [...new Set(lib.flatMap(m => m.tags))].sort(), [lib]);
  const result = useMemo(() => buildRun(S, lib), [S, lib, seed]);
  const sm = toMin(S.start) || 0;
  // The player runs a frozen copy of the run, so editing the builder never interrupts playback.
  const startRun = (run: Segment[]) => { if (!run.length) return; setPlayRun(run); setPlaySm(sm); setPlayerPaused(false); setRunKey(k => k + 1); setTab("player"); };

  useEffect(() => store("schedule-builder-v1", S), [S]);
  useEffect(() => store("schedule-library-v1", saved), [saved]);
  useEffect(() => store("custom-media-v1", custom), [custom]);
  useEffect(() => store("soundscape-layers-v1", soundLayers), [soundLayers]);
  useEffect(() => store("soundscape-gain-v1", soundGain), [soundGain]);

  const edit = (fn: (d: Schedule) => void) => setS(p => { const d = structuredClone(p); fn(d); return d; });
  const set = (id: string, patch: Record<string, unknown>) => edit(d => { const f = findObj(d, id); if (f) Object.assign(f.o, patch); });
  const addSlot = (id: string) => edit(d => { const found = findObj(d, id); if (found && "adSlots" in found.o) found.o.adSlots.push({ id: uid(), kind: "ad", mode: "filter", mediaId: "", type: "commercial", tags: [], match: "any", count: 1 }); });
  const addBlock = (kind: "program" | "ad", extra?: Partial<BlockT>) => edit(d => { d.blocks.push({ ...mk(kind), ...extra }); });
  const act = (id: string, a: "up" | "down" | "dup" | "del") => edit(d => {
    const f = findObj(d, id);
    if (!f) return;
    const { o, list } = f, i = list.indexOf(o);
    if (a === "del") list.splice(i, 1);
    if (a === "dup" && "adSlots" in o) { const c = structuredClone(o); c.id = uid(); c.adSlots.forEach(slot => { slot.id = uid(); }); list.splice(i + 1, 0, c); }
    if (a === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (a === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  });

  const saveCurrent = () => {
    if (!S.name.trim()) return alert("Name the schedule before saving.");
    setSaved(s => ({ ...s, [S.name]: structuredClone(S) }));
  };
  const del = () => { if (saved[S.name] && confirm(`Delete "${S.name}"?`)) setSaved(({ [S.name]: _, ...rest }) => rest); };
  const loadJson = () => { try { const o = JSON.parse(json ?? ""); if (!Array.isArray(o.blocks)) throw 0; setS(norm(o)); setJson(null); } catch { alert("That JSON isn't a valid schedule."); } };

  const savedOptions = Object.keys(saved).map(n => ({ value: n, label: n }));
  const jsonText = json ?? JSON.stringify(S, null, 2);

  return (
    <main className="mx-auto flex h-dvh max-w-screen-xl flex-col overflow-hidden p-4">
      <Tabs value={tab} onValueChange={v => setTab(String(v))} className="min-h-0 flex-1">
        <TabsList className="w-full shrink-0">
          <TabsTrigger className="flex-1" value="player">Player{playRun ? " ●" : ""}</TabsTrigger>
          <TabsTrigger className="flex-1" value="library">Library</TabsTrigger>
          <TabsTrigger className="flex-1" value="noise">Noise</TabsTrigger>
          <TabsTrigger className="flex-1" value="builder">Builder</TabsTrigger>
        </TabsList>

        <TabsContent value="builder" keepMounted className="min-h-0 overflow-hidden pt-4">
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.4fr)] lg:grid-rows-1">
            <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
              <section className="space-y-3 border border-[var(--phosphor-dim)] p-3">
                <h2 className="text-sm uppercase tracking-widest">Schedule info</h2>
                <Input aria-label="Schedule name" placeholder="Schedule name" value={S.name} onChange={e => setS({ ...S, name: e.target.value })} />
                <label className="flex items-center justify-between gap-3 text-xs uppercase tracking-widest">Starts
                  <Input className="w-36" type="time" step="1" value={S.start} onChange={e => setS({ ...S, start: e.target.value || "18:00" })} /></label>
                <Pick label="Saved schedules" placeholder="Saved schedules…" value={saved[S.name] ? S.name : null} options={savedOptions}
                  onChange={v => saved[v] && setS(norm(structuredClone(saved[v])))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={saveCurrent}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setS(EMPTY)}>New</Button>
                  <Button size="sm" variant="destructive" onClick={del}>Delete</Button>
                  <Button size="sm" variant="outline" onClick={() => (!S.blocks.length || confirm("Remove all blocks?")) && setS({ ...S, blocks: [] })}>Clear blocks</Button>
                </div>
              </section>

              <Preview result={result} sm={sm} onRoll={() => setSeed(x => x + 1)} onPlay={() => startRun(result.run)} />

              <details className="border border-[var(--phosphor-dim)] p-3">
                <summary className="cursor-pointer text-sm uppercase tracking-widest">Save / load JSON</summary>
                <Textarea className="mt-2 min-h-32 font-mono text-xs" spellCheck={false} value={jsonText} onChange={e => setJson(e.target.value)} />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={loadJson}>Load JSON</Button>
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(jsonText)}>Copy JSON</Button>
                </div>
              </details>
            </div>

            <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm uppercase tracking-widest">Schedule layout · {S.blocks.length} blocks</h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => addBlock("program")}>+ Programming</Button>
                  <Button size="sm" variant="outline" className="border-[var(--amber)] text-[var(--amber)]" onClick={() => addBlock("ad")}>+ Ad block</Button>
                </div>
              </div>
              <div className="space-y-2">
                {S.blocks.length ? S.blocks.map((b, i) => (
                  <Block key={b.id} b={b} i={i} n={S.blocks.length} lib={lib} set={set} act={act} addSlot={addSlot} />
                )) : <div className="border border-dashed border-[var(--phosphor-dim)] p-7 text-center text-sm text-[var(--phosphor-dim)]">No blocks yet. Add a programming or ad block to start.</div>}
              </div>
            </section>
          </div>
          <datalist id="taglist">{tags.map(t => <option key={t} value={t} />)}</datalist>
        </TabsContent>

        <TabsContent value="library" keepMounted className="min-h-0 overflow-hidden pt-4">
          <YouTubeBox library={lib} custom={custom}
            onAdd={c => setCustom(x => [...x, c])}
            onAddMany={items => setCustom(x => [...x, ...items])}
            onUpdate={c => setCustom(x => x.map(item => item.id === c.id ? c : item))}
            onRemove={id => setCustom(x => x.filter(c => c.id !== id))}
            onTest={c => startRun([{ kind: "program", title: c.type === "show" ? `${c.showTitle || c.title} · ${c.episodeName || c.title}` : c.title, yt: c.yt, url: c.url, from: 0, to: c.seconds / 60, dur: c.seconds / 60, t: 0, note: "test play" }])}
            onAddBlock={(kind, id) => addBlock(kind, { mode: "specific", mediaId: id })} />
        </TabsContent>

        <TabsContent value="noise" keepMounted className="min-h-0 overflow-hidden pt-4">
          <NoiseMachineTab layers={soundLayers} onChange={setSoundLayers} playbackActive={Boolean(playRun) && !playerPaused} gain={soundGain} onGainChange={setSoundGain} />
        </TabsContent>

        <TabsContent value="player" keepMounted className="min-h-0 overflow-hidden pt-4">
          <PlayerTab result={result} sm={sm} playRun={playRun} playSm={playSm} runKey={runKey}
            schedules={saved} selectedSchedule={S.name}
            onSelectSchedule={name => saved[name] && setS(norm(structuredClone(saved[name])))}
            onStart={startRun} onStop={() => { setPlayRun(null); setPlayerPaused(true); }} onPlayerPause={setPlayerPaused} onReroll={() => setSeed(x => x + 1)} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
