import { useRef, useState, type ChangeEvent } from 'react';
import { AudioLines, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uid } from './schedule';
import { saveSoundFile } from './soundscape';
import type { MediaItem, SoundLayer } from './types';

interface Props {
  loops: MediaItem[];
  onAdd: (item: MediaItem) => void;
  onRemove: (id: string) => void;
  onUse: (layer: SoundLayer) => void;
}

function durationOf(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  return new Promise(resolve => {
    const audio = new Audio();
    const finish = (seconds: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : 180);
    };
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(180);
    audio.src = url;
  });
}

export default function LoopsTab({ loops, onAdd, onRemove, onUse }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setMessage(`Saving ${files.length} loop${files.length === 1 ? '' : 's'}…`);
    try {
      for (const file of files) {
        const id = `loop_${uid()}`;
        await saveSoundFile(id, file);
        onAdd({ id, audioFileId: id, title: file.name.replace(/\.[^.]+$/, ''), type: 'loop', tags: [], seconds: await durationOf(file) });
      }
      setMessage(`${files.length} loop${files.length === 1 ? '' : 's'} added.`);
    } catch {
      setMessage('Audio files could not be stored in this browser.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="h-full min-h-0 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--phosphor-dim)] py-2">
        <div>
          <h2 className="text-sm uppercase tracking-widest">Audio loops</h2>
          <p className="text-xs text-[var(--phosphor-dim)]">{loops.length} saved files</p>
        </div>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}><Plus aria-hidden="true" />Add local audio</Button>
        <input ref={inputRef} className="sr-only" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" multiple onChange={importFiles} aria-label="Add local audio loops" />
      </div>
      {message && <p aria-live="polite" className="py-2 text-xs text-[var(--phosphor-dim)]">{message}</p>}
      <div className="divide-y divide-[var(--phosphor-dim)]/40">
        {loops.map(loop => (
          <div key={loop.id} className="flex flex-wrap items-center gap-3 py-3">
            <AudioLines className="size-4 shrink-0 text-phosphor-dim" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">{loop.title}<small className="block text-xs text-[var(--phosphor-dim)]">{Math.floor(loop.seconds / 60)}:{String(loop.seconds % 60).padStart(2, '0')} · Local audio</small></span>
            <Button size="sm" variant="outline" onClick={() => onUse({ id: uid(), audioFileId: loop.audioFileId ?? loop.id, name: loop.title, kind: 'file', volume: 0.5, enabled: true, lowPassHz: 500, midPassHz: 1500, highPassHz: 3000 })}>Add to soundscape</Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${loop.title}`} title="Remove from library" onClick={() => onRemove(loop.id)}><Trash2 /></Button>
          </div>
        ))}
        {!loops.length && <p className="py-8 text-center text-sm text-[var(--phosphor-dim)]">No loops saved. Add an audio file to reuse it in soundscapes.</p>}
      </div>
    </section>
  );
}