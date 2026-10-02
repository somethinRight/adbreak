import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import Pick from '@/components/Pick';
import { clock, fmt } from './schedule';
import type { Channel, Segment } from './types';

interface YtMsg { info?: { playerState?: number; currentTime?: number } }

const DOT: Record<Segment["kind"], string> = { program: "bg-[var(--phosphor)]", ad: "bg-[var(--amber)]", gap: "bg-[var(--phosphor-dim)]" };
const LABEL: Record<Segment["kind"], string> = { ad: "Ad break", gap: "Off air", program: "Programming" };
const VARIANT = { ad: "amber", gap: "outline", program: "default" } as const;

/** Executes a run: programming parts, then ad breaks, then back to the video at the exact resume point. */
function Player({ run, sm, onStop, onFinish, onCur, onPauseChange, limitedControls, clockedBroadcast }: { run: Segment[]; sm: number; onStop: () => void; onFinish: () => void; onCur: (i: number) => void; onPauseChange: (paused: boolean) => void; limitedControls: boolean; clockedBroadcast: boolean }) {
  const [cur, setCur] = useState(0), [prog, setProg] = useState(0), [paused, setPaused] = useState(false), [speed, setSpeed] = useState(30), [rk, setRk] = useState(0), [fullscreen, setFullscreen] = useState(false), [volume, setVolume] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null), vid = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null), yt = useRef(-1), got = useRef(false), correctedStart = useRef(false), R = useRef({ cur: 0, paused: false, speed: 30 });
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  R.current = { cur, paused, speed };
  const s = run[cur];
  useEffect(() => onPauseChange(paused), [onPauseChange, paused]);
  // Swapping the embed can make the browser scroll to it (focus or layout shift); put the page back.
  const keepScroll = () => {
    const y = window.scrollY;
    [0, 150, 600].forEach(ms => setTimeout(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); }, ms));
  };
  const go = (i: number) => (i >= run.length ? finishRef.current() : setCur(Math.max(0, i)));

  useEffect(() => {
    keepScroll(); onCur(cur);
    correctedStart.current = false;
    if (clockedBroadcast) return;
    setProg(0); setPaused(false); yt.current = -1; got.current = false;
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
  }, [cur, rk, clockedBroadcast]);

  useEffect(() => {
    if (!clockedBroadcast) return;
    const startedAt = Date.now();
    const syncToClock = () => {
      let elapsed = (Date.now() - startedAt) / 60000;
      let index = 0;
      while (index < run.length && elapsed >= run[index]!.dur) {
        elapsed -= run[index]!.dur;
        index += 1;
      }
      if (index >= run.length) {
        finishRef.current();
        return;
      }
      setCur(index);
      setProg(run[index]!.dur ? elapsed / run[index]!.dur : 0);
    };
    syncToClock();
    const timer = setInterval(syncToClock, 250);
    return () => clearInterval(timer);
  }, [clockedBroadcast, run]);

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      let d: YtMsg; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      const seg = run[R.current.cur], i = d && d.info;
      if (!seg || !i) return;
      got.current = true;
      if (i.playerState !== undefined) { yt.current = i.playerState; setPaused(i.playerState === 2); if (i.playerState === 0 && !clockedBroadcast) return go(R.current.cur + 1); }
      if (i.currentTime !== undefined) {
        const expectedStart = (seg.from + (clockedBroadcast ? Math.max(0, prog * seg.dur) : 0)) * 60;
        if (!correctedStart.current && Math.abs(i.currentTime - expectedStart) > 0.2) {
          correctedStart.current = true;
          frame.current.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [expectedStart, true] }), "*");
        }
        if (!clockedBroadcast) {
          setProg((i.currentTime / 60 - seg.from) / seg.dur);
          if (i.currentTime / 60 >= seg.to - 0.02 && yt.current === 1) go(R.current.cur + 1);
        }
      }
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
    if (s.yt && frame.current) {
      const nextPaused = !paused;
      frame.current.contentWindow?.postMessage(JSON.stringify({ event: "command", func: nextPaused ? "pauseVideo" : "playVideo", args: "" }), "*");
      setPaused(nextPaused);
    }
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
        <div className="player-frame relative aspect-video w-full max-h-[42vh] shrink-0 overflow-hidden bg-void">
          {s.yt ? (
            <iframe key={`${cur}-${rk}`} ref={frame} title={s.title} className="absolute inset-0 size-full border-0" referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
              src={`https://www.youtube-nocookie.com/embed/${s.yt}?${q}`}
              onLoad={() => { frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] }), "*"); keepScroll(); }} />
          ) : s.url ? (
            <video key={`${cur}-${rk}`} ref={vid} src={s.url} controls autoPlay className="absolute inset-0 size-full"
              onLoadedMetadata={e => { e.currentTarget.currentTime = (s.from + (clockedBroadcast ? Math.max(0, prog * s.dur) : 0)) * 60; e.currentTarget.volume = volume; e.currentTarget.play().catch(() => {}); }}
              onTimeUpdate={e => { const t = e.currentTarget.currentTime / 60; if (!clockedBroadcast) setProg((t - s.from) / s.dur); if (!clockedBroadcast && t >= s.to) go(cur + 1); }}
              onEnded={() => { if (!clockedBroadcast) go(cur + 1); }} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} />
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
        {(() => {
          const total = run.reduce((sum, item) => sum + item.dur, 0);
          const elapsed = run.slice(0, cur).reduce((sum, item) => sum + item.dur, 0) + Math.min(s.dur, Math.max(0, prog * s.dur));
          const percent = total ? Math.min(100, elapsed / total * 100) : 0;
          let position = 0;
          const markers = run.flatMap((item, index) => {
            const marker = item.kind === "ad" ? { id: `${item.i}-${index}`, position } : null;
            position += item.dur;
            return marker ? [marker] : [];
          });
          return <div className="space-y-1" aria-label="Broadcast time remaining">
            <div role="progressbar" aria-label="Broadcast progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="relative h-2 border border-[var(--phosphor-dim)]/60 bg-[var(--panel-sunken)]">
              <div className="h-full bg-[var(--phosphor)]" style={{ width: `${percent}%` }} />
              {markers.filter(marker => total > 0).map(marker => <span key={marker.id} title={`Ad break at ${fmt(marker.position)}`} className="absolute inset-y-[-2px] z-10 w-px bg-[var(--amber)]" style={{ left: `${Math.min(100, marker.position / total * 100)}%` }} />)}
            </div>
            <div className="flex justify-between text-xs tabular-nums text-[var(--phosphor-dim)]"><span>{fmt(Math.max(0, total - elapsed))} remaining</span><span>{fmt(total)} total</span></div>
          </div>;
        })()}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={pause}>{paused ? "Resume" : "Pause"}</Button>
          {!limitedControls && <>
          <Button size="sm" variant="outline" onClick={() => go(cur - 1)}>Prev</Button>
          <Button size="sm" variant="outline" onClick={() => setRk(k => k + 1)}>Restart part</Button>
          <Button size="sm" variant="outline" onClick={() => go(cur + 1)}>Next</Button>
          <Button size="sm" variant="destructive" onClick={onStop}>Stop</Button>
          </>}
          <Button size="icon-sm" variant="outline" title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          {(s.url || s.yt) && <div className="flex w-36 items-center gap-2" aria-label="Video volume">
            <Volume2 className="size-4 shrink-0 text-[var(--phosphor-dim)]" aria-hidden="true" />
            <Slider min={0} max={100} step={1} value={[Math.round(volume * 100)]} onValueChange={value => changeVolume((Array.isArray(value) ? value[0] ?? 0 : value) / 100)} aria-label="Video volume" />
          </div>}
          {!limitedControls && !s.url && !s.yt && s.kind !== "gap" && <Pick size="sm" className="w-20" label="Simulation speed" value={String(speed)} options={[1, 30, 120].map(x => ({ value: String(x), label: x + "x" }))} onChange={v => setSpeed(+v)} />}
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  playRun: Segment[] | null;
  playSm: number | null;
  runKey: number;
  channels: Array<Channel & { run: Segment[]; duration: number }>;
  selectedChannelId: string;
  liveChannelId: string | null;
  limitedControls: boolean;
  onSelectChannel: (id: string) => void;
  onStartChannel: (id: string, mode: "go-live" | "tune-in") => void;
  onPlayerPause: (paused: boolean) => void;
  onStop: () => void;
  onFinish: () => void;
}

