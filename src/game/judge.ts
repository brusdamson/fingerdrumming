// Оценка попаданий. Чистая логика: на вход — время удара и звук, на выход — вердикт.
// Никаких скрытых поправок: отклонение = время удара − время ноты (калибровочное
// смещение вычитается снаружи, до вызова hit()).

export type Level = 'normal' | 'accent' | 'ghost';
export type Verdict = 'perfect' | 'good' | 'ok' | 'miss';

/** Окна оценки, секунды (± от идеального момента). */
export const WINDOWS = { perfect: 0.02, good: 0.04, ok: 0.07 };
export const POINTS: Record<Verdict, number> = { perfect: 100, good: 70, ok: 40, miss: 0 };
export const EXTRA_PENALTY = 25;

export interface JNote {
  id: number;
  t: number; // секунды от начала сессии
  sound: string;
  level: Level;
  loop: number;
  verdict?: Verdict;
  delta?: number; // секунды; >0 — поздно, <0 — рано
}

export interface HitResult {
  kind: Verdict | 'extra';
  note?: JNote;
  deltaMs?: number;
}

export interface SoundStats {
  total: number;
  hit: number;
  meanMs: number;
}

export interface Stats {
  total: number;
  perfect: number;
  good: number;
  ok: number;
  miss: number;
  extras: number;
  accuracy: number; // 0..100
  meanMs: number; // средний сдвиг (со знаком)
  sdMs: number; // разброс
  deltasMs: number[];
  bySound: Record<string, SoundStats>;
}

export function gradeDelta(absSec: number): Verdict {
  if (absSec <= WINDOWS.perfect) return 'perfect';
  if (absSec <= WINDOWS.good) return 'good';
  return 'ok';
}

export class Judge {
  notes: JNote[] = [];
  extras = 0;
  private head = 0;
  private minGap = new Map<string, number>();
  private lastT = new Map<string, number>();

  /** Ноты добавляются по возрастанию времени (сессия дописывает следующие круги). */
  addNotes(ns: JNote[]): void {
    for (const n of ns) {
      const last = this.lastT.get(n.sound);
      if (last !== undefined) {
        const gap = n.t - last;
        if (gap > 1e-6) this.minGap.set(n.sound, Math.min(this.minGap.get(n.sound) ?? Infinity, gap));
      }
      this.lastT.set(n.sound, n.t);
      this.notes.push(n);
    }
  }

  /**
   * Окно сопоставления удара с нотой: не шире окна OK и не шире половины минимального
   * интервала между нотами этого звука — иначе на быстрых роллах удар «прилипал» бы к соседней ноте.
   */
  matchWindow(sound: string): number {
    const gap = this.minGap.get(sound) ?? Infinity;
    return Math.min(WINDOWS.ok, gap * 0.5);
  }

  hit(sound: string, t: number): HitResult {
    const w = this.matchWindow(sound);
    let best: JNote | undefined;
    let bestAbs = Infinity;
    for (let i = this.head; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > t + WINDOWS.ok) break;
      if (n.verdict || n.sound !== sound) continue;
      const a = Math.abs(t - n.t);
      if (a <= w && a < bestAbs) {
        best = n;
        bestAbs = a;
      }
    }
    if (!best) {
      this.extras++;
      return { kind: 'extra' };
    }
    best.delta = t - best.t;
    best.verdict = gradeDelta(bestAbs);
    return { kind: best.verdict, note: best, deltaMs: best.delta * 1000 };
  }

  /** Помечает промахами ноты, окно которых уже прошло. Возвращает новые промахи. */
  advance(t: number): JNote[] {
    const missed: JNote[] = [];
    for (let i = this.head; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t + this.matchWindow(n.sound) >= t) {
        // Ноты отсортированы по времени, но окна у звуков разные — смотрим ещё чуть дальше.
        if (n.t > t) break;
        continue;
      }
      if (!n.verdict) {
        n.verdict = 'miss';
        missed.push(n);
      }
    }
    while (this.head < this.notes.length && this.notes[this.head].verdict) this.head++;
    return missed;
  }

  stats(filter?: (n: JNote) => boolean, extras = this.extras): Stats {
    return computeStats(filter ? this.notes.filter(filter) : this.notes, extras);
  }
}

export function computeStats(notes: JNote[], extras: number): Stats {
  const st: Stats = {
    total: 0,
    perfect: 0,
    good: 0,
    ok: 0,
    miss: 0,
    extras,
    accuracy: 0,
    meanMs: 0,
    sdMs: 0,
    deltasMs: [],
    bySound: {},
  };
  let points = 0;
  for (const n of notes) {
    if (!n.verdict) continue; // ещё не сыграна и не просрочена
    st.total++;
    st[n.verdict]++;
    points += POINTS[n.verdict];
    const bs = (st.bySound[n.sound] ??= { total: 0, hit: 0, meanMs: 0 });
    bs.total++;
    if (n.verdict !== 'miss' && n.delta !== undefined) {
      const ms = n.delta * 1000;
      st.deltasMs.push(ms);
      bs.hit++;
      bs.meanMs += ms;
    }
  }
  for (const bs of Object.values(st.bySound)) bs.meanMs = bs.hit ? bs.meanMs / bs.hit : 0;
  if (st.total > 0) {
    st.accuracy = Math.max(0, (points - EXTRA_PENALTY * extras) / (100 * st.total)) * 100;
  }
  const d = st.deltasMs;
  if (d.length) {
    st.meanMs = d.reduce((a, b) => a + b, 0) / d.length;
    st.sdMs = Math.sqrt(d.reduce((a, b) => a + (b - st.meanMs) ** 2, 0) / d.length);
  }
  return st;
}

export function stars(accuracy: number): number {
  return accuracy >= 97 ? 3 : accuracy >= 92 ? 2 : accuracy >= 85 ? 1 : 0;
}

export const PASS_ACCURACY = 85;
