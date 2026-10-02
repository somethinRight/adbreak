import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Library, Music2, Settings2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import Pick from '@/components/Pick';
import BASE from './library';
import { buildRun, findObj, mk, toMin, uid } from './schedule';
import type { Block as BlockT, Break, Channel, MediaItem, Picker as PickerT, SavedBlock, Schedule, Segment, SoundLayer, SoundscapePreset } from './types';
import Block from './Block';
import Preview from './Preview';
import PlayerTab from './PlayerTab';
import MediaExperience from './MediaExperience';
import YouTubeBox from './YouTubeBox';
import NoiseMachineTab from './NoiseMachineTab';
import type { NoiseMachineHandle } from './NoiseMachineTab';
import LoopsTab from './LoopsTab';
import { deleteSoundFile } from './soundscape';

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const PHOSPHOR_COLORS = ["green", "orange", "yellow", "cyan", "blue", "magenta", "purple", "red", "grey"] as const;
type PhosphorColor = (typeof PHOSPHOR_COLORS)[number];
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
  const [savedBlocks, setSavedBlocks] = useState(() => load<SavedBlock[]>("block-library-v1", []));
  const [channels, setChannels] = useState(() => load<Channel[]>("channel-library-v1", []));
  const [custom, setCustom] = useState(() => load<MediaItem[]>("custom-media-v1", []).map(normMedia));
  const [soundLayers, setSoundLayers] = useState(() => load<SoundLayer[]>("soundscape-layers-v1", []));
  const [soundscapes, setSoundscapes] = useState(() => load<SoundscapePreset[]>("soundscape-presets-v1", []));
  const [soundGain, setSoundGain] = useState(() => load("soundscape-gain-v1", 1));
  const [seed, setSeed] = useState(0);
  const [tab, setTab] = useState("library");
  const [videoPlayer, setVideoPlayer] = useState("somtv");
  const [audioPlayer, setAudioPlayer] = useState("somnify");
  const [librarySection, setLibrarySection] = useState("all");
  const [somtvSection, setSomtvSection] = useState("schedules");
  const [noiseSection, setNoiseSection] = useState("soundscapes");
  const [scheduleSection, setScheduleSection] = useState("saved");
  const [channelName, setChannelName] = useState("");
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelStart, setChannelStart] = useState("18:00");
  const [channelSchedules, setChannelSchedules] = useState<string[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [liveChannelId, setLiveChannelId] = useState<string | null>(null);
  const [limitedControls, setLimitedControls] = useState(false);
  const [phosphor, setPhosphor] = useState<PhosphorColor>(() => {
    const saved = load<string>("phosphor-color-v1", document.documentElement.dataset.phosphor ?? "green");
    return PHOSPHOR_COLORS.includes(saved as PhosphorColor) ? saved as PhosphorColor : "green";
  });
  const [playRun, setPlayRun] = useState<Segment[] | null>(null);
  const [playerPaused, setPlayerPaused] = useState(true);
  const [playSm, setPlaySm] = useState<number | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [json, setJson] = useState<string | null>(null);
  const noiseMachineRef = useRef<NoiseMachineHandle>(null);

  const lib = useMemo(() => [...BASE, ...custom], [custom]);
  const mediaLib = useMemo(() => lib.filter(item => item.type !== "loop"), [lib]);
  const loops = useMemo(() => lib.filter(item => item.type === "loop"), [lib]);
  const tags = useMemo(() => [...new Set(mediaLib.flatMap(m => m.tags))].sort(), [mediaLib]);
  const result = useMemo(() => buildRun(S, mediaLib), [S, mediaLib, seed]);
  const channelRuns = useMemo(() => channels.map(channel => {
    const run: Segment[] = [];
    let duration = 0;
    for (const name of channel.scheduleNames) {
      const schedule = saved[name];
      if (!schedule) continue;
      const part = buildRun(schedule, mediaLib).run;
      const partDuration = part.reduce((end, segment) => Math.max(end, segment.t + segment.dur), 0);
      part.forEach(segment => run.push({ ...segment, t: duration + segment.t, i: run.length }));
      duration += partDuration;
    }
    return { ...channel, run, duration };
  }), [channels, mediaLib, saved]);
  const sm = toMin(S.start) || 0;
  // The player runs a frozen copy of the run, so editing the builder never interrupts playback.
  const startRun = (run: Segment[], startAt = sm, soundscapeId = S.soundscapeId, liveId: string | null = null, limitControls = false) => {
    if (!run.length) return;
    const preset = soundscapes.find(item => item.id === soundscapeId);
    if (preset) noiseMachineRef.current?.startBroadcast(structuredClone(preset.layers));
    setPlayRun(run); setPlaySm(startAt); setPlayerPaused(false); setRunKey(k => k + 1); setVideoPlayer("somtv"); setLiveChannelId(liveId); setLimitedControls(limitControls); setTab("video");
  };
  const startChannel = (id: string, mode: "go-live" | "tune-in") => {
    const channel = channelRuns.find(item => item.id === id);
    if (!channel?.run.length || !channel.duration) return alert("This channel has no playable schedule items.");
    let run = channel.run;
    const startAt = toMin(channel.start) ?? 0;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const dayOffset = (nowMinutes - startAt + 1440) % 1440;
    const offset = (dayOffset % channel.duration + channel.duration) % channel.duration;
    const index = run.findIndex(segment => segment.t + segment.dur > offset);
    if (index < 0) return alert("This channel has no playable schedule items.");
    const current = run[index]!;
    const into = Math.max(0, offset - current.t);
    run = [{ ...current, from: current.from + into, t: offset, dur: current.dur - into }, ...run.slice(index + 1)];
    setSelectedChannelId(id);
    const tuneIn = mode === "tune-in";
    startRun(run, startAt, saved[channel.scheduleNames[0] ?? ""]?.soundscapeId, tuneIn ? id : null, tuneIn);
  };
  const removeMedia = (id: string) => {
    const item = custom.find(media => media.id === id);
    const fileInUse = item?.audioFileId && [...soundLayers, ...soundscapes.flatMap(preset => preset.layers)].some(layer => layer.audioFileId === item.audioFileId || (layer.kind === "file" && layer.id === item.audioFileId));
    if (item?.audioFileId && !fileInUse) void deleteSoundFile(item.audioFileId).catch(() => {});
    setCustom(current => current.filter(media => media.id !== id));
  };
  const addAudio = (item: MediaItem) => setCustom(current => [...current, item]);
  const addLoopToSoundscape = (layer: SoundLayer) => { setSoundLayers(current => [...current, layer]); setTab("noise"); };

  useEffect(() => store("schedule-builder-v1", S), [S]);
  useEffect(() => store("schedule-library-v1", saved), [saved]);
  useEffect(() => store("block-library-v1", savedBlocks), [savedBlocks]);
  useEffect(() => store("channel-library-v1", channels), [channels]);
  useEffect(() => store("custom-media-v1", custom), [custom]);
  useEffect(() => store("soundscape-layers-v1", soundLayers), [soundLayers]);
  useEffect(() => store("soundscape-presets-v1", soundscapes), [soundscapes]);
  useEffect(() => store("soundscape-gain-v1", soundGain), [soundGain]);
  useEffect(() => {
    document.documentElement.dataset.phosphor = phosphor;
    store("phosphor-color-v1", phosphor);
  }, [phosphor]);

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
  const saveBlock = (block: BlockT) => {
    const name = prompt("Name this reusable block:")?.trim();
    if (!name) return;
    setSavedBlocks(current => [...current.filter(item => item.name !== name), { name, block: structuredClone(block) }]);
  };
  const loadBlock = (source: BlockT) => {
    const block = structuredClone(source);
    block.id = uid();
    block.adSlots = block.adSlots.map(slot => ({ ...slot, id: uid() }));
    block.legacyBreaks = block.legacyBreaks?.map(item => ({ ...item, id: uid(), slots: item.slots.map(slot => ({ ...slot, id: uid() })) }));
    edit(schedule => { schedule.blocks.push(block); });
    setLibrarySection("somtv");
    setSomtvSection("schedules");
    setScheduleSection("create");
  };
  const saveChannel = () => {
    const name = channelName.trim();
    if (!name || !channelSchedules.length) return;
    const existing = channels.find(channel => channel.id === editingChannelId) ?? channels.find(channel => channel.name === name);
    const channel = { id: existing?.id ?? `channel_${uid()}`, name, start: channelStart, scheduleNames: [...channelSchedules] };
    setChannels(current => [...current.filter(item => item.id !== channel.id), channel]);
    setSelectedChannelId(channel.id);
    setChannelName("");
    setChannelSchedules([]);
    setEditingChannelId(null);
  };
  const moveChannelSchedule = (index: number, offset: number) => setChannelSchedules(current => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  const del = () => { if (saved[S.name] && confirm(`Delete "${S.name}"?`)) setSaved(({ [S.name]: _, ...rest }) => rest); };
  const loadJson = () => { try { const o = JSON.parse(json ?? ""); if (!Array.isArray(o.blocks)) throw 0; setS(norm(o)); setJson(null); } catch { alert("That JSON isn't a valid schedule."); } };
  const loadSchedule = (name: string) => {
    const schedule = saved[name];
    if (!schedule) return;
    const next = norm(structuredClone(schedule));
    setS(next);
    const preset = soundscapes.find(item => item.id === next.soundscapeId);
    if (preset) setSoundLayers(structuredClone(preset.layers));
  };
  const saveSoundscape = (name: string, layers: SoundLayer[]) => {
    const existing = soundscapes.find(preset => preset.name === name);
    const id = existing?.id ?? "sound_" + uid();
    const preset = { id, name, layers: structuredClone(layers) };
    setSoundscapes(current => [...current.filter(item => item.id !== id), preset]);
    return id;
  };
  const deleteSoundscape = (id: string) => {
    if (!confirm("Delete this soundscape? Schedules using it will be unlinked.")) return;
    setSoundscapes(current => current.filter(preset => preset.id !== id));
    setS(current => current.soundscapeId === id ? { ...current, soundscapeId: undefined } : current);
    setSaved(current => Object.fromEntries(Object.entries(current).map(([name, schedule]) => [name, schedule.soundscapeId === id ? { ...schedule, soundscapeId: undefined } : schedule])));
  };
  const deleteSchedule = (name: string) => {
    if (!confirm(`Delete schedule "${name}"?`)) return;
    setSaved(current => { const { [name]: _removed, ...rest } = current; return rest; });
  };

  const savedOptions = Object.keys(saved).map(n => ({ value: n, label: n }));
  const jsonText = json ?? JSON.stringify(S, null, 2);
  const savedItems = [
    ...Object.entries(saved).map(([name, schedule]) => ({
      id: `schedule:${name}`, title: name, type: "Schedule",
      details: `Starts ${schedule.start} · ${schedule.blocks.length} blocks`,
      actions: <Button size="sm" variant="outline" onClick={() => { loadSchedule(name); setScheduleSection("create"); }}>Edit</Button>,
    })),
    ...channels.map(channel => ({
      id: `channel:${channel.id}`, title: channel.name, type: "Channel",
      details: `Daily start ${channel.start} · ${channel.scheduleNames.length} schedules`,
      actions: <Button size="sm" variant="outline" onClick={() => { setSelectedChannelId(channel.id); setVideoPlayer("somtv"); setTab("video"); }}>Open</Button>,
    })),
    ...savedBlocks.map(item => ({
      id: `block:${item.name}`, title: item.name, type: "Block",
      details: `${item.block.kind === "ad" ? "Ad block" : "Programming"} · ${item.block.mode === "specific" ? "Specific media" : `${item.block.count} matching items`}`,
      actions: <Button size="sm" variant="outline" onClick={() => loadBlock(item.block)}>Load</Button>,
    })),
    ...soundscapes.map(preset => ({
      id: `soundscape:${preset.id}`, title: preset.name, type: "Soundscape",
      details: `${preset.layers.length} layers`,
      actions: <Button size="sm" variant="outline" onClick={() => { setSoundLayers(structuredClone(preset.layers)); setTab("noise"); }}>Open</Button>,
    })),
    ...loops.map(loop => ({
      id: `loop:${loop.id}`, title: loop.title, type: "Loop",
      details: `${Math.floor(loop.seconds / 60)}:${String(loop.seconds % 60).padStart(2, "0")} · Local audio`,
      actions: <Button size="sm" variant="outline" onClick={() => addLoopToSoundscape({ id: uid(), audioFileId: loop.audioFileId ?? loop.id, name: loop.title, kind: "file", volume: 0.5, enabled: true, lowPassHz: 500, midPassHz: 1500, highPassHz: 3000 })}>Use</Button>,
    })),
  ];

  return (
    <main className="mx-auto flex h-[100dvh] max-w-screen-2xl flex-col overflow-hidden p-2 md:p-4">
      <Tabs value={tab} onValueChange={v => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-2 md:gap-3">
        <TabsList className="w-full shrink-0 justify-start">
          <TabsTrigger className="gap-1.5 px-2.5 py-1.5" value="noise"><AudioLines aria-hidden="true" />Noise</TabsTrigger>
          <TabsTrigger className="gap-1.5 px-2.5 py-1.5" value="video"><Video aria-hidden="true" />Video{playRun ? " ●" : ""}</TabsTrigger>
          <TabsTrigger className="gap-1.5 px-2.5 py-1.5" value="audio"><Music2 aria-hidden="true" />Audio</TabsTrigger>
          <TabsTrigger className="gap-1.5 px-2.5 py-1.5" value="library"><Library aria-hidden="true" />Library</TabsTrigger>
          <TabsTrigger className="ml-auto gap-1.5 px-2.5 py-1.5" value="options"><Settings2 aria-hidden="true" />Options</TabsTrigger>
        </TabsList>

        <TabsContent value="library" keepMounted className="flex min-h-0 flex-col overflow-hidden pt-2 md:pt-4">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1">
            <YouTubeBox
              category={librarySection === "music" ? "music" : librarySection === "videos" ? "videos" : "all"}
              library={mediaLib}
              custom={custom}
              savedItems={savedItems}
              showForm
              showLibrary={false}
              onAdd={c => setCustom(x => [...x, c])}
              onAddMany={items => setCustom(x => [...x, ...items])}
              onUpdate={c => setCustom(x => x.map(item => item.id === c.id ? c : item))}
              onRemove={removeMedia}
              onTest={c => startRun([{ kind: "program", title: c.type === "show" ? `${c.showTitle || c.title} · ${c.episodeName || c.title}` : c.title, yt: c.yt, url: c.url, from: 0, to: c.seconds / 60, dur: c.seconds / 60, t: 0, note: "test play" }])}
              onAddBlock={(kind, id) => addBlock(kind, { mode: "specific", mediaId: id })}
            />

            <div className="flex min-h-0 flex-col">
              <Tabs value={librarySection} onValueChange={value => setLibrarySection(String(value))} className="flex h-full min-h-0 flex-col">
                <TabsList className="w-full shrink-0 justify-start">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="music">Music</TabsTrigger>
                  <TabsTrigger value="videos">Videos</TabsTrigger>
                  <TabsTrigger value="somtv">SomTV</TabsTrigger>
                  <TabsTrigger value="noise">Noise</TabsTrigger>
                </TabsList>

                <TabsContent value="all" keepMounted className="flex min-h-0 flex-col overflow-hidden">
                  <YouTubeBox category="all" library={mediaLib} custom={custom} savedItems={savedItems} showForm={false} onAdd={c => setCustom(x => [...x, c])} onAddMany={items => setCustom(x => [...x, ...items])} onUpdate={c => setCustom(x => x.map(item => item.id === c.id ? c : item))} onRemove={removeMedia} onTest={c => startRun([{ kind: "program", title: c.type === "show" ? `${c.showTitle || c.title} · ${c.episodeName || c.title}` : c.title, yt: c.yt, url: c.url, from: 0, to: c.seconds / 60, dur: c.seconds / 60, t: 0, note: "test play" }])} onAddBlock={(kind, id) => addBlock(kind, { mode: "specific", mediaId: id })} />
                </TabsContent>

                <TabsContent value="music" keepMounted className="flex min-h-0 flex-col overflow-hidden">
                  <YouTubeBox category="music" library={mediaLib} custom={custom} showForm={false} onAdd={c => setCustom(x => [...x, c])} onAddMany={items => setCustom(x => [...x, ...items])} onUpdate={c => setCustom(x => x.map(item => item.id === c.id ? c : item))} onRemove={removeMedia} onTest={c => startRun([{ kind: "program", title: c.title, yt: c.yt, url: c.url, from: 0, to: c.seconds / 60, dur: c.seconds / 60, t: 0, note: "test play" }])} onAddBlock={(kind, id) => addBlock(kind, { mode: "specific", mediaId: id })} />
                </TabsContent>

                <TabsContent value="videos" keepMounted className="flex min-h-0 flex-col overflow-hidden">
                  <YouTubeBox category="videos" library={mediaLib} custom={custom} showForm={false} onAdd={c => setCustom(x => [...x, c])} onAddMany={items => setCustom(x => [...x, ...items])} onUpdate={c => setCustom(x => x.map(item => item.id === c.id ? c : item))} onRemove={removeMedia} onTest={c => startRun([{ kind: "program", title: c.type === "show" ? `${c.showTitle || c.title} · ${c.episodeName || c.title}` : c.title, yt: c.yt, url: c.url, from: 0, to: c.seconds / 60, dur: c.seconds / 60, t: 0, note: "test play" }])} onAddBlock={(kind, id) => addBlock(kind, { mode: "specific", mediaId: id })} />
                </TabsContent>

                <TabsContent value="somtv" className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                    <Tabs value={somtvSection} onValueChange={value => setSomtvSection(String(value))} className="flex h-full min-h-0 flex-col">
                      <TabsList className="w-full shrink-0 justify-start border-b border-[var(--phosphor-dim)] bg-[var(--panel)]/30">
                        <TabsTrigger value="schedules">Schedules</TabsTrigger>
                        <TabsTrigger value="blocks">Blocks</TabsTrigger>
                        <TabsTrigger value="channels">Channels</TabsTrigger>
                      </TabsList>

                      <TabsContent value="schedules" className="flex h-full min-h-0 flex-col overflow-hidden">
                        <Tabs value={scheduleSection} onValueChange={value => setScheduleSection(String(value))} className="flex h-full min-h-0 flex-col">
                          <TabsList className="w-full shrink-0 justify-start">
                            <TabsTrigger value="saved">Saved</TabsTrigger>
                            <TabsTrigger value="create">Create</TabsTrigger>
                          </TabsList>

                          <TabsContent value="saved" className="flex min-h-0 flex-col overflow-y-auto">
                            <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                              <section className="divide-y divide-[var(--phosphor-dim)]/40">
                                <div className="flex items-baseline justify-between border-b border-[var(--phosphor-dim)] px-3 py-2">
                                  <h2 className="text-sm uppercase tracking-widest">Saved schedules</h2>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-[var(--phosphor-dim)]">{Object.keys(saved).length}</span>
                                    <Button size="sm" variant="primary" onClick={() => { setS(EMPTY); setScheduleSection("create"); }}>New schedule</Button>
                                  </div>
                                </div>
                                {Object.entries(saved).sort(([a], [b]) => a.localeCompare(b)).map(([name, schedule]) => (
                                  <div key={name} className="flex flex-wrap items-center gap-3 py-3">
                                    <span className="min-w-0 flex-1 text-sm">{name}<small className="block text-[var(--phosphor-dim)]">Starts {schedule.start} · {schedule.blocks.length} blocks{schedule.soundscapeId ? ` · ${soundscapes.find(preset => preset.id === schedule.soundscapeId)?.name ?? "Soundscape"}` : ""}</small></span>
                                    <Button size="sm" variant="outline" onClick={() => { loadSchedule(name); setScheduleSection("create"); }}>Edit schedule</Button>
                                    <Button size="sm" variant="outline" onClick={() => { loadSchedule(name); setVideoPlayer("somtv"); setTab("video"); }}>Open SomTV</Button>
                                    <Button size="sm" variant="destructive" onClick={() => deleteSchedule(name)}>Delete</Button>
                                  </div>
                                ))}
                                {!Object.keys(saved).length && <p className="px-3 py-6 text-sm text-[var(--phosphor-dim)]">No saved schedules yet.</p>}
                              </section>
                            </div>
                          </TabsContent>

                          <TabsContent value="create" keepMounted className="flex h-full min-h-0 flex-col overflow-hidden">
                            <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.4fr)] lg:grid-rows-1">
                              <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
                                <section className="space-y-3 border border-[var(--phosphor-dim)] p-3">
                                  <h2 className="text-sm uppercase tracking-widest">Schedule info</h2>
                                  <Input aria-label="Schedule name" placeholder="Schedule name" value={S.name} onChange={e => setS({ ...S, name: e.target.value })} />
                                  <label className="flex items-center justify-between gap-3 text-xs uppercase tracking-widest">Starts
                                    <Input className="w-36" type="time" step="1" value={S.start} onChange={e => setS({ ...S, start: e.target.value || "18:00" })} /></label>
                                  <Pick label="Saved schedules" placeholder="Saved schedules…" value={saved[S.name] ? S.name : null} options={savedOptions} onChange={loadSchedule} />
                                  <label className="flex items-center justify-between gap-3 text-xs uppercase tracking-widest">Soundscape
                                    <select aria-label="Schedule soundscape" className="w-48 border border-[var(--phosphor-dim)] bg-background px-2 py-2 text-xs" value={S.soundscapeId ?? ""} onChange={event => { const soundscapeId = event.target.value || undefined; setS({ ...S, soundscapeId }); const preset = soundscapes.find(item => item.id === soundscapeId); if (preset) setSoundLayers(structuredClone(preset.layers)); }}>
                                      <option value="">None</option>
                                      {soundscapes.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                                    </select>
                                  </label>
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
                                    <Block key={b.id} b={b} i={i} n={S.blocks.length} lib={mediaLib} set={set} act={act} addSlot={addSlot} onSaveBlock={saveBlock} />
                                  )) : <div className="border border-dashed border-[var(--phosphor-dim)] p-7 text-center text-sm text-[var(--phosphor-dim)]">No blocks yet. Add a programming or ad block to start.</div>}
                                </div>
                              </section>
                            </div>
                            <datalist id="taglist">{tags.map(t => <option key={t} value={t} />)}</datalist>
                          </TabsContent>
                        </Tabs>
                      </TabsContent>

                      <TabsContent value="blocks" className="flex min-h-0 flex-col overflow-y-auto">
                        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                          <section className="divide-y divide-[var(--phosphor-dim)]/40">
                            <div className="flex items-baseline justify-between border-b border-[var(--phosphor-dim)] px-3 py-2">
                              <h2 className="text-sm uppercase tracking-widest">Reusable blocks</h2>
                              <span className="text-xs text-[var(--phosphor-dim)]">{savedBlocks.length}</span>
                            </div>
                            {savedBlocks.map(item => (
                              <div key={item.name} className="flex flex-wrap items-center gap-3 px-3 py-3">
                                <span className="min-w-0 flex-1 text-sm">{item.name}<small className="block text-[var(--phosphor-dim)]">{item.block.kind === "ad" ? "Ad block" : "Programming"} · {item.block.mode === "specific" ? "Specific media" : `${item.block.count} matching items`}</small></span>
                                <Button size="sm" variant="outline" onClick={() => loadBlock(item.block)}>Load into schedule</Button>
                                <Button size="sm" variant="destructive" onClick={() => setSavedBlocks(current => current.filter(entry => entry.name !== item.name))}>Delete</Button>
                              </div>
                            ))}
                            {!savedBlocks.length && <p className="px-3 py-6 text-sm text-[var(--phosphor-dim)]">Save a block from the schedule editor to reuse it here.</p>}
                          </section>
                        </div>
                      </TabsContent>

                      <TabsContent value="channels" className="flex min-h-0 flex-col overflow-y-auto">
                        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                          <section className="space-y-4 border-b border-[var(--phosphor-dim)] p-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="min-w-48 flex-1 space-y-1 text-xs uppercase tracking-widest">Channel name
                                <Input value={channelName} onChange={event => setChannelName(event.target.value)} placeholder="Channel name" />
                              </label>
                              <label className="flex items-center gap-3 text-xs uppercase tracking-widest">Starts daily
                                <Input className="w-36" type="time" value={channelStart} onChange={event => setChannelStart(event.target.value || "18:00")} />
                              </label>
                              <Button variant="primary" disabled={!channelName.trim() || !channelSchedules.length} onClick={saveChannel}>Save channel</Button>
                              <Button variant="outline" onClick={() => { setEditingChannelId(null); setChannelName(""); setChannelStart("18:00"); setChannelSchedules([]); }}>New</Button>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div>
                                <h3 className="mb-2 text-xs uppercase tracking-widest">Include schedules</h3>
                                <div className="max-h-48 space-y-1 overflow-y-auto border border-[var(--phosphor-dim)]/40 p-2">
                                  {Object.keys(saved).sort((a, b) => a.localeCompare(b)).map(name => (
                                    <label key={name} className="flex items-center gap-2 py-1 text-sm">
                                      <input type="checkbox" checked={channelSchedules.includes(name)} onChange={event => setChannelSchedules(current => event.target.checked ? [...current, name] : current.filter(item => item !== name))} />
                                      <span className="min-w-0 truncate">{name}</span>
                                    </label>
                                  ))}
                                  {!Object.keys(saved).length && <p className="text-sm text-[var(--phosphor-dim)]">Save schedules before composing a channel.</p>}
                                </div>
                              </div>
                              <div>
                                <h3 className="mb-2 text-xs uppercase tracking-widest">Channel order</h3>
                                <div className="max-h-48 space-y-1 overflow-y-auto border border-[var(--phosphor-dim)]/40 p-2">
                                  {channelSchedules.map((name, index) => <div key={name} className="flex items-center gap-2 text-sm">
                                    <span className="min-w-0 flex-1 truncate">{index + 1}. {name}</span>
                                    <Button size="icon-sm" variant="outline" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveChannelSchedule(index, -1)}>↑</Button>
                                    <Button size="icon-sm" variant="outline" aria-label={`Move ${name} down`} disabled={index === channelSchedules.length - 1} onClick={() => moveChannelSchedule(index, 1)}>↓</Button>
                                  </div>)}
                                  {!channelSchedules.length && <p className="text-sm text-[var(--phosphor-dim)]">Choose one or more schedules.</p>}
                                </div>
                              </div>
                            </div>
                          </section>
                          <section className="divide-y divide-[var(--phosphor-dim)]/40">
                            <div className="flex items-baseline justify-between px-3 py-3"><h2 className="text-sm uppercase tracking-widest">Saved channels</h2><span className="text-xs text-[var(--phosphor-dim)]">{channels.length}</span></div>
                            {channels.map(channel => <div key={channel.id} className="flex flex-wrap items-center gap-3 py-3">
                              <span className="min-w-0 flex-1 text-sm">{channel.name}<small className="block text-[var(--phosphor-dim)]">Daily start {channel.start} · {channel.scheduleNames.length} schedules</small></span>
                              <Button size="sm" variant="outline" onClick={() => { setEditingChannelId(channel.id); setChannelName(channel.name); setChannelStart(channel.start); setChannelSchedules([...channel.scheduleNames]); }}>Edit lineup</Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedChannelId(channel.id); setVideoPlayer("somtv"); setTab("video"); }}>Open SomTV</Button>
                              <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete channel "${channel.name}"?`)) setChannels(current => current.filter(item => item.id !== channel.id)); }}>Delete</Button>
                            </div>)}
                            {!channels.length && <p className="px-3 py-5 text-sm text-[var(--phosphor-dim)]">Compose a channel from saved schedules.</p>}
                          </section>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </TabsContent>

                <TabsContent value="noise" className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                    <Tabs value={noiseSection} onValueChange={value => setNoiseSection(String(value))} className="flex h-full min-h-0 flex-col">
                      <TabsList className="w-full shrink-0 justify-start border-b border-[var(--phosphor-dim)] bg-[var(--panel)]/30">
                        <TabsTrigger value="soundscapes">Soundscapes</TabsTrigger>
                        <TabsTrigger value="loops">Loops</TabsTrigger>
                      </TabsList>

                      <TabsContent value="soundscapes" className="flex min-h-0 flex-col overflow-y-auto">
                        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
                          <section className="divide-y divide-[var(--phosphor-dim)]/40">
                            <div className="flex items-baseline justify-between border-b border-[var(--phosphor-dim)] px-3 py-2">
                              <h2 className="text-sm uppercase tracking-widest">Saved soundscapes</h2>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-[var(--phosphor-dim)]">{soundscapes.length}</span>
                                <Button size="sm" variant="primary" onClick={() => setTab("noise")}>New soundscape</Button>
                              </div>
                            </div>
                            {soundscapes.map(preset => (
                              <div key={preset.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                                <span className="min-w-0 flex-1 text-sm">{preset.name}<small className="block text-[var(--phosphor-dim)]">{preset.layers.length} layers</small></span>
                                <Button size="sm" variant="outline" onClick={() => { setSoundLayers(structuredClone(preset.layers)); setTab("noise"); }}>Open in Noise</Button>
                                <Button size="sm" variant="destructive" onClick={() => deleteSoundscape(preset.id)}>Delete</Button>
                              </div>
                            ))}
                            {!soundscapes.length && <p className="px-3 py-6 text-sm text-[var(--phosphor-dim)]">No saved soundscapes yet. Create one in Noise.</p>}
                          </section>
                        </div>
                      </TabsContent>

                      <TabsContent value="loops" className="flex min-h-0 flex-col overflow-hidden">
                        <LoopsTab loops={loops} onAdd={item => setCustom(current => [...current, item])} onRemove={removeMedia} onUse={addLoopToSoundscape} />
                      </TabsContent>
                    </Tabs>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="noise" keepMounted className="flex min-h-0 flex-col overflow-hidden pt-2 md:pt-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
            <NoiseMachineTab ref={noiseMachineRef} layers={soundLayers} onChange={setSoundLayers} playbackActive={Boolean(playRun) && !playerPaused} gain={soundGain} onGainChange={setSoundGain}
              presets={soundscapes} onSavePreset={saveSoundscape} onLoadPreset={id => { const preset = soundscapes.find(item => item.id === id); if (preset) setSoundLayers(structuredClone(preset.layers)); }} onDeletePreset={deleteSoundscape} />
          </div>
        </TabsContent>

        <TabsContent value="video" keepMounted className="flex min-h-0 flex-col overflow-hidden pt-2 md:pt-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
          <Tabs value={videoPlayer} onValueChange={value => setVideoPlayer(String(value))} className="flex h-full min-h-0 flex-col">
            <TabsList className="w-full shrink-0 justify-start">
              <TabsTrigger value="somtv">SomTV</TabsTrigger>
              <TabsTrigger value="somflix">SomFlix</TabsTrigger>
              <TabsTrigger value="somtube">SomTube</TabsTrigger>
            </TabsList>
            <TabsContent value="somtv" keepMounted className="flex min-h-0 flex-col overflow-hidden">
              <PlayerTab playRun={playRun} playSm={playSm} runKey={runKey}
                channels={channelRuns} selectedChannelId={selectedChannelId} liveChannelId={liveChannelId}
                limitedControls={limitedControls}
                onSelectChannel={setSelectedChannelId} onStartChannel={startChannel}
                onStop={() => { setPlayRun(null); setPlayerPaused(true); setLiveChannelId(null); setLimitedControls(false); }}
                onFinish={() => {
                  if (liveChannelId) { startChannel(liveChannelId, "tune-in"); return; }
                  setPlayRun(null); setPlayerPaused(true); setLimitedControls(false);
                }} onPlayerPause={setPlayerPaused} />
            </TabsContent>
            <TabsContent value="somflix" keepMounted className="flex min-h-0 flex-col overflow-hidden">
              <MediaExperience mode="somflix" library={mediaLib} onAddAudio={addAudio} onRemove={removeMedia} />
            </TabsContent>
            <TabsContent value="somtube" keepMounted className="flex min-h-0 flex-col overflow-hidden">
              <MediaExperience mode="somtube" library={mediaLib} onAddAudio={addAudio} onRemove={removeMedia} />
            </TabsContent>
          </Tabs>
          </div>
        </TabsContent>

        <TabsContent value="audio" keepMounted className="flex min-h-0 flex-col overflow-hidden pt-2 md:pt-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]/20">
            <Tabs value={audioPlayer} onValueChange={value => setAudioPlayer(String(value))} className="flex h-full min-h-0 flex-col">
              <TabsList className="w-full shrink-0 justify-start border-b border-[var(--phosphor-dim)] bg-[var(--panel)]/30">
                <TabsTrigger value="somnify">Somnify</TabsTrigger>
              </TabsList>
              <TabsContent value="somnify" keepMounted className="flex min-h-0 flex-col overflow-hidden">
                <MediaExperience mode="somnify" library={mediaLib} onAddAudio={addAudio} onRemove={removeMedia} />
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>

        <TabsContent value="options" keepMounted className="flex min-h-0 flex-col overflow-y-auto pt-4">
          <section className="max-w-lg space-y-4 border border-[var(--phosphor-dim)] p-4">
            <h2 className="text-sm uppercase tracking-widest">Display</h2>
            <label className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-widest">
              Phosphor color
              <select aria-label="Phosphor color" className="min-w-40 border border-[var(--phosphor-dim)] bg-background px-2 py-2 text-xs" value={phosphor}
                onChange={event => setPhosphor(event.target.value as PhosphorColor)}>
                {PHOSPHOR_COLORS.map(color => <option key={color} value={color}>{color}</option>)}
              </select>
            </label>
          </section>
        </TabsContent>
      </Tabs>
    </main>
  );
}
