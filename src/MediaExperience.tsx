import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Disc3, Pause, Play, SkipBack, SkipForward, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadSoundFile, saveSoundFile, deleteSoundFile } from './soundscape';
import { uid } from './schedule';
import type { MediaItem } from './types';

type PlayerStyle = 'somflix' | 'somtube' | 'somnify';
interface Props { mode: PlayerStyle; library: MediaItem[]; onAddAudio: (item: MediaItem) => void; onRemove: (id: string) => void }

const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const titleOf = (item: MediaItem) => item.type === 'show' ? `${item.showTitle || item.title}${item.episodeName ? ` · ${item.episodeName}` : ''}` : item.title;

export default function MediaExperience({ mode, library, onAddAudio, onRemove }: Props) {
  const entries = useMemo(() => library.filter(item => mode === 'somnify' ? item.type === 'music' : item.type !== 'music'), [library, mode]);
  const [selectedId, setSelectedId] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selected = entries.find(item => item.id === selectedId) ?? entries[0];

  const formatClock = (value: number) => {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    const minutes = Math.floor(safe / 60);
    const seconds = Math.floor(safe % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const seekTrack = (delta: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); setIsPlaying(true); }
      catch { setMessage('Audio playback is blocked until the user interacts.'); }
      return;
    }
    audio.pause();
    setIsPlaying(false);
  };

  useEffect(() => setPlaying(false), [selected?.id]);

  useEffect(() => {
    setAudioUrl('');
    setCurrentTime(0);
    setTrackDuration(selected?.seconds ?? 0);
    setIsPlaying(false);
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    if (mode !== 'somnify' || !selected?.audioFileId) return;
    let objectUrl = '';
    let cancelled = false;
    void loadSoundFile(selected.audioFileId).then(blob => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setAudioUrl(objectUrl);
    }).catch(() => setMessage(`Could not load ${selected.title}.`));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mode, selected?.audioFileId, selected?.id, selected?.seconds, selected?.title]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const syncMeta = () => {
      setTrackDuration(Number.isFinite(audio.duration) ? audio.duration : selected?.seconds ?? 0);
      setCurrentTime(audio.currentTime || 0);
    };
    const handleTime = () => setCurrentTime(audio.currentTime || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', syncMeta);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('loadedmetadata', syncMeta);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [selected?.id, selected?.seconds]);

  const addAudioFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setMessage(`Importing ${files.length} track${files.length === 1 ? '' : 's'}…`);
    try {
      for (const file of files) {
        const id = `audio_${uid()}`;
        await saveSoundFile(id, file);
        const url = URL.createObjectURL(file);
        const seconds = await new Promise<number>(resolve => {
          const audio = new Audio();
          audio.preload = 'metadata';
          audio.onloadedmetadata = () => { const duration = audio.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(duration) ? Math.round(duration) : 180); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(180); };
          audio.src = url;
        });
        onAddAudio({ id, audioFileId: id, title: file.name.replace(/\.[^.]+$/, ''), type: 'music', tags: [], seconds });
        setSelectedId(id);
      }
      setMessage(`${files.length} track${files.length === 1 ? '' : 's'} added.`);
    } catch {
      setMessage('Audio files could not be stored in this browser.');
    }
  };

  const removeTrack = async (item: MediaItem) => {
    if (item.audioFileId) await deleteSoundFile(item.audioFileId).catch(() => {});
    onRemove(item.id);
    if (selectedId === item.id) setSelectedId('');
  };

  const mediaFrame = (item: MediaItem, compact = false, autoplay = mode !== 'somflix') => {
    if (item.yt) {
      const query = new URLSearchParams({ autoplay: compact || !autoplay ? '0' : '1', controls: '1', rel: '0', playsinline: '1' });
      return <iframe key={item.id} className="absolute inset-0 size-full border-0" title={titleOf(item)} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen src={`https://www.youtube-nocookie.com/embed/${item.yt}?${query}`} />;
    }
    if (item.url && mode === 'somnify') return <audio key={item.id} className="w-full" controls autoPlay src={audioUrl || item.url} />;
    if (item.url) return <video key={item.id} className="absolute inset-0 size-full bg-black object-contain" controls autoPlay={autoplay} src={item.url} />;
    return <div className="absolute inset-0 grid place-items-center text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">No playable source</div>;
  };

  if (mode === 'somnify') {
    return (
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(9rem,0.7fr)] gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1">
        <section className="min-h-0 overflow-y-auto border border-[var(--phosphor-dim)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--phosphor-dim)] pb-3">
            <div><p className="text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">Somnify / Library</p><h2 className="text-sm uppercase tracking-widest">Your tracks · {entries.length}</h2></div>
            <Button size="icon-sm" variant="outline" title="Add audio files" aria-label="Add audio files" onClick={() => fileInput.current?.click()}><Disc3 /></Button>
            <input ref={fileInput} className="sr-only" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" multiple onChange={addAudioFiles} />
          </div>
          <div className="divide-y divide-[var(--phosphor-dim)]/40">
            {entries.map((item, index) => <div key={item.id} className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-2 ${selected?.id === item.id ? 'text-[var(--phosphor-bright)]' : ''}`}>
              <button type="button" aria-label={`Play ${titleOf(item)}`} aria-pressed={selected?.id === item.id} className="grid size-8 place-items-center border border-[var(--phosphor-dim)] hover:border-[var(--phosphor)]" onClick={() => setSelectedId(item.id)}><Play className="size-3.5" /></button>
              <span className="min-w-0 truncate text-sm">{String(index + 1).padStart(2, '0')} · {titleOf(item)}<small className="block text-xs text-[var(--phosphor-dim)]">{item.tags.join(' · ') || item.type}</small></span>
              <span className="text-xs tabular-nums text-[var(--phosphor-dim)]">{durationLabel(item.seconds)}</span>
              {item.audioFileId && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${titleOf(item)}`} title="Remove track" onClick={() => void removeTrack(item)}><Trash2 /></Button>}
            </div>)}
            {!entries.length && <p className="py-6 text-sm text-[var(--phosphor-dim)]">Add audio files to start a library.</p>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col justify-center gap-4 border border-[var(--phosphor-dim)] p-4 lg:p-6">
          {selected ? <>
            <div className="mx-auto grid aspect-square w-full max-w-sm place-items-center overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel-sunken)] p-3 text-center">
              {selected.thumbnail ? <img className="h-full w-full object-contain" src={selected.thumbnail} alt="" /> : <div><Disc3 className="mx-auto mb-4 size-16 text-[var(--phosphor)]" /><p className="text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">Somnify / Now playing</p></div>}
            </div>
            <div className="mx-auto w-full max-w-xl text-center">
              <h2 className="truncate text-lg uppercase tracking-widest">{titleOf(selected)}</h2>
              <p className="mt-1 text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">{selected.tags.join(' · ') || 'Local collection'}</p>
              <div className="mt-4">
                {selected.yt ? <div className="relative aspect-video overflow-hidden bg-black">{mediaFrame(selected)}</div> : <div className="rounded-none border border-[var(--phosphor-dim)] bg-[var(--panel-sunken)] p-3 shadow-panel">
                  <audio ref={audioRef} className="hidden" src={audioUrl || selected.url || ''} autoPlay={false} />
                  <div className="flex items-center gap-2">
                    <Button size="icon-sm" variant="outline" type="button" aria-label="Rewind 10 seconds" onClick={() => seekTrack(-10)}><SkipBack className="size-3.5" /></Button>
                    <Button size="icon-sm" variant="primary" type="button" aria-label={isPlaying ? 'Pause audio' : 'Play audio'} onClick={() => void togglePlayback()}>{isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</Button>
                    <Button size="icon-sm" variant="outline" type="button" aria-label="Fast forward 10 seconds" onClick={() => seekTrack(10)}><SkipForward className="size-3.5" /></Button>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--phosphor-dim)]">
                        <span>{formatClock(currentTime)}</span>
                        <span>{formatClock(trackDuration)}</span>
                      </div>
                      <div className="h-2 border border-[var(--phosphor-dim)] bg-[var(--panel)]">
                        <div className="h-full bg-gradient-to-r from-[var(--phosphor)] via-[var(--signal)] to-[var(--phosphor-bright)] transition-[width] duration-150" style={{ width: `${trackDuration ? (currentTime / trackDuration) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                </div>}
              </div>
            </div>
          </> : <div className="text-center text-sm text-[var(--phosphor-dim)]">Somnify is ready when you are.</div>}
          {message && <p aria-live="polite" className="text-center text-xs text-[var(--phosphor-dim)]">{message}</p>}
        </section>
      </div>
    );
  }

  if (mode === 'somflix') {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <section className="grid gap-4 border-b border-[var(--phosphor-dim)] pb-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.8fr)]">
          <div className="relative aspect-video overflow-hidden border border-[var(--phosphor-dim)] bg-black">
            {selected ? mediaFrame(selected, false, playing) : <div className="absolute inset-0 grid place-items-center text-sm uppercase tracking-widest text-[var(--phosphor-dim)]">Your screen is waiting</div>}
          </div>
          <div className="flex flex-col justify-center gap-3 py-2">
            <p className="text-xs uppercase tracking-widest text-[var(--signal)]">SomFlix · Featured</p>
            <h2 className="text-xl uppercase tracking-widest">{selected ? titleOf(selected) : 'Choose something to watch'}</h2>
            {selected && <p className="text-sm text-[var(--phosphor-dim)]">{[selected.date, selected.type, durationLabel(selected.seconds)].filter(Boolean).join(' · ')}</p>}
            {selected && <div><Button variant="primary" onClick={() => setPlaying(true)}><Play />Play selection</Button></div>}
          </div>
        </section>
        <section className="py-4">
          <div className="mb-3 flex items-baseline justify-between"><h2 className="text-sm uppercase tracking-widest">Continue exploring</h2><span className="text-xs text-[var(--phosphor-dim)]">{entries.length} titles</span></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {entries.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} className={`min-w-0 text-left ${selected?.id === item.id ? 'text-[var(--phosphor-bright)]' : 'text-foreground'}`} onClick={() => setSelectedId(item.id)}>
              <div className="relative aspect-video overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]">{item.thumbnail ? <img src={item.thumbnail} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-xs uppercase text-[var(--phosphor-dim)]">SomFlix</div>}<span className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-1 text-xs">{durationLabel(item.seconds)}</span></div>
              <span className="mt-1 block truncate text-xs uppercase tracking-widest">{titleOf(item)}</span>
            </button>)}
          </div>
          {!entries.length && <p className="py-5 text-sm text-[var(--phosphor-dim)]">Add video titles in Library.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(9rem,0.7fr)] gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)] lg:grid-rows-1">
      <section className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden border border-[var(--phosphor-dim)] bg-black">
          {selected ? mediaFrame(selected) : <div className="absolute inset-0 grid place-items-center text-xs uppercase tracking-widest text-[var(--phosphor-dim)]">SomTube / No videos in queue</div>}
        </div>
        <div className="min-h-0 overflow-y-auto border-b border-[var(--phosphor-dim)] pb-3">
          <p className="text-xs uppercase tracking-widest text-[var(--signal)]">SomTube · Now showing</p>
          <h2 className="mt-2 text-base uppercase tracking-widest">{selected ? titleOf(selected) : 'Pick a video from the queue'}</h2>
          {selected && <p className="mt-1 text-xs text-[var(--phosphor-dim)]">{selected.type} · {durationLabel(selected.seconds)}{selected.tags.length ? ` · ${selected.tags.join(', ')}` : ''}</p>}
        </div>
      </section>
      <aside className="min-h-0 overflow-y-auto border border-[var(--phosphor-dim)] p-3">
        <div className="mb-2 flex items-baseline justify-between border-b border-[var(--phosphor-dim)] pb-2"><h2 className="text-sm uppercase tracking-widest">Up next</h2><span className="text-xs text-[var(--phosphor-dim)]">{entries.length}</span></div>
        <div className="divide-y divide-[var(--phosphor-dim)]/40">
          {entries.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} className={`flex w-full gap-3 py-2 text-left ${selected?.id === item.id ? 'text-[var(--phosphor-bright)]' : ''}`} onClick={() => setSelectedId(item.id)}>
            <div className="aspect-video w-28 shrink-0 overflow-hidden border border-[var(--phosphor-dim)] bg-[var(--panel)]">{item.thumbnail ? <img src={item.thumbnail} alt="" className="size-full object-cover" loading="lazy" /> : <span className="grid size-full place-items-center text-2xs uppercase text-[var(--phosphor-dim)]">Video</span>}</div>
            <span className="min-w-0 text-xs">{titleOf(item)}<small className="mt-1 block text-[var(--phosphor-dim)]">{item.type} · {durationLabel(item.seconds)}</small></span>
          </button>)}
          {!entries.length && <p className="py-5 text-sm text-[var(--phosphor-dim)]">Add video titles in Library.</p>}
        </div>
      </aside>
    </div>
  );
}
