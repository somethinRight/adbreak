import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import Pick from '@/components/Pick';
import { clock, fmt, joinLive } from './schedule';
import type { RunResult, Schedule, Segment } from './types';

interface YtMsg { info?: { playerState?: number; currentTime?: number } }

const DOT: Record<Segment["kind"], string> = { program: "bg-[var(--phosphor)]", ad: "bg-[var(--amber)]", gap: "bg-[var(--phosphor-dim)]" };
const LABEL: Record<Segment["kind"], string> = { ad: "Ad break", gap: "Off air", program: "Programming" };
const VARIANT = { ad: "amber", gap: "outline", program: "default" } as const;

/** Executes a run: programming parts, then ad breaks, then back to the video at the exact resume point. */
function Player({ run, sm, onStop, onCur, onPauseChange }: { run: Segment[]; sm: number; onStop: () => void; onCur: (i: number) => void; onPauseChange: (paused: boolean) => void }) {
  const [cur, setCur] = useState(0), [prog, setProg] = useState(0), [paused, setPaused] = useState(false), [speed, setSpeed] = useState(30), [rk, setRk] = useState(0), [fullscreen, setFullscreen] = useState(false), [volume, setVolume] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null), vid = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null), yt = useRef(-1), got = useRef(false), R = useRef({ cur: 0, paused: false, speed: 30 });
  R.current = { cur, paused, speed };
  const s = run[cur];
  useEffect(() => onPauseChange(paused), [onPauseChange, paused]);
  // Swapping the embed can make the browser scroll to it (focus or layout shift); put the page back.
  const keepScroll = () => {
    const y = window.scrollY;
    [0, 150, 600].forEach(ms => setTimeout(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); }, ms));
  };
  const go = (i: number) => (i >= run.length ? onStop() : setCur(Math.max(0, i)));

  useEffect(() => {
    keepScroll(); onCur(cur); setProg(0); setPaused(false); yt.current = -1; got.current = false;
    if (!s) return;
    let id: ReturnType<typeof setInterval> | undefined;
    let wd: ReturnType<typeof setTimeout> | undefined;
    if (s.yt) { // watchdog: if the embed never reports back (blocked/offline), keep the schedule moving
      wd = setTimeout(() => { if (!got.current) go(R.current.cur + 1); }, (s.dur * 60 + 8) * 1000);
    } else if (!s.url) {
      let e = 0;
      id = setInterval(() => {
        if (R.current.paused) return;
        e += 0.25 * (s.kind === "gap" ? 1 : R.current.speed) / 60; setProg(e / s.dur);
        if (e >= s.dur) go(R.current.cur + 1);
      }, 250);
    }
    return () => { clearInterval(id); clearTimeout(wd); };
  }, [cur, rk]);

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      let d: YtMsg; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      const seg = run[R.current.cur], i = d && d.info;
      if (!seg || !i) return;
      got.current = true;
      if (i.playerState !== undefined) { yt.current = i.playerState; setPaused(i.playerState === 2); if (i.playerState === 0) return go(R.current.cur + 1); }
      if (i.currentTime !== undefined) { setProg((i.currentTime / 60 - seg.from) / seg.dur); if (i.currentTime / 60 >= seg.to - 0.02 && yt.current === 1) go(R.current.cur + 1); }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [run]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  if (!s) return null;
  const pause = () => {
    if (s.yt && frame.current) frame.current.contentWindow?.postMessage(JSON.stringify({ event: "command", func: yt.current === 1 ? "pauseVideo" : "playVideo", args: "" }), "*");
    else if (vid.current) vid.current.paused ? vid.current.play() : vid.current.pause();
    else setPaused(p => !p);
  };
  const changeVolume = (value: number) => {
    const next = Math.max(0, Math.min(1, value));
    setVolume(next);
    if (vid.current) vid.current.volume = next;
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(next * 100)] }), "*");
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  };
  const q = new URLSearchParams({ enablejsapi: "1", origin: window.location.origin, autoplay: "1", controls: "1", rel: "0", playsinline: "1", start: String(Math.floor(s.from * 60)), end: String(Math.ceil(s.to * 60)) });
  const next = run[cur + 1], back = s.kind === "ad" ? run.slice(cur + 1).find(r => r.kind !== "ad" && r.kind !== "gap") : null;
  return (
    <Card accent={s.kind === "ad" ? "var(--amber)" : s.kind === "gap" ? "var(--phosphor-dim)" : undefined}>
      <CardContent ref={stage} className="player-content flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-2"><Badge variant={VARIANT[s.kind]}>{LABEL[s.kind]}</Badge><strong className="min-w-0 truncate">{s.title}</strong></div>
        <div className="player-frame relative aspect-video w-full shrink-0 overflow-hidden bg-void">
          {s.yt ? (
            <iframe key={`${cur}-${rk}`} ref={frame} title={s.title} className="absolute inset-0 size-full border-0" referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
              src={`https://www.youtube-nocookie.com/embed/${s.yt}?${q}`}
              onLoad={() => { frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] }), "*"); keepScroll(); }} />
          ) : s.url ? (
            <video key={`${cur}-${rk}`} ref={vid} src={s.url} controls autoPlay className="absolute inset-0 size-full"
              onLoadedMetadata={e => { e.currentTarget.currentTime = s.from * 60; e.currentTarget.volume = volume; e.currentTarget.play().catch(() => {}); }}
              onTimeUpdate={e => { const t = e.currentTarget.currentTime / 60; setProg((t - s.from) / s.dur); if (t >= s.to) go(cur + 1); }}
              onEnded={() => go(cur + 1)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">
              {s.kind === "gap" ? "Off air" : s.kind === "ad" ? "Ad break · simulated" : "Simulated"}
            </div>
          )}
        </div>
        <p className="min-h-8 text-xs text-[var(--phosphor-dim)]">
          {s.note ? s.note + " · " : ""}{cur + 1} of {run.length} · scheduled {clock(sm + s.t)}
          {back ? ` · returning to “${back.title}” at ${fmt(back.from || 0)}` : next ? ` · next: ${next.title}` : " · last item"}
          {s.url || s.yt || s.kind === "gap" ? "" : " · simulated (no url)"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => go(cur - 1)}>Prev</Button>
          <Button size="sm" variant="primary" onClick={pause}>{paused ? "Resume" : "Pause"}</Button>
          <Button size="sm" variant="outline" onClick={() => setRk(k => k + 1)}>Restart part</Button>
          <Button size="sm" variant="outline" onClick={() => go(cur + 1)}>Next</Button>
          <Button size="sm" variant="destructive" onClick={onStop}>Stop</Button>
          <Button size="icon-sm" variant="outline" title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          {(s.url || s.yt) && <div className="flex w-36 items-center gap-2" aria-label="Video volume">
            <Volume2 className="size-4 shrink-0 text-[var(--phosphor-dim)]" aria-hidden="true" />
            <Slider min={0} max={100} step={1} value={[Math.round(volume * 100)]} onValueChange={value => changeVolume((Array.isArray(value) ? value[0] ?? 0 : value) / 100)} aria-label="Video volume" />
          </div>}
          {!s.url && !s.yt && s.kind !== "gap" && <Pick size="sm" className="w-20" label="Simulation speed" value={String(speed)} options={[1, 30, 120].map(x => ({ value: String(x), label: x + "x" }))} onChange={v => setSpeed(+v)} />}
        </div>
        {(() => {
          const total = run.reduce((sum, item) => sum + (item.kind === "program" ? item.dur : 0), 0);
          const elapsed = run.slice(0, cur).reduce((sum, item) => sum + (item.kind === "program" ? item.dur : 0), 0)
            + (s.kind === "program" ? Math.min(s.dur, Math.max(0, prog * s.dur)) : 0);
          return <div className="mt-auto space-y-1">
            <Progress aria-label="Program playback progress" value={total ? Math.min(100, elapsed / total * 100) : 0} />
            <div className="flex justify-between text-xs tabular-nums text-[var(--phosphor-dim)]"><span>{fmt(elapsed)}</span><span>{fmt(total)}</span></div>
          </div>;
        })()}
      </CardContent>
    </Card>
  );
}