export default function PlayerTab({ playRun, playSm, runKey, channels, selectedChannelId, liveChannelId, limitedControls, onSelectChannel, onStartChannel, onStop, onFinish, onPlayerPause }: Props) {
  const [now, setNow] = useState(0);
  const activeSm = playSm ?? 0;
  const selectedChannel = channels.find(channel => channel.id === selectedChannelId);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.75fr)] lg:grid-rows-1">
      <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
        {playRun ? <>
          <section className="shrink-0 border border-[var(--phosphor-dim)] p-2">
            <div className="mb-1 flex items-baseline justify-between"><h2 className="text-xs uppercase tracking-widest">Up next</h2><span className="text-2xs text-[var(--phosphor-dim)]">{Math.max(0, playRun.length - now - 1)} queued</span></div>
            <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
              {playRun.slice(now + 1, now + 4).map((r, i) => (
                <div className={`flex min-w-0 items-center gap-2 border-t border-[var(--phosphor-dim)]/30 py-1 text-xs ${r.kind === "gap" ? "text-[var(--phosphor-dim)]" : ""}`} key={now + i}>
                  <span className={`size-2 shrink-0 ${DOT[r.kind]}`} />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="shrink-0 tabular-nums text-[var(--phosphor-dim)]">{fmt(r.dur)}</span>
                </div>
              ))}
              {now + 1 >= playRun.length && <p className="py-1 text-xs text-[var(--phosphor-dim)]">That's the last item.</p>}
            </div>
          </section>
          <Player key={runKey} run={playRun} sm={activeSm} onStop={onStop} onFinish={onFinish} onCur={setNow} onPauseChange={onPlayerPause} limitedControls={limitedControls} clockedBroadcast={Boolean(liveChannelId)} />
        </> : (
          <Card>
            <CardContent className="grid min-h-48 place-items-center text-center">
              <p className="text-sm text-[var(--phosphor-dim)]">{selectedChannel ? `${selectedChannel.name} is ready. Choose Go live or Tune in.` : "Select a channel to watch."}</p>
            </CardContent>
          </Card>
        )}
      </section>

      <aside className="flex min-h-0 flex-col overflow-hidden border border-[var(--phosphor-dim)] p-3">
        <div className="grid min-w-0 gap-3">
          <label className="min-w-0 space-y-1 text-xs uppercase tracking-widest">Channel
            <select aria-label="Channel" value={selectedChannelId} onChange={event => onSelectChannel(event.target.value)} className="block h-9 w-full min-w-0 border border-[var(--phosphor-dim)] bg-background px-2 text-sm text-foreground">
              <option value="">Choose channel…</option>
              {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="primary" disabled={!selectedChannelId} onClick={() => onStartChannel(selectedChannelId, "go-live")}>Go live</Button>
            <Button size="sm" variant="outline" disabled={!selectedChannelId} onClick={() => onStartChannel(selectedChannelId, "tune-in")}>Tune in</Button>
          </div>
        </div>
        {liveChannelId && <p className="mt-2 text-xs uppercase text-[var(--signal)]">Tune in / live timeline</p>}
      </aside>
    </div>
  );
}