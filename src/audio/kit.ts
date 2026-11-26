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

/** Запись списка китов (public/kits/index.json). */
export interface KitIndexEntry {
  id: string;
  name: string;
  kind: 'oneshot' | 'slices';
  /** Набор файлов, без которого кит недоступен (например, 'sampleradar' — не хранится в git). */
  requires?: string;
  /** Манифест прямо в списке (брейки-слайсы) — тогда отдельного kit.json нет. */
  manifest?: SliceManifest;
}

/** Пул отдельных сэмплов для замены звуков кита (public/kits/pool.json). */
export interface SamplePool {
  categories: Record<string, { gain: number; files: string[] }>;
  /** звук → категория */
  sounds: Record<string, string>;
}

/** Замены звуков: звук → путь файла из пула (относительно /kits/). */
export type SoundOverrides = Record<string, string>;

const KITS = '/kits/';
const SLICE_COLORS = ['#ff5a3c', '#ff8a3c', '#ffc23c', '#d6e04a', '#7dffb0', '#3cd6ff', '#6fa8ff', '#c79bff'];

const bufferCache = new Map<string, Promise<AudioBuffer>>();

/** Загружает и декодирует файл; повторные обращения к тому же URL берутся из кэша. */
export function fetchBuffer(engine: AudioEngine, url: string): Promise<AudioBuffer> {
  let p = bufferCache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      const type = res.headers.get('content-type') ?? '';
      // Dev-сервер на отсутствующий файл отдаёт index.html с кодом 200 — проверяем тип.
      if (!res.ok || type.startsWith('text/html')) throw new Error(`Нет файла ${decodeURI(url)}`);
      return engine.decode(await res.arrayBuffer());
    })();
    bufferCache.set(url, p);
    p.catch(() => bufferCache.delete(url));
  }
  return p;
}

export async function loadKitIndex(): Promise<KitIndexEntry[]> {
  const res = await fetch(KITS + 'index.json');
  if (!res.ok) throw new Error('Не найден список китов');
  return (await res.json()) as KitIndexEntry[];
}

/** Пул есть только если скачаны сэмплы SampleRadar; иначе null. */
export async function loadPool(): Promise<SamplePool | null> {
  try {
    const res = await fetch(KITS + 'pool.json');
    if (!res.ok || (res.headers.get('content-type') ?? '').startsWith('text/html')) return null;
    const pool = (await res.json()) as SamplePool;
    const probe = Object.values(pool.categories)[0]?.files[0];
    if (!probe) return null;
    const head = await fetch(KITS + probe, { method: 'HEAD' });
    if (!head.ok || (head.headers.get('content-type') ?? '').startsWith('text/html')) return null;
    return pool;
  } catch {
    return null;
  }
}

export function poolFilesFor(pool: SamplePool | null, sound: string): string[] {
  const cat = pool?.sounds[sound];
  return cat ? (pool!.categories[cat]?.files ?? []) : [];
}

export function sampleLabel(file: string): string {
  return file.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/_/g, '&');
}

export async function loadBuiltinKit(engine: AudioEngine, id: string, inline?: SliceManifest): Promise<LoadedKit> {
  const base = `${KITS}${id}/`;
  let man: OneShotManifest | SliceManifest;
  if (inline) man = inline;
  else {
    const res = await fetch(base + 'kit.json');
    if (!res.ok || (res.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error(`Кит ${id} не найден`);
    man = (await res.json()) as OneShotManifest | SliceManifest;
  }

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

/**
 * Возвращает копию кита, в которой указанные звуки заменены сэмплами из пула.
 * Заменённый звук играет одним сэмплом на всех своих пэдах; тихие удары получаются за счёт громкости.
 */
export async function applyOverrides(
  engine: AudioEngine,
  kit: LoadedKit,
  overrides: SoundOverrides | undefined,
  pool: SamplePool | null,
): Promise<LoadedKit> {
  if (!overrides || !pool || kit.kind !== 'oneshot') return kit;
  const entries = Object.entries(overrides).filter(([sound, file]) => poolFilesFor(pool, sound).includes(file));
  if (!entries.length) return kit;
  const loaded = new Map<string, { buffer: AudioBuffer; gain: number }>();
  await Promise.all(
    entries.map(async ([sound, file]) => {
      try {
        const buffer = await fetchBuffer(engine, KITS + file);
        loaded.set(sound, { buffer, gain: pool.categories[pool.sounds[sound]]?.gain ?? 0.8 });
      } catch {
        /* файла нет — оставляем звук кита */
      }
    }),
  );
  return {
    ...kit,
    pads: kit.pads.map((p) => {
      const o = p && loaded.get(p.sound);
      return p && o ? { ...p, gain: o.gain, layers: [{ upTo: 127, buffers: [o.buffer] }] } : p;
    }),
  };
}

/** Замены по пэдам (свободная игра): номер пэда → файл из пула. */
export type PadOverrides = Record<string, string>;

const CATEGORY_COLORS: Record<string, string> = {
  kicks: '#ff5a3c',
  snares: '#ffc23c',
  hats: '#3cd6ff',
  cymbals: '#7dffb0',
  perc: '#ff9a6b',
  breaks: '#c79bff',
};

export function poolCategoryOf(pool: SamplePool | null, file: string): string | undefined {
  if (!pool) return undefined;
  return Object.keys(pool.categories).find((c) => pool.categories[c].files.includes(file));
}

/**
 * Возвращает копию кита, где на указанные пэды положены любые сэмплы из пула
 * (в том числе на пустые пэды и поверх слайсов). Используется только в свободной игре:
 * в уроках пэд обязан играть свой звук.
 */
export async function applyPadOverrides(
  engine: AudioEngine,
  kit: LoadedKit,
  overrides: PadOverrides | undefined,
  pool: SamplePool | null,
): Promise<LoadedKit> {
  if (!overrides || !pool) return kit;
  const pads = [...kit.pads];
  let changed = false;
  await Promise.all(
    Object.entries(overrides).map(async ([padNo, file]) => {
      const i = Number(padNo) - 1;
      const cat = poolCategoryOf(pool, file);
      if (!(i >= 0 && i < 16) || !cat) return;
      try {
        const buffer = await fetchBuffer(engine, KITS + file);
        pads[i] = {
          pad: i + 1,
          sound: pads[i]?.sound ?? `p${i + 1}`,
          name: sampleLabel(file),
          color: CATEGORY_COLORS[cat] ?? '#8a93a6',
          choke: cat === 'hats' ? 'hh' : undefined,
          gain: pool.categories[cat].gain,
          layers: [{ upTo: 127, buffers: [buffer] }],
        };
        changed = true;
      } catch {
        /* файла нет — пэд остаётся как в ките */
      }
    }),
  );
  return changed ? { ...kit, pads } : kit;
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
