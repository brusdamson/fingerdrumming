// Чистая логика нарезки брейка: без Web Audio, работает на Float32Array.

export interface Slice {
  start: number; // в сэмплах
  end: number;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Огибающая: RMS сигнала + RMS его «верхов» (чтобы хэты поверх хвоста бочки тоже находились). */
function envelope(x: Float32Array, hop: number, win: number): Float32Array {
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    let e = 0;
    let eh = 0;
    for (let i = s; i < s + win; i++) {
      const v = x[i];
      const hp = v - (i > 0 ? x[i - 1] : 0);
      e += v * v;
      eh += hp * hp;
    }
    env[f] = Math.sqrt(e / win) + Math.sqrt(eh / win);
  }
  return env;
}

/**
 * Поиск транзиентов. sensitivity 0..1: чем выше, тем больше слайсов.
 * Возвращает позиции (в сэмплах) начала атак, по возрастанию.
 */
export function detectOnsets(
  x: Float32Array,
  sampleRate: number,
  sensitivity = 0.5,
  minGapSec = 0.06,
): number[] {
  const hop = Math.max(1, Math.round(sampleRate * 0.003));
  const win = hop * 3;
  const env = envelope(x, hop, win);
  const n = env.length;
  if (n < 8) return [];

  // Новизна: насколько огибающая выросла над недавним максимумом.
  const nov = new Float32Array(n);
  let maxNov = 0;
  for (let i = 3; i < n; i++) {
    const prev = Math.max(env[i - 1], env[i - 2], env[i - 3]);
    const d = env[i] - prev;
    if (d > 0) {
      nov[i] = d;
      if (d > maxNov) maxNov = d;
    }
  }
  if (maxNov <= 1e-6) return [];

  const s = Math.min(1, Math.max(0, sensitivity));
  const thr = maxNov * (0.5 * Math.pow(0.04, s)); // 0.5 … 0.02 от максимума
  const gap = Math.max(1, Math.round((minGapSec * sampleRate) / hop));

  const peaks: number[] = [];
  for (let i = 3; i < n; i++) {
    if (nov[i] < thr) continue;
    // Суммируем рост по соседним кадрам: атака может занять 2–3 кадра.
    let isMax = true;
    for (let j = Math.max(0, i - gap); j <= Math.min(n - 1, i + gap); j++) {
      if (nov[j] > nov[i] || (nov[j] === nov[i] && j < i)) {
        isMax = false;
        break;
      }
    }
    if (isMax) peaks.push(i);
  }

  const onsets: number[] = [];
  for (const p of peaks) {
    // Откатываемся к началу подъёма огибающей.
    let j = p;
    let steps = 0;
    while (j > 0 && steps < 8 && env[j - 1] < env[j] * 0.85) {
      j--;
      steps++;
    }
    // Кадр j — первый, чьё окно задело атаку. Уточняем до сэмпла: первое место,
    // где сигнал заметно поднимается над фоном перед ударом.
    const from = Math.max(0, j * hop);
    const to = Math.min(x.length, p * hop + win);
    let bg = 0;
    for (let i = Math.max(0, from - 2 * hop); i < from; i++) bg = Math.max(bg, Math.abs(x[i]));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
    const level = bg + 0.2 * (peak - bg);
    let at = from;
    for (let i = from; i < to; i++) {
      if (Math.abs(x[i]) > level) {
        at = i;
        break;
      }
    }
    const pos = snapToZero(x, at, Math.round(sampleRate * 0.0015), true);
    if (onsets.length === 0 || pos - onsets[onsets.length - 1] > hop) onsets.push(pos);
  }

  // Если файл начинается сразу с удара (луп обрезан «в ноль»), роста огибающей там нет —
  // добавляем начало файла как первый транзиент. Если в начале тишина, она останется за первым маркером.
  let globalPeak = 0;
  for (let i = 0; i < x.length; i += 7) globalPeak = Math.max(globalPeak, Math.abs(x[i]));
  let headPeak = 0;
  const head = Math.min(x.length, Math.round(sampleRate * 0.005));
  for (let i = 0; i < head; i++) headPeak = Math.max(headPeak, Math.abs(x[i]));
  if (headPeak > globalPeak * 0.1) {
    const minGap = Math.round(minGapSec * sampleRate);
    return [0, ...onsets.filter((o) => o > minGap)];
  }
  return onsets;
}

/** Ближайшее пересечение нуля; при preferBefore ищем сначала слева (чтобы не срезать атаку). */
export function snapToZero(
  x: Float32Array,
  idx: number,
  radius: number,
  preferBefore = false,
): number {
  idx = Math.min(x.length - 1, Math.max(0, Math.round(idx)));
  if (idx === 0) return 0;
  const isZc = (i: number) => i > 0 && i < x.length && (x[i - 1] <= 0) !== (x[i] <= 0);
  if (preferBefore) {
    for (let d = 0; d <= radius; d++) if (isZc(idx - d)) return idx - d;
    return idx;
  }
  for (let d = 0; d <= radius; d++) {
    if (isZc(idx - d)) return idx - d;
    if (isZc(idx + d)) return idx + d;
  }
  return idx;
}

/** Равная сетка: n слайсов → n маркеров начала (первый всегда 0). */
export function gridMarkers(length: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * length) / n));
  return out;
}

/** Подтягивает маркеры сетки к ближайшему транзиенту, если он не дальше maxDist. */
export function snapMarkersToOnsets(markers: number[], onsets: number[], maxDist: number): number[] {
  return markers.map((m) => {
    let best = m;
    let bestD = maxDist + 1;
    for (const o of onsets) {
      const d = Math.abs(o - m);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  });
}

export function markersToSlices(markers: number[], length: number): Slice[] {
  const ms = [...new Set(markers.map((m) => Math.min(length, Math.max(0, Math.round(m)))))].sort(
    (a, b) => a - b,
  );
  const out: Slice[] = [];
  for (let i = 0; i < ms.length; i++) {
    const end = i + 1 < ms.length ? ms[i + 1] : length;
    if (end - ms[i] > 16) out.push({ start: ms[i], end });
  }
  return out;
}

/** Оценка темпа лупа: считаем, что это целое число тактов 4/4, и выбираем вариант ближе к 70–180 BPM. */
export function estimateBpm(durationSec: number): { bpm: number; bars: number } {
  let best = { bpm: 0, bars: 1 };
  let bestScore = Infinity;
  for (const bars of [1, 2, 4, 8, 16]) {
    const bpm = (bars * 4 * 60) / durationSec;
    if (bpm < 60 || bpm > 200) continue;
    const score = Math.abs(Math.log(bpm / 135)); // брейки чаще всего в районе 120–170
    if (score < bestScore) {
      bestScore = score;
      best = { bpm: Math.round(bpm * 10) / 10, bars };
    }
  }
  if (best.bpm === 0) best = { bpm: Math.round(((4 * 60) / durationSec) * 10) / 10, bars: 1 };
  return best;
}
