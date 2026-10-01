import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Field from '@/components/Field';
import { uid, ytId } from './schedule';
import type { MediaItem } from './types';

interface Form { url: string; title: string; type: string; mins: string | number; tags: string; date: string }
interface Props {
  library: MediaItem[];
  custom: MediaItem[];
  onAdd: (c: MediaItem) => void;
  onUpdate: (c: MediaItem) => void;
  onRemove: (id: string) => void;
  onTest: (c: MediaItem) => void;
  onAddBlock: (kind: "program" | "ad", id: string) => void;
}

export default function YouTubeBox({ library, custom, onAdd, onUpdate, onRemove, onTest, onAddBlock }: Props) {
  const emptyForm: Form = { url: "", title: "", type: "video", mins: 5, tags: "", date: "" };
  const [f, setF] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const customIds = new Set(custom.map(c => c.id));
  const up = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const id = ytId(f.url);
    if (!id) return alert("That doesn't look like a YouTube link.");
    setAdding(true);
    let metadata: { title?: string; thumbnail_url?: string } = {};
    try {
      const url = `https://www.youtube.com/watch?v=${id}`;
      const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (response.ok) metadata = await response.json();
    } catch { /* Use the provided title and standard thumbnail if metadata is unavailable. */ }
    const existing = editingId ? custom.find(c => c.id === editingId) : undefined;
    const item: MediaItem = { id: existing?.id || "yt_" + uid(), yt: id, url: existing?.url, title: f.title.trim() || metadata.title || "YouTube " + id,
      type: f.type.trim().toLowerCase() || "video", tags: f.tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
      mins: Math.max(0.1, +f.mins || 5), date: f.date || undefined,
      thumbnail: metadata.thumbnail_url || existing?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    if (existing) onUpdate(item); else onAdd(item);
    setF(emptyForm);
    setEditingId(null);
    setAdding(false);
  };
  const edit = (c: MediaItem) => {
    setEditingId(c.id);
    setF({ url: c.yt ? `https://www.youtube.com/watch?v=${c.yt}` : c.url || "", title: c.title, type: c.type,
      mins: c.mins, tags: c.tags.join(", "), date: c.date || "" });
  };
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1">
      <section className="min-h-0 overflow-y-auto border border-[var(--phosphor-dim)] p-3">
      <h2 className="text-sm uppercase tracking-widest">{editingId ? "Edit video" : "Add YouTube videos"}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field className="col-span-2" label="YouTube link" htmlFor="yturl"><Input id="yturl" placeholder="https://www.youtube.com/watch?v=…" value={f.url} onChange={up("url")} /></Field>
        <Field className="col-span-2" label="Title (optional)" htmlFor="yttitle"><Input id="yttitle" value={f.title} onChange={up("title")} /></Field>
        <Field label="Media type" htmlFor="yttype"><Input id="yttype" list="typelist" value={f.type} onChange={up("type")} /></Field>
        <Field label="Length (minutes)" htmlFor="ytmins"><Input id="ytmins" type="number" min="0.1" step="0.1" value={f.mins} onChange={up("mins")} /></Field>
        <Field label="Date" htmlFor="ytdate"><Input id="ytdate" type="date" value={f.date} onChange={up("date")} /></Field>
        <Field className="col-span-2" label="Tags (comma separated)" htmlFor="yttags"><Input id="yttags" value={f.tags} onChange={up("tags")} /></Field>
        <Button variant="primary" className="col-span-2" disabled={adding} onClick={save}>{adding ? "Fetching metadata…" : editingId ? "Save changes" : "Add to library"}</Button>
        {editingId && <Button variant="outline" className="col-span-2" onClick={() => { setF(emptyForm); setEditingId(null); }}>Cancel edit</Button>}
      </div>
      </section>

      <section className="min-h-0 overflow-y-auto">
        <div className="flex items-baseline justify-between border-b border-[var(--phosphor-dim)] pb-2">
          <h2 className="text-sm uppercase tracking-widest">Library</h2>
          <span className="text-xs text-[var(--phosphor-dim)]">{library.length} items</span>
        </div>
        <div className="divide-y divide-[var(--phosphor-dim)]/40">
          {library.map(c => (
            <div className="flex flex-wrap items-center gap-2 py-2" key={c.id}>
              {(c.thumbnail || c.yt) && <img className="aspect-video w-24 shrink-0 object-cover" src={c.thumbnail || `https://i.ytimg.com/vi/${c.yt}/hqdefault.jpg`} alt="" loading="lazy" />}
              <span className="min-w-0 flex-1 text-sm">{c.title} <small className="block text-[var(--phosphor-dim)]">{c.type} · {c.mins} min{c.date ? ` · ${c.date}` : ""}{c.tags.length ? ` · ${c.tags.join(", ")}` : ""}</small></span>
              <Button size="sm" variant="outline" onClick={() => onTest(c)}>Test</Button>
              <Button size="sm" variant="outline" onClick={() => onAddBlock("program", c.id)}>+ Program</Button>
              <Button size="sm" variant="outline" onClick={() => onAddBlock("ad", c.id)}>+ Ad</Button>
              {customIds.has(c.id) && <>
                <Button size="sm" variant="outline" onClick={() => edit(c)}>Edit</Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c.title}`} onClick={() => onRemove(c.id)}>×</Button>
              </>}
            </div>
          ))}
          {!library.length && <p className="py-5 text-sm text-[var(--phosphor-dim)]">No videos in the library.</p>}
        </div>
      </section>
      <datalist id="typelist">{[...new Set(custom.map(c => c.type).concat(["video", "movie", "episode", "commercial", "bumper", "psa"]))].map(t => <option key={t} value={t} />)}</datalist>
    </div>
  );
}
