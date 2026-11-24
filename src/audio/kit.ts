import type { AudioEngine, LoadedKit, PadDef } from './engine';
import { detectOnsets, gridMarkers, mixToMono, snapMarkersToOnsets, type Slice } from './slicer';

interface OneShotManifest {
  id: string;
  name: string;
  type: 'oneshot';
  pads: {
    pad: number;
    sound: string;
    name: string;
    color: string;
    choke?: string;
    gain?: number;
    layers: { upTo: number; files: string[] }[];
  }[];
}

interface SliceManifest {
  id: string;
  name: string;
  type: 'slices';
  file: string;
  bars: number;
  slicesPerBar: number;
  pick: number[];
}

const SLICE_COLORS = ['#ff5a3c', '#ff8a3c', '#ffc23c', '#d6e04a', '#7dffb0', '#3cd6ff', '#6fa8ff', '#c79bff'];

async function fetchBuffer(engine: AudioEngine, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${url}: ${res.status}`);
  return engine.decode(await res.arrayBuffer());
}

export async function loadBuiltinKit(engine: AudioEngine, id: string): Promise<LoadedKit> {
  const base = `/kits/${id}/`;
  const res = await fetch(base + 'kit.json');
  if (!res.ok) throw new Error(`Кит ${id} не найден`);
  const man = (await res.json()) as OneShotManifest | SliceManifest;

  if (man.type === 'slices') {
    const buffer = await fetchBuffer(engine, base + man.file);
    const mono = mixToMono(channelsOf(buffer));
    const total = man.bars * man.slicesPerBar;
    const onsets = detectOnsets(mono, buffer.sampleRate, 0.75);
    const grid = snapMarkersToOnsets(
      gridMarkers(buffer.length, total),
      onsets,
      Math.round(buffer.sampleRate * 0.035),
    );
    grid[0] = 0;
    const slices: Slice[] = man.pick.map((i) => ({
      start: grid[i],
      end: i + 1 < grid.length ? grid[i + 1] : buffer.length,
    }));
    const kit = buildSliceKit(engine, man.id, man.name, buffer, slices);
    kit.builtin = true;
    return kit;
  }

  const files = new Set<string>();
  for (const p of man.pads) for (const l of p.layers) for (const f of l.files) files.add(f);
  const buffers = new Map<string, AudioBuffer>();
  await Promise.all(
    [...files].map(async (f) => {
      buffers.set(f, await fetchBuffer(engine, base + f));
    }),
  );
  const pads: (PadDef | null)[] = new Array(16).fill(null);
  for (const p of man.pads) {
    pads[p.pad - 1] = {
      pad: p.pad,
      sound: p.sound,
      name: p.name,
      color: p.color,
      choke: p.choke,
      gain: p.gain ?? 1,
      layers: p.layers.map((l) => ({ upTo: l.upTo, buffers: l.files.map((f) => buffers.get(f)!) })),
    };
  }
  return { id: man.id, name: man.name, kind: 'oneshot', pads, builtin: true };
}

export function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

/** Вырезает слайс в отдельный буфер с микрофейдами, чтобы не было щелчков на границах. */
export function cutSlice(ctx: BaseAudioContext, buffer: AudioBuffer, s: Slice): AudioBuffer {
  const len = Math.max(1, s.end - s.start);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, buffer.sampleRate);
  const fadeIn = Math.min(len >> 1, Math.round(buffer.sampleRate * 0.0005));
  const fadeOut = Math.min(len >> 1, Math.round(buffer.sampleRate * 0.004));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(s.start, s.end);
    const dst = out.getChannelData(c);
    dst.set(src);
    for (let i = 0; i < fadeIn; i++) dst[i] *= i / fadeIn;
    for (let i = 0; i < fadeOut; i++) dst[len - 1 - i] *= i / fadeOut;
  }
  return out;
}

/** Собирает кит из слайсов: слайс i → пэд i+1, звуки s1…s16, все в одной choke-группе (моно). */
export function buildSliceKit(
  engine: AudioEngine,
  id: string,
  name: string,
  buffer: AudioBuffer,
  slices: Slice[],
): LoadedKit {
  const pads: (PadDef | null)[] = new Array(16).fill(null);
  slices.slice(0, 16).forEach((s, i) => {
    pads[i] = {
      pad: i + 1,
      sound: `s${i + 1}`,
      name: `Слайс ${i + 1}`,
      color: SLICE_COLORS[i % SLICE_COLORS.length],
      choke: 'slices',
      gain: 1,
      layers: [{ upTo: 127, buffers: [cutSlice(engine.ctx, buffer, s)] }],
    };
  });
  return { id, name, kind: 'slices', pads, builtin: false };
}
