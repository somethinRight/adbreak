import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AudioLines, Pause, Play, Plus, Trash2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import Field from '@/components/Field';
import Pick from '@/components/Pick';
import { deleteSoundFile, loadSoundFile, saveSoundFile } from './soundscape';
import { uid } from './schedule';
import type { SoundLayer, SoundLayerKind } from './types';

interface Props { layers: SoundLayer[]; onChange: (layers: SoundLayer[]) => void; playbackActive: boolean }
type PlaybackMode = "off" | "broadcast" | "independent";
const GENERATORS: SoundLayerKind[] = ["rain", "thunder", "spaceship", "white", "pink", "brown", "tone"];
const TITLES: Record<SoundLayerKind, string> = { file: "Audio file", white: "White noise", pink: "Pink noise", brown: "Brown noise", tone: "Tone", rain: "Rain", thunder: "Thunder", spaceship: "Spaceship clang" };

function makeNoiseBuffer(context: AudioContext, kind: "white" | "pink" | "brown", duration = 8) {
  const length = context.sampleRate * duration;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (kind === "brown") {
      brown = (brown + 0.02 * white) / 1.02;
      data[index] = brown * 3.5;
    } else if (kind === "pink") {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else {
      data[index] = white * 0.28;
    }
  }
  return buffer;
}

function makeEventBuffer(context: AudioContext, layer: SoundLayer) {
  const duration = 12;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const data = buffer.getChannelData(0);
  const rate = context.sampleRate;
  const density = Math.max(0.05, layer.density ?? 1);
  const decay = Math.max(0.03, layer.falloff ?? 0.8);
  const baseFrequency = Math.max(20, layer.frequency ?? 440);
  const events = Math.max(1, Math.round(density * duration));

  if (layer.kind === "rain") {
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.012;
    }
    for (let event = 0; event < events; event += 1) {
      const start = Math.floor(Math.random() * data.length);
      const eventDuration = 0.035 + Math.random() * 0.12;
      const samples = Math.min(Math.floor(rate * eventDuration), data.length - start);
      const frequency = baseFrequency * (0.65 + Math.random() * 0.8);
      const phase = Math.random() * Math.PI * 2;
      const amplitude = 0.18 + Math.random() * 0.32;
      for (let sample = 0; sample < samples; sample += 1) {
        const time = sample / rate;
        const envelope = (1 - Math.exp(-time * 1800)) * Math.exp(-time / eventDuration * 0.42);
        const chirp = frequency * (1 - 0.18 * time / eventDuration);
        const tone = Math.sin(2 * Math.PI * chirp * time + phase)
          + 0.24 * Math.sin(2 * Math.PI * chirp * 2.1 * time + phase * 0.7);
        const transient = sample < rate * 0.004 ? (Math.random() * 2 - 1) * (1 - sample / (rate * 0.004)) * 0.16 : 0;
        data[start + sample] = Math.max(-1, Math.min(1, data[start + sample]! + (tone * envelope * amplitude + transient)));
      }
    }
    return buffer;
  }

  if (layer.kind === "thunder") {
    let rumble = 0;
    for (let index = 0; index < data.length; index += 1) {
      rumble = rumble * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[index] = rumble * 2.5;
    }
  }

  for (let event = 0; event < events; event += 1) {
    const start = Math.floor(Math.random() * data.length);
    const eventFrequency = layer.kind === "thunder"
      ? baseFrequency * (0.18 + Math.random() * 0.55)
      : baseFrequency * (0.7 + Math.random() * 0.9);
    const samples = Math.min(Math.floor(rate * decay * 7), data.length - start);
    const phase = Math.random() * Math.PI * 2;
    const amplitude = 0.28 + Math.random() * 0.72;
    for (let sample = 0; sample < samples; sample += 1) {
      const time = sample / rate;
      const envelope = Math.exp(-time / decay);
      const noise = layer.kind === "thunder" && sample < rate * 0.08 ? (Math.random() * 2 - 1) * 0.24 : 0;
      const partials = layer.kind === "spaceship"
        ? Math.sin(2 * Math.PI * eventFrequency * time + phase)
          + 0.42 * Math.sin(2 * Math.PI * eventFrequency * 2.76 * time + phase * 0.7)
          + 0.2 * Math.sin(2 * Math.PI * eventFrequency * 5.4 * time + phase * 1.3)
        : layer.kind === "thunder"
          ? Math.sin(2 * Math.PI * eventFrequency * time + phase) * 0.35
          : Math.sin(2 * Math.PI * eventFrequency * time + phase);
      data[start + sample] = Math.max(-1, Math.min(1, data[start + sample]! + (partials + noise) * envelope * amplitude));
    }
  }
  return buffer;
}

