// Pure scheduling logic (no DOM, no React).
import type { Block, Break, Kind, MediaItem, Node, Picker, Row, RunResult, Schedule, Segment } from './types';

type Cut = { p: number; legacySlots?: Picker[] };
let LIB: MediaItem[] = [];

export const uid = (): string => Math.random().toString(36).slice(2, 9);
export const fmt = (m: number): string => { const s = Math.round(m * 60); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
export const toMin = (v: string): number | null => { if (!v) return null; const [h, m, s] = v.split(":"); return +h * 60 + +m + (+s || 0) / 60; };
export const clock = (m: number): string => { const s = Math.round(m * 60), h = Math.floor(s / 3600) % 24; return ((h % 12) || 12) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") + (h < 12 ? " AM" : " PM"); };

const mkPicker = (kind: Kind): Picker => ({ id: uid(), kind, mode: "filter", mediaId: "", type: kind === "ad" ? "commercial" : "movie", tags: [], match: "any", count: kind === "ad" ? 3 : 1 });
export const mk = (kind: Kind): Block => ({ ...mkPicker(kind), at: "", total: 0, adSlots: [] });
export const mkBreak = (): Break => ({ id: uid(), pos: 10, every: 0, slots: [{ ...mkPicker("ad"), count: 1 }] });

export const ytId = (u: string): string | null => {
  const s = String(u).trim();
  const m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m && m[1];
};

/** Finds a block or an ad break by id, along with the array that holds it. */
export function findObj(S: Schedule, id: string): { o: Node; list: Node[] } | undefined {
  for (const b of S.blocks) {
    if (b.id === id) return { o: b, list: S.blocks as unknown as Node[] };
    const slot = b.adSlots.find(x => x.id === id);
    if (slot) return { o: slot, list: b.adSlots as Node[] };
  }
}

function candidates(b: Picker): MediaItem[] {
  const legacyTypeOnly = b.mode === "type", legacyTagsOnly = b.mode === "tags";
  return LIB.filter(m => {
    const matchType = legacyTagsOnly || !b.type || m.type === b.type;
    const matchTags = legacyTypeOnly || !b.tags.length || (b.match === "all" ? b.tags.every(t => m.tags.includes(t)) : b.tags.some(t => m.tags.includes(t)));
    return matchType && matchTags;
  });
}
const errText = (b: Picker): string => b.mode === "specific" ? "no media chosen" : "nothing in the library matches";

function pickFrom(b: Picker, used: Set<string>): MediaItem[] | null {
  if (b.mode === "specific") { const m = LIB.find(x => x.id === b.mediaId); return m ? [m] : null; }
  const pool = candidates(b);
  if (!pool.length) return null;
  const out: MediaItem[] = [];
  for (let n = 0; n < b.count; n++) { // avoid repeats across the whole run until a pool is exhausted
    let c = pool.filter(m => !used.has(m.id));
    if (!c.length) { pool.forEach(m => used.delete(m.id)); c = pool; }
    const m = c[Math.floor(Math.random() * c.length)];
    used.add(m.id); out.push(m);
  }
  return out;
}

/** Picks ads whose total length lands as close to `target` minutes as possible. */
function fillTo(pool: MediaItem[], target: number, used: Set<string>): MediaItem[] {
  let best: { seq: MediaItem[]; err: number; u: Set<string> } | null = null;
  for (let n = 0; n < 200; n++) {
    const u = new Set(used), seq: MediaItem[] = [];
    let sum = 0;
    while (Math.abs(sum - target) > 1 / 120) {
      let av = pool.filter(m => !u.has(m.id));
      if (!av.length) { pool.forEach(m => u.delete(m.id)); av = pool; }
      const c = av.filter(m => Math.abs(sum + m.seconds / 60 - target) < Math.abs(sum - target) - 1e-9);
      if (!c.length) break;
      const m = c[Math.floor(Math.random() * c.length)];
      seq.push(m); sum += m.seconds / 60; u.add(m.id);
    }
    const err = Math.abs(sum - target);
    if (!best || err < best.err - 1e-9 || (err < best.err + 1e-9 && seq.length < best.seq.length)) best = { seq, err, u };
  }
  if (!best) return [];
  used.clear(); best.u.forEach(x => used.add(x));
  return best.seq;
}
function fillFor(b: Picker, target: number, used: Set<string>): MediaItem[] | null {
  if (b.mode === "specific") return pickFrom(b, used);
  const pool = candidates(b);
  return pool.length ? fillTo(pool, target, used) : null;
}
function pickBreak(slots: Picker[], used: Set<string>): MediaItem[] | null {
  if (!slots.length) return null;
  const picked: MediaItem[] = [];
  for (const slot of slots) {
    const items = pickFrom(slot, used);
    if (!items) return null;
    picked.push(...items);
  }
  return picked;
}
function cutsFor(b: Block, m: MediaItem): Cut[] {
  if (m.adBreaksSeconds === undefined) {
    return (b.legacyBreaks || []).flatMap(k => {
      const step = k.every > 0 ? Math.max(1, k.every) : Infinity;
      const points: Cut[] = [];
      for (let p = k.pos; p < m.seconds / 60 - 0.5; p += step) {
        if (p > 0) points.push({ p, legacySlots: k.slots });
      }
      return points;
    }).sort((a, z) => a.p - z.p);
  }
  return m.adBreaksSeconds.map(seconds => seconds / 60).filter(p => p > 0 && p < m.seconds / 60 - 0.5).sort((a, z) => a - z).map(p => ({ p }));
}

/** Resolves a schedule against a media library into a flat, playable run. */
export function buildRun(S: Schedule, lib: MediaItem[]): RunResult {
  LIB = lib;
  const used = new Set<string>(), rows: Row[] = [], run: Segment[] = [], sm = toMin(S.start) || 0;
  let t = 0;
  const add = (r: Omit<Segment, "t">) => { const seg: Segment = { ...r, t }; rows.push(seg); run.push(seg); t += r.dur; };
  S.blocks.forEach((b, i) => {
    const label = "Block " + (i + 1), fix = toMin(b.at), now = sm + t;
    if (fix !== null) {
      if (fix > now) add({ kind: "gap", title: "Off air", from: 0, to: fix - now, dur: fix - now, note: "until " + clock(fix) });
      else if (fix < now - 1 / 120) rows.push({ err: `${label} is set for ${clock(fix)} but starts ${fmt(now - fix)} late`, kind: b.kind, t });
    }
    const bt = t, ms = b.kind === "ad" && b.total > 0 ? fillFor(b, b.total, used) : pickFrom(b, used);
    if (!ms) { rows.push({ err: `${label}: ${errText(b)}`, kind: b.kind, t }); return; }
    const plan = new Map<MediaItem, Cut[]>(ms.map((m): [MediaItem, Cut[]] => [m, b.kind === "program" ? cutsFor(b, m) : []]));
    const mediaDuration = (m: MediaItem) => m.seconds / 60;
    ms.forEach(m => {
      const cuts = plan.get(m)!;
      let from = 0;
      [...cuts.map(c => c.p), mediaDuration(m)].forEach((to, j, arr) => {
        add({ kind: b.kind, title: m.title, url: m.url, yt: m.yt, type: m.type, from, to, dur: to - from, note: cuts.length ? `part ${j + 1}/${arr.length}` : "" });
        from = to;
        const c = cuts[j];
        if (c) {
          const slots = c.legacySlots ?? b.adSlots;
          const as = pickBreak(slots, used);
          if (!as) rows.push({ err: `${label} break at ${fmt(c.p)}: ${slots.length ? "nothing in the library matches" : "no ad slots configured"}`, kind: "ad", t });
          else as.forEach(a => add({ kind: "ad", title: a.type === "show" ? `${a.showTitle || a.title} · ${a.episodeName || a.title}` : a.title, url: a.url, yt: a.yt, type: a.type, from: 0, to: mediaDuration(a), dur: mediaDuration(a), note: "ad break" }));
        }
      });
    });
    if (b.total > 0) {
      const d = t - bt - b.total, ok = Math.abs(d) < 1 / 120;
      rows.push({ info: `${label}: target ${fmt(b.total)}, actual ${fmt(t - bt)}${ok ? "" : ` (${d > 0 ? "over" : "under"} by ${fmt(Math.abs(d))})`}`, warn: !ok, t });
    }
  });
  run.forEach((r, i) => { r.i = i; });
  return { rows, run, end: t };
}

/** Trims a run so playback joins where the wall clock says the schedule is now. */
export function joinLive(run: Segment[], sm: number, now = new Date()): Segment[] {
  const off = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 - sm;
  if (off <= 0) return run;
  const i = run.findIndex(r => r.t + r.dur > off);
  if (i < 0) return [];
  const r = run[i], d = off - r.t;
  return [{ ...r, from: r.from + d, dur: r.dur - d, t: off }, ...run.slice(i + 1)];
}