interface Props {
  result: RunResult;
  sm: number;
  playRun: Segment[] | null;
  playSm: number | null;
  runKey: number;
  schedules: Record<string, Schedule>;
  selectedSchedule: string;
  onSelectSchedule: (name: string) => void;
  onPlayerPause: (paused: boolean) => void;
  onStart: (run: Segment[]) => void;
  onStop: () => void;
  onReroll: () => void;
}

export default function PlayerTab({ result, sm, playRun, playSm, runKey, schedules, selectedSchedule, onSelectSchedule, onStart, onStop, onPlayerPause, onReroll }: Props) {
  const [now, setNow] = useState(0);
  const { run, end } = result;
  const activeSm = playSm ?? sm;
  const live = () => { const l = joinLive(run, sm); l.length ? onStart(l) : alert("This schedule has already ended for today."); };
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1.4fr)_minmax(8rem,0.6fr)] gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.75fr)] lg:grid-rows-1">
      <section className="min-h-0 min-w-0 space-y-3 overflow-y-auto pr-1">
        {playRun ? <>
          <Player key={runKey} run={playRun} sm={activeSm} onStop={onStop} onCur={setNow} onPauseChange={onPlayerPause} />
          <section className="border border-[var(--phosphor-dim)] p-3">
            <h2 className="mb-2 text-sm uppercase tracking-widest">Up next</h2>
            <div className="max-h-56 overflow-y-auto">
              {playRun.slice(now + 1, now + 8).map((r, i) => (
                <div className={`flex items-baseline gap-2 border-b border-[var(--phosphor-dim)]/40 py-1.5 text-sm ${r.kind === "gap" ? "text-[var(--phosphor-dim)]" : ""}`} key={now + i}>
                  <span className="w-24 shrink-0 tabular-nums text-[var(--phosphor-dim)]">{clock(activeSm + r.t)}</span>
                  <span className={`size-2.5 shrink-0 ${DOT[r.kind]}`} />
                  <span className="min-w-0">{r.title} <small className="text-[var(--phosphor-dim)]">{[r.type, r.note, fmt(r.dur)].filter(Boolean).join(" · ")}</small></span>
                </div>
              ))}
              {now + 1 >= playRun.length && <p className="text-xs text-[var(--phosphor-dim)]">That's the last item.</p>}
            </div>
          </section>
        </> : (
          <Card>
            <CardContent className="space-y-3">
              {run.length ? <>
                <strong className="uppercase tracking-widest">Ready to run</strong>
                <p className="text-sm">{run.length} items · {fmt(end)} runtime · {clock(sm)} to {clock(sm + end)}. Ads play automatically between parts, then the video resumes where it left off.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => onStart(run)}>▶ Start from the beginning</Button>
                  <Button variant="outline" onClick={live}>Join live by clock</Button>
                  <Button variant="outline" onClick={onReroll}>Re-roll picks</Button>
                </div>
              </> : <p className="text-sm text-[var(--phosphor-dim)]">Build a schedule in the Builder tab first.</p>}
            </CardContent>
          </Card>
        )}
      </section>

      <aside className="min-h-0 overflow-y-auto border border-[var(--phosphor-dim)] p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--phosphor-dim)] pb-2">
          <h2 className="text-sm uppercase tracking-widest">Schedules</h2>
          <span className="text-xs text-[var(--phosphor-dim)]">{Object.keys(schedules).length}</span>
        </div>
        <div className="max-h-[28rem] space-y-1 overflow-y-auto">
          {Object.entries(schedules).sort(([a], [b]) => a.localeCompare(b)).map(([name, schedule]) => (
            <button key={name} type="button" aria-pressed={selectedSchedule === name}
              className={`flex w-full items-center justify-between gap-2 border px-2 py-2 text-left text-sm ${selectedSchedule === name ? "border-[var(--phosphor)] bg-[var(--phosphor)]/10" : "border-[var(--phosphor-dim)]/40 hover:border-[var(--phosphor)]"}`}
              onClick={() => onSelectSchedule(name)}>
              <span className="min-w-0 truncate">{name}</span>
              <span className="shrink-0 text-xs text-[var(--phosphor-dim)]">{schedule.start} · {schedule.blocks.length} blocks</span>
            </button>
          ))}
          {!Object.keys(schedules).length && <p className="py-3 text-sm text-[var(--phosphor-dim)]">No saved schedules.</p>}
        </div>
      </aside>
    </div>
  );
}