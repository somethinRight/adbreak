export type Kind = "program" | "ad";
export type Mode = "specific" | "type" | "tags";

/** How a block (or an ad break) chooses media. */
export interface Picker {
  id: string;
  kind: Kind;
  mode: Mode;
  mediaId: string;
  type: string;
  tags: string[];
  match: "any" | "all";
  count: number;
}
/** An ad break inside a programming block. `pos`/`every` are minutes into the media. */
export interface Break extends Picker { pos: number; every: number }
export interface Block extends Picker { at: string; total: number; breaks: Break[] }
/** Blocks and breaks share edit helpers, so lookups by id return this combined shape. */
export type Node = Block & Break;
export interface Schedule { name: string; start: string; blocks: Block[] }

export interface MediaItem { id: string; title: string; type: string; tags: string[]; mins: number; date?: string; url?: string; yt?: string; thumbnail?: string }

/** One playable piece of a run: a part of a program, an ad, or off-air filler. Times are in minutes. */
export interface Segment {
  kind: Kind | "gap";
  title: string;
  url?: string;
  yt?: string;
  type?: string;
  from: number;
  to: number;
  dur: number;
  note: string;
  t: number;
  i?: number;
}
/** A preview line: a segment, an error, or a per-block summary. */
export interface Row extends Partial<Segment> { t: number; err?: string; info?: string; warn?: boolean }
export interface RunResult { rows: Row[]; run: Segment[]; end: number }
