export type Kind = "program" | "ad";
export type Mode = "specific" | "filter" | "type" | "tags";

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
/** Legacy saved-schedule break timing; new timing lives on MediaItem. */
export interface Break { id: string; pos: number; every: number; slots: Picker[] }
export interface Block extends Picker { at: string; total: number; adSlots: Picker[]; legacyBreaks?: Break[] }
/** Blocks, breaks, and ad slots share edit helpers. */
export type Node = Block | Picker;
export interface Schedule { name: string; start: string; blocks: Block[]; soundscapeId?: string }
export interface SavedBlock { name: string; block: Block }
export interface Channel { id: string; name: string; start: string; scheduleNames: string[] }

export interface MediaItem { id: string; title: string; type: string; tags: string[]; seconds: number; adBreaksSeconds?: number[]; date?: string; url?: string; yt?: string; audioFileId?: string; thumbnail?: string; showTitle?: string; episodeName?: string; seasonNumber?: number; episodeNumber?: number }

export type SoundLayerKind = "file" | "white" | "pink" | "brown" | "tone" | "rain" | "thunder" | "spaceship";
export interface SoundLayer { id: string; name: string; kind: SoundLayerKind; volume: number; enabled: boolean; audioFileId?: string; frequency?: number; density?: number; falloff?: number; lowPassHz?: number; midPassHz?: number; highPassHz?: number }
export interface SoundscapePreset { id: string; name: string; layers: SoundLayer[] }

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