export default function NoiseMachineTab({ layers, onChange, playbackActive }: Props) {
  const [generator, setGenerator] = useState<SoundLayerKind>("pink");
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("off");
  const [error, setError] = useState("");
  const contextRef = useRef<AudioContext | null>(null);
  const gainsRef = useRef(new Map<string, GainNode>());
  const outputRef = useRef<GainNode | null>(null);
  const gateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackModeRef = useRef(playbackMode);
  playbackModeRef.current = playbackMode;
  const sourceKey = useMemo(() => layers.map(layer => `${layer.id}:${layer.kind}:${layer.frequency ?? ""}:${layer.density ?? ""}:${layer.falloff ?? ""}:${layer.enabled}`).join("|"), [layers]);

  useEffect(() => {
    const context = contextRef.current;
    if (playbackMode === "off" || !context) return;
    let cancelled = false;
    const sources: AudioScheduledSourceNode[] = [];
    const gains = new Map<string, GainNode>();
    let master: DynamicsCompressorNode | undefined;
    let output: GainNode | undefined;

    const build = async () => {
      try {
        master = context.createDynamicsCompressor();
        output = context.createGain();
        output.gain.value = playbackModeRef.current === "independent" || playbackActive ? 1 : 0;
        master.connect(output);
        output.connect(context.destination);
        for (const layer of layers.filter(item => item.enabled)) {
          let source: AudioBufferSourceNode | OscillatorNode;
          if (layer.kind === "file") {
            const blob = await loadSoundFile(layer.id);
            if (!blob) throw new Error(`Missing audio file: ${layer.name}`);
            const buffer = await context.decodeAudioData(await blob.arrayBuffer());
            source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
          } else if (layer.kind === "tone") {
            const oscillator = context.createOscillator();
            oscillator.type = "sine";
            oscillator.frequency.value = layer.frequency ?? 110;
            source = oscillator;
          } else if (layer.kind === "white" || layer.kind === "pink" || layer.kind === "brown") {
            const noise = context.createBufferSource();
            noise.buffer = makeNoiseBuffer(context, layer.kind);
            noise.loop = true;
            source = noise;
          } else {
            const generated = context.createBufferSource();
            generated.buffer = makeEventBuffer(context, layer);
            generated.loop = true;
            source = generated;
          }
          if (cancelled) return;
          const gain = context.createGain();
          gain.gain.value = layer.volume * (layer.kind === "thunder" ? 2.5 : 1);
          source.connect(gain);
          if (layer.kind === "white" || layer.kind === "pink" || layer.kind === "brown") {
            const filter = context.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = layer.frequency ?? 6000;
            gain.connect(filter);
            filter.connect(master);
          } else if (layer.kind === "rain" || layer.kind === "thunder") {
            const filter = context.createBiquadFilter();
            filter.type = layer.kind === "rain" ? "highpass" : "lowpass";
            filter.frequency.value = layer.kind === "rain" ? Math.max(400, layer.frequency ?? 5000) : Math.max(40, layer.frequency ?? 180);
            filter.Q.value = layer.kind === "rain" ? 0.7 : 0.35;
            gain.connect(filter);
            filter.connect(master);
          } else {
            gain.connect(master);
          }
          sources.push(source);
          gains.set(layer.id, gain);
          source.start();
        }
        if (!cancelled) {
          gainsRef.current = gains;
          outputRef.current = output ?? null;
          setError("");
        }
      } catch (cause) {
        sources.forEach(source => { try { source.stop(); } catch { /* A source may not have started yet. */ } source.disconnect(); });
        gains.forEach(gain => gain.disconnect());
        master?.disconnect();
        output?.disconnect();
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Audio could not be started.");
      }
    };

    void build();
    return () => {
      cancelled = true;
      sources.forEach(source => { try { source.stop(); } catch { /* A source may not have started yet. */ } source.disconnect(); });
      gains.forEach(gain => gain.disconnect());
      master?.disconnect();
      output?.disconnect();
      if (outputRef.current === output) outputRef.current = null;
      gainsRef.current.clear();
    };
  }, [playbackMode, sourceKey]);

  useEffect(() => {
    const context = contextRef.current, output = outputRef.current;
    if (playbackMode === "off" || !context || !output) return;
    if (gateTimer.current) clearTimeout(gateTimer.current);
    const setGate = (open: boolean) => output.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, 0.12);
    if (playbackMode === "independent") {
      setGate(true);
      return;
    }
    const open = playbackActive;
    if (open) setGate(true);
    else gateTimer.current = setTimeout(() => setGate(false), 2500);
    return () => { if (gateTimer.current) clearTimeout(gateTimer.current); };
  }, [playbackMode, playbackActive]);

  useEffect(() => {
    const context = contextRef.current;
    if (playbackMode === "off" || !context) return;
    const resume = () => {
      if (context.state === "running" || context.state === "closed") return;
      void context.resume().catch(() => setError("Audio playback was suspended by the browser. Enable the soundscape again to resume it."));
    };
    document.addEventListener("visibilitychange", resume);
    context.addEventListener("statechange", resume);
    resume();
    return () => {
      document.removeEventListener("visibilitychange", resume);
      context.removeEventListener("statechange", resume);
    };
  }, [playbackMode]);

  useEffect(() => {
    const context = contextRef.current;
    if (!context || playbackMode === "off") return;
    for (const layer of layers) {
      const gain = gainsRef.current.get(layer.id);
      if (gain) gain.gain.setTargetAtTime(layer.volume * (layer.kind === "thunder" ? 2.5 : 1), context.currentTime, 0.04);
    }
  }, [playbackMode, layers]);

  useEffect(() => () => {
    if (gateTimer.current) clearTimeout(gateTimer.current);
    void contextRef.current?.close();
  }, []);

  const updateLayer = (id: string, patch: Partial<SoundLayer>) => onChange(layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer));
  const addGenerator = () => {
    const defaults: Partial<SoundLayer> = generator === "tone" ? { frequency: 110 }
      : generator === "rain" ? { frequency: 5200, density: 4, falloff: 0.11 }
        : generator === "thunder" ? { frequency: 150, density: 0.22, falloff: 2.5 }
          : generator === "spaceship" ? { frequency: 280, density: 0.45, falloff: 1.2 }
            : { frequency: 6000 };
    const layer: SoundLayer = { id: uid(), name: TITLES[generator], kind: generator, volume: 0.35, enabled: true, ...defaults };
    onChange([...layers, layer]);
  };
  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const added: SoundLayer[] = [];
      for (const file of files) {
        const id = uid();
        await saveSoundFile(id, file);
        added.push({ id, name: file.name, kind: "file", volume: 0.5, enabled: true });
      }
      onChange([...layers, ...added]);
      setError("");
    } catch {
      setError("Audio files could not be stored in this browser.");
    }
  };
  const removeLayer = async (layer: SoundLayer) => {
    if (layer.kind === "file") await deleteSoundFile(layer.id).catch(() => {});
    onChange(layers.filter(item => item.id !== layer.id));
  };
  const choosePlaybackMode = async (mode: PlaybackMode) => {
    if (mode === "off") {
      setPlaybackMode("off");
      return;
    }
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      await context.resume();
      setPlaybackMode(mode);
      setError("");
    } catch {
      setError("Audio playback is unavailable in this browser.");
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
      <section className="min-h-0 space-y-4 overflow-y-auto border border-[var(--phosphor-dim)] p-4">
        <div className="flex items-center gap-3">
          <AudioLines className="size-5 text-phosphor" aria-hidden="true" />
          <div>
            <h2 className="text-sm uppercase tracking-widest">Noise Machine</h2>
            <p className="text-xs text-[var(--phosphor-dim)]">{playbackMode === "independent" ? "Independent playback" : playbackMode === "broadcast" ? playbackActive ? "Following broadcast" : "Waiting for broadcast" : "Soundscape off"}</p>
          </div>
        </div>
        <div role="group" aria-label="Soundscape playback mode" className="flex flex-wrap gap-2">
          <Button variant={playbackMode === "off" ? "signal" : "outline"} onClick={() => void choosePlaybackMode("off")}>
            <Pause aria-hidden="true" />Off
          </Button>
          <Button variant={playbackMode === "broadcast" ? "primary" : "outline"} onClick={() => void choosePlaybackMode("broadcast")}>
            <Play aria-hidden="true" />Follow broadcast
          </Button>
          <Button variant={playbackMode === "independent" ? "primary" : "outline"} onClick={() => void choosePlaybackMode("independent")}>
            <AudioLines aria-hidden="true" />Independent
          </Button>
        </div>
        <Field label="Generated sound">
          <div className="flex gap-2">
            <Pick label="Generated sound type" value={generator} options={GENERATORS.map(kind => ({ value: kind, label: TITLES[kind] }))} onChange={value => setGenerator(value as SoundLayerKind)} />
            <Button variant="outline" aria-label="Add generated sound" title="Add generated sound" onClick={addGenerator}><Plus /></Button>
          </div>
        </Field>
        <Field label="Looping audio files">
          <Input type="file" accept="audio/*" multiple onChange={addFiles} aria-label="Add looping audio files" />
        </Field>
        {error && <p role="alert" className="text-sm text-[var(--warning)]">{error}</p>}
      </section>

      <section className="min-h-0 overflow-y-auto">
        <div className="mb-2 flex items-baseline justify-between border-b border-[var(--phosphor-dim)] pb-2">
          <h2 className="text-sm uppercase tracking-widest">Sound layers</h2>
          <span className="text-xs text-[var(--phosphor-dim)]">{layers.length}</span>
        </div>
        <div className="divide-y divide-[var(--phosphor-dim)]/40">
          {layers.map(layer => (
            <div key={layer.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3">
              <Switch checked={layer.enabled} onCheckedChange={checked => updateLayer(layer.id, { enabled: checked })} aria-label={`Toggle ${layer.name}`} />
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2"><Volume2 className="size-4 shrink-0 text-phosphor-dim" aria-hidden="true" /><span className="truncate text-sm">{layer.name}</span><span className="shrink-0 text-xs text-[var(--phosphor-dim)]">{TITLES[layer.kind]}</span></div>
                {layer.kind === "tone" && <Field label="Frequency (Hz)"><Input type="number" min="20" max="2000" value={layer.frequency ?? 110} onChange={event => updateLayer(layer.id, { frequency: Math.max(20, Math.min(2000, Number(event.target.value) || 20)) })} /></Field>}
                {layer.kind !== "file" && layer.kind !== "tone" && <>
                  <Field label={layer.kind === "rain" ? "Droplet pitch (Hz)" : layer.kind === "thunder" ? "Rumble frequency (Hz)" : layer.kind === "spaceship" ? "Resonance (Hz)" : "Low-pass cutoff (Hz)"}>
                    <Input type="number" min="20" max="10000" step="10" value={layer.frequency ?? (layer.kind === "thunder" ? 150 : 5000)} onChange={event => updateLayer(layer.id, { frequency: Math.max(20, Math.min(10000, Number(event.target.value) || 20)) })} />
                  </Field>
                  {(layer.kind === "rain" || layer.kind === "thunder" || layer.kind === "spaceship") && <>
                    <Field label={`Event density · ${layer.density ?? 1}/sec`}>
                      <Slider min={0.05} max={layer.kind === "rain" ? 12 : 2} step={0.05} value={[layer.density ?? 1]} onValueChange={value => updateLayer(layer.id, { density: Array.isArray(value) ? value[0] ?? 0.05 : value })} aria-label={`${layer.name} event density`} />
                    </Field>
                    <Field label={`Falloff · ${layer.falloff ?? 1}s`}>
                      <Slider min={0.05} max={layer.kind === "rain" ? 0.8 : 6} step={0.05} value={[layer.falloff ?? 1]} onValueChange={value => updateLayer(layer.id, { falloff: Array.isArray(value) ? value[0] ?? 0.05 : value })} aria-label={`${layer.name} falloff`} />
                    </Field>
                  </>}
                </>}
                <Slider min={0} max={100} step={1} value={[Math.round(layer.volume * 100)]} onValueChange={value => updateLayer(layer.id, { volume: (Array.isArray(value) ? value[0] ?? 0 : value) / 100 })} aria-label={`${layer.name} volume`} />
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${layer.name}`} title={`Remove ${layer.name}`} onClick={() => void removeLayer(layer)}><Trash2 /></Button>
            </div>
          ))}
          {!layers.length && <p className="py-8 text-center text-sm text-[var(--phosphor-dim)]">No sound layers configured.</p>}
        </div>
      </section>
    </div>
  );
}