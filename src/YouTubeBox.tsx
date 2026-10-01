import { useMemo, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import Field from '@/components/Field';
import Pick from '@/components/Pick';
import { uid, ytId } from './schedule';
import { fetchYouTubeDuration, fetchYouTubePlaylistIds, ytPlaylistId } from './youtube';
import type { MediaItem } from './types';

interface Form { url: string; title: string; type: string; seconds: string | number; adBreaks: string; tags: string; date: string; showTitle: string; seasonNumber: string; episodeNumber: string }
const parseAdBreaks = (value: string): number[] => [...new Set(value.split(",").map(item => Number(item.trim()))
  .filter(minutes => Number.isFinite(minutes) && minutes > 0).map(minutes => Math.round(minutes * 60)))].sort((a, b) => a - b);
interface Props {
  library: MediaItem[];
  custom: MediaItem[];
  onAdd: (c: MediaItem) => void;
  onAddMany: (items: MediaItem[]) => void;
  onUpdate: (c: MediaItem) => void;
  onRemove: (id: string) => void;
  onTest: (c: MediaItem) => void;
  onAddBlock: (kind: "program" | "ad", id: string) => void;
}

export default function YouTubeBox({ library, custom, onAdd, onAddMany, onUpdate, onRemove, onTest, onAddBlock }: Props) {
  const emptyForm: Form = { url: "", title: "", type: "video", seconds: 300, adBreaks: "", tags: "", date: "", showTitle: "", seasonNumber: "", episodeNumber: "" };
  const [f, setF] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [playlistStatus, setPlaylistStatus] = useState("");
  const [organizeBy, setOrganizeBy] = useState("type");
  const customIds = new Set(custom.map(c => c.id));
  const isShow = f.type.trim().toLowerCase() === "show";
  const mediaTypes = useMemo(() => [...new Set(["video", "movie", "show", "commercial", "bumper", "psa", ...library.map(item => item.type).filter(Boolean)])]
    .sort().map(type => ({ value: type, label: type })), [library]);
  const groups = useMemo(() => {
    const grouped = new Map<string, MediaItem[]>();
    for (const item of library) {
      const keys = organizeBy === "year" ? [item.date?.slice(0, 4) || "Unknown year"]
        : organizeBy === "tag" ? (item.tags.length ? item.tags : ["Untagged"]) : [item.type || "Uncategorized"];
      for (const key of keys) grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [library, organizeBy]);
  const up = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const id = ytId(f.url);
    if (!id) return alert("That doesn't look like a YouTube link.");
    setAdding(true);
    const [metadata, duration] = await Promise.all([
      (async () => {
        try {
          const url = `https://www.youtube.com/watch?v=${id}`;
          const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
          return response.ok ? await response.json() as { title?: string; thumbnail_url?: string } : {};
        } catch { return {}; }
      })(),
      fetchYouTubeDuration(id),
    ]);
    const existing = editingId ? custom.find(c => c.id === editingId) : undefined;
    const adBreaksSeconds = parseAdBreaks(f.adBreaks);
    const item: MediaItem = { id: existing?.id || "yt_" + uid(), yt: id, url: existing?.url, title: f.title.trim() || metadata.title || "YouTube " + id,
      type: f.type.trim().toLowerCase() || "video", tags: f.tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
      seconds: duration ?? Math.max(1, Math.round(+f.seconds || 300)), date: f.date || undefined,
      adBreaksSeconds: adBreaksSeconds.length ? adBreaksSeconds : undefined,
      thumbnail: metadata.thumbnail_url || existing?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      showTitle: isShow ? f.showTitle.trim() || undefined : undefined,
      episodeName: isShow ? f.title.trim() || undefined : undefined,
      seasonNumber: isShow && f.seasonNumber !== "" ? Math.max(0, +f.seasonNumber) : undefined,
      episodeNumber: isShow && f.episodeNumber !== "" ? Math.max(0, +f.episodeNumber) : undefined };
    if (existing) onUpdate(item); else onAdd(item);
    setF(emptyForm);
    setEditingId(null);
    setAdding(false);
  };
  const importPlaylist = async () => {
    const playlistId = ytPlaylistId(playlistUrl);
    if (!playlistId) {
      setPlaylistStatus("Enter a YouTube playlist link or playlist ID.");
      return;
    }

    setImportingPlaylist(true);
    setPlaylistStatus("Reading playlist…");
    try {
      const videoIds = await fetchYouTubePlaylistIds(playlistId);
      if (!videoIds.length) throw new Error("Playlist unavailable");
      const existingIds = new Set(library.flatMap(item => item.yt ? [item.yt] : []));
      const pending = videoIds.filter(videoId => !existingIds.has(videoId));
      const skipped = videoIds.length - pending.length;
      if (!pending.length) {
        setPlaylistStatus(`All ${skipped} videos are already in the library.`);
        return;
      }

      const items: MediaItem[] = [];
      let cursor = 0;
      let completed = 0;
      setPlaylistStatus(`Importing 0 of ${pending.length} videos…`);
      const worker = async () => {
        while (cursor < pending.length) {
          const videoId = pending[cursor++];
          if (!videoId) continue;
          const [metadata, duration] = await Promise.all([
            (async () => {
              try {
                const url = `https://www.youtube.com/watch?v=${videoId}`;
                const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
                return response.ok ? await response.json() as { title?: string; thumbnail_url?: string } : {};
              } catch { return {}; }
            })(),
            fetchYouTubeDuration(videoId),
          ]);
          const adBreaksSeconds = parseAdBreaks(f.adBreaks);
          const showTitle = isShow ? f.showTitle.trim() || f.title.trim() || undefined : undefined;
          items.push({
            id: "yt_" + uid(), yt: videoId, title: metadata.title || "YouTube " + videoId,
            type: f.type.trim().toLowerCase() || "video", tags: f.tags.split(",").map(tag => tag.trim().toLowerCase()).filter(Boolean),
            seconds: duration ?? Math.max(1, Math.round(+f.seconds || 300)),
            adBreaksSeconds: adBreaksSeconds.length ? adBreaksSeconds : undefined,
            date: f.date || undefined, thumbnail: metadata.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            showTitle, episodeName: isShow ? metadata.title : undefined,
          });
          completed += 1;
          setPlaylistStatus(`Importing ${completed} of ${pending.length} videos…`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker));
      onAddMany(items);
      setPlaylistStatus(`${items.length} videos added${skipped ? ` · ${skipped} already in library` : ""}.`);
      setPlaylistUrl("");
    } catch {
      setPlaylistStatus("Could not read that playlist. It must be public or unlisted.");
    } finally {
      setImportingPlaylist(false);
    }
  };
  const edit = (c: MediaItem) => {
    setEditingId(c.id);
    setF({ url: c.yt ? `https://www.youtube.com/watch?v=${c.yt}` : c.url || "", title: c.episodeName || c.title, type: c.type,
      seconds: c.seconds, adBreaks: c.adBreaksSeconds?.map(seconds => String(seconds / 60)).join(", ") || "", tags: c.tags.join(", "), date: c.date || "", showTitle: c.showTitle || "",
      seasonNumber: c.seasonNumber?.toString() || "", episodeNumber: c.episodeNumber?.toString() || "" });
  };
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1">
      <section className="min-h-0 overflow-y-auto border border-[var(--phosphor-dim)] p-3">
      <h2 className="text-sm uppercase tracking-widest">{editingId ? "Edit video" : "Add YouTube videos"}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field className="col-span-2" label="YouTube link" htmlFor="yturl"><Input id="yturl" placeholder="https://www.youtube.com/watch?v=…" value={f.url} onChange={up("url")} /></Field>
        <Field className="col-span-2" label={isShow ? "Episode name" : "Title (optional)"} htmlFor="yttitle"><Input id="yttitle" value={f.title} onChange={up("title")} /></Field>
        <Field label="Media type"><Pick label="Media type" value={f.type} options={mediaTypes} onChange={type => setF({ ...f, type })} /></Field>
        <Field label="Fallback length (seconds)" htmlFor="ytseconds"><Input id="ytseconds" type="number" min="1" step="1" value={f.seconds} onChange={up("seconds")} /></Field>
        {isShow && <>
          <Field className="col-span-2" label="Show title" htmlFor="ytshow"><Input id="ytshow" value={f.showTitle} onChange={up("showTitle")} /></Field>
          <Field label="Season number" htmlFor="ytseason"><Input id="ytseason" type="number" min="0" step="1" value={f.seasonNumber} onChange={up("seasonNumber")} /></Field>
          <Field label="Episode number" htmlFor="ytepisode"><Input id="ytepisode" type="number" min="0" step="1" value={f.episodeNumber} onChange={up("episodeNumber")} /></Field>
        </>}
        <Field className="col-span-2" label="Ad break times (minutes, comma separated)" htmlFor="ytbreaks"><Input id="ytbreaks" placeholder="5, 12.5, 20" value={f.adBreaks} onChange={up("adBreaks")} /></Field>
        <Field label="Date" htmlFor="ytdate"><Input id="ytdate" type="date" value={f.date} onChange={up("date")} /></Field>
        <Field className="col-span-2" label="Tags (comma separated)" htmlFor="yttags"><Input id="yttags" value={f.tags} onChange={up("tags")} /></Field>
        <Button variant="primary" className="col-span-2" disabled={adding} onClick={save}>{adding ? "Fetching video details…" : editingId ? "Save changes" : "Add to library"}</Button>
        {editingId && <Button variant="outline" className="col-span-2" onClick={() => { setF(emptyForm); setEditingId(null); }}>Cancel edit</Button>}
      </div>
      <div className="mt-5 space-y-2 border-t border-[var(--phosphor-dim)]/50 pt-3">
        <h3 className="text-xs uppercase tracking-widest">Import playlist</h3>
        <div className="flex gap-2">
          <Input aria-label="YouTube playlist URL" placeholder="YouTube playlist URL" value={playlistUrl} onChange={event => setPlaylistUrl(event.target.value)} />
          <Button size="sm" variant="outline" disabled={importingPlaylist} onClick={importPlaylist}>{importingPlaylist ? "Importing…" : "Import"}</Button>
        </div>
        {playlistStatus && <p aria-live="polite" className="text-xs text-[var(--phosphor-dim)]">{playlistStatus}</p>}
      </div>
      </section>

      <section className="min-h-0 overflow-y-auto">
        <div className="flex items-baseline justify-between border-b border-[var(--phosphor-dim)] pb-2">
          <h2 className="text-sm uppercase tracking-widest">Library</h2>
          <span className="text-xs text-[var(--phosphor-dim)]">{library.length} items</span>
        </div>
        <Field className="my-2 max-w-48" label="Organize by">
          <Pick label="Organize library by" value={organizeBy} options={[{ value: "type", label: "Type" }, { value: "year", label: "Year" }, { value: "tag", label: "Tag" }]} onChange={setOrganizeBy} />
        </Field>
        {groups.length ? <Accordion multiple className="divide-y divide-[var(--phosphor-dim)]/40">
          {groups.map(([group, items]) => <AccordionItem key={group} value={group}>
            <AccordionTrigger>{group}<span className="ml-auto mr-3 text-xs text-[var(--phosphor-dim)]">{items.length}</span></AccordionTrigger>
            <AccordionContent>
              <div className="divide-y divide-[var(--phosphor-dim)]/30">
                {items.map(c => {
                  const showIndex = c.seasonNumber != null || c.episodeNumber != null
                    ? ` S${String(c.seasonNumber ?? 0).padStart(2, "0")}E${String(c.episodeNumber ?? 0).padStart(2, "0")}` : "";
                  const title = c.type === "show" ? `${c.showTitle || c.title}${showIndex}${c.episodeName ? ` · ${c.episodeName}` : ""}` : c.title;
                  return <div className="flex flex-wrap items-center gap-2 py-2" key={c.id}>
                    {(c.thumbnail || c.yt) && <img className="aspect-video w-24 shrink-0 object-cover" src={c.thumbnail || `https://i.ytimg.com/vi/${c.yt}/hqdefault.jpg`} alt="" loading="lazy" />}
                    <span className="min-w-0 flex-1 text-sm">{title} <small className="block text-[var(--phosphor-dim)]">{c.type} · {c.seconds} sec{c.date ? ` · ${c.date}` : ""}{c.tags.length ? ` · ${c.tags.join(", ")}` : ""}</small></span>
                    <Button size="sm" variant="outline" onClick={() => onTest(c)}>Test</Button>
                    <Button size="sm" variant="outline" onClick={() => onAddBlock("program", c.id)}>+ Program</Button>
                    <Button size="sm" variant="outline" onClick={() => onAddBlock("ad", c.id)}>+ Ad</Button>
                    {customIds.has(c.id) && <>
                      <Button size="sm" variant="outline" onClick={() => edit(c)}>Edit</Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${title}`} onClick={() => onRemove(c.id)}>×</Button>
                    </>}
                  </div>;
                })}
              </div>
            </AccordionContent>
          </AccordionItem>)}
        </Accordion> : <p className="py-5 text-sm text-[var(--phosphor-dim)]">No media in the library.</p>}
      </section>
    </div>
  );
}
