// Подыгрыш: бас и пэд, под которые можно играть брейк.
// Барабаны в приложении — только сэмплы; здесь синтезируется музыкальное сопровождение
// (саб-бас, reese, аккорды), чтобы оно шло в любом темпе без растягивания аудио.
// Всё планируется по часам AudioContext от той же точки t0, что и урок/метроном.

/** Нота баса: [шаг (16-е от начала цикла), длина в шагах, MIDI-нота, MIDI-нота для слайда]. */
export type BassNote = [step: number, len: number, midi: number, slideTo?: number];

export interface Chord {
  bar: number;
  bars: number;
  notes: number[]; // MIDI
}

export interface BackingStyle {
  id: string;
  name: string;
  bars: number;
  bass: BassNote[];
  bassType: 'sub' | 'reese' | 'dist' | 'neuro';
  /** Период качания фильтра в шагах (16-х) — для wobble-баса. */
  wobble?: number;
  chords: Chord[];
}

export const BACKINGS: BackingStyle[] = [
  {
    id: 'liquid',
    name: 'Liquid: аккорды + саб',
    bars: 4,
    bassType: 'sub',
    bass: [
      [0, 6, 29], [10, 2, 29], [12, 3, 29],
      [16, 6, 37], [26, 4, 37],
      [32, 6, 32], [42, 2, 32], [44, 3, 32],
      [48, 6, 39], [56, 3, 39], [60, 4, 39],
    ],
    chords: [
      { bar: 0, bars: 1, notes: [53, 56, 60, 63, 67] }, // Fm9
      { bar: 1, bars: 1, notes: [49, 53, 56, 60] }, // Dbmaj7
      { bar: 2, bars: 1, notes: [56, 60, 63, 67] }, // Abmaj7
      { bar: 3, bars: 1, notes: [51, 55, 58, 65] }, // Eb add9
    ],
  },
  {
    id: 'jungle',
    name: 'Jungle: саб со слайдами + тёмный пэд',
    bars: 4,
    bassType: 'sub',
    bass: [
      [0, 7, 29], [10, 5, 29, 32],
      [16, 4, 32], [22, 8, 29],
      [32, 7, 29], [42, 3, 36], [45, 3, 34],
      [48, 6, 32], [56, 8, 31, 29],
    ],
    chords: [
      { bar: 0, bars: 2, notes: [53, 60, 63] }, // Fm7 без терции сверху
      { bar: 2, bars: 2, notes: [51, 58, 63] }, // Eb
    ],
  },
  {
    id: 'reese',
    name: 'Techstep: reese-бас',
    bars: 4,
    bassType: 'reese',
    bass: [
      [0, 14, 29],
      [16, 8, 29], [24, 4, 32], [28, 4, 31],
      [32, 14, 29],
      [48, 8, 36], [56, 8, 37],
    ],
    chords: [],
  },
  {
    id: 'techstep2',
    name: 'Techstep 2: стаккато reese',
    bars: 4,
    bassType: 'reese',
    bass: [
      [0, 2, 29], [3, 2, 29], [6, 2, 29], [8, 4, 29], [14, 2, 32],
      [16, 2, 29], [19, 2, 29], [22, 2, 29], [24, 4, 31], [28, 4, 30],
      [32, 2, 29], [35, 2, 29], [38, 2, 29], [40, 4, 29], [46, 2, 32],
      [48, 2, 29], [51, 2, 29], [54, 2, 29], [56, 8, 36, 29],
    ],
    chords: [],
  },
  {
    id: 'darkstep',
    name: 'Darkstep: перегруженный reese + тревожный пэд',
    bars: 4,
    bassType: 'dist',
    bass: [
      [0, 10, 29], [10, 6, 30],
      [16, 6, 29], [22, 2, 29], [24, 8, 36, 35],
      [32, 10, 29], [42, 6, 30],
      [48, 4, 32], [52, 4, 30], [56, 8, 29, 28],
    ],
    chords: [
      { bar: 0, bars: 2, notes: [53, 60, 66] }, // F – C – Gb
      { bar: 2, bars: 2, notes: [53, 59, 66] }, // F – B – Gb
    ],
  },
  {
    id: 'neuro',
    name: 'Neurofunk: рычащий wobble-бас',
    bars: 4,
    bassType: 'neuro',
    wobble: 2,
    bass: [
      [0, 3, 29], [3, 1, 29], [6, 2, 29], [10, 2, 32], [12, 3, 30],
      [16, 3, 29], [19, 1, 29], [22, 2, 29], [24, 2, 36], [26, 2, 35], [28, 4, 30],
      [32, 3, 29], [35, 1, 29], [38, 2, 29], [42, 2, 32], [44, 3, 30],
      [48, 2, 29], [50, 2, 29], [52, 2, 32], [54, 2, 30], [56, 8, 36, 29],
    ],
    chords: [],
  },
  {
    id: 'jumpup',
    name: 'Jump-up: прыгающий бас через октаву',
    bars: 4,
    bassType: 'neuro',
    wobble: 1,
    bass: [
      [0, 2, 29], [2, 2, 41], [6, 2, 29], [8, 2, 41], [12, 2, 32], [14, 2, 44],
      [16, 2, 29], [18, 2, 41], [22, 2, 29], [24, 4, 41, 29], [28, 4, 30],
      [32, 2, 29], [34, 2, 41], [38, 2, 29], [40, 2, 41], [44, 2, 32], [46, 2, 44],
      [48, 2, 29], [50, 2, 41], [52, 2, 29], [54, 2, 41], [56, 4, 36], [60, 4, 34],
    ],
    chords: [],
  },
];

/** Характер «рычащего» баса: перегруз, движение фильтра, расстройка пил. */
interface Growl {
  drive: number; // 0 — без перегруза
  detune: number; // центы
  q: number;
  lp: [from: number, peak: number, to: number]; // Гц; при wobble — [низ, верх, —]
  level: number;
}
const GROWL: Record<'reese' | 'dist' | 'neuro', Growl> = {
  reese: { drive: 0, detune: 19, q: 3, lp: [260, 720, 380], level: 0.5 },
  dist: { drive: 5, detune: 26, q: 4, lp: [320, 1500, 520], level: 0.25 },
  neuro: { drive: 9, detune: 14, q: 8, lp: [140, 1250, 140], level: 0.21 },
};

function driveCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1));
  return c;
}

export function backingById(id: string): BackingStyle | undefined {
  return BACKINGS.find((b) => b.id === id);
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD = 0.15;
const TICK_MS = 25;

type Ev = { step: number; run: (t: number, stepDur: number) => void };

export class Backing {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private timer: number | undefined;
  private vol = 0.6;
  private events: Ev[] = [];
  private loopSteps = 64;
  private stepDur = 0.086;
  private t0 = 0;
  private until = Infinity;
  private loop = 0;
  private idx = 0;

  get playing(): boolean {
    return this.timer !== undefined;
  }

  setVolume(v: number): void {
    this.vol = v;
    if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /**
   * Запустить подыгрыш. t0 — время AudioContext первой доли (может быть в прошлом:
   * тогда подыгрыш вступает с ближайшей ноты, оставаясь в общей сетке).
   * until — время AudioContext, после которого новые ноты не начинаются.
   */
  start(ctx: AudioContext, style: BackingStyle, bpm: number, t0: number, until = Infinity): void {
    this.stop();
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.vol;
    this.bus.connect(ctx.destination);
    this.stepDur = 60 / bpm / 4;
    this.loopSteps = style.bars * 16;
    this.t0 = t0;
    this.until = until;

    const evs: Ev[] = [];
    for (const [step, len, midi, slide] of style.bass) {
      evs.push({
        step,
        run: (t, sd) =>
          style.bassType === 'sub'
            ? this.sub(t, len * sd, midi, slide)
            : this.growl(t, len * sd, midi, slide, GROWL[style.bassType], style.wobble ? style.wobble * sd : 0),
      });
    }
    for (const c of style.chords) {
      evs.push({ step: c.bar * 16, run: (t, sd) => this.pad(t, c.bars * 16 * sd, c.notes) });
    }
    this.events = evs.sort((a, b) => a.step - b.step);

    const loopDur = this.loopSteps * this.stepDur;
    this.loop = Math.max(0, Math.floor((ctx.currentTime - t0) / loopDur));
    this.idx = 0;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    const bus = this.bus;
    const ctx = this.ctx;
    this.bus = null;
    if (bus && ctx) {
      // Короткий спад вместо обрыва, чтобы не щёлкало; уже запланированные ноты гаснут вместе с шиной.
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(0, t, 0.03);
      window.setTimeout(() => bus.disconnect(), 400);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.events.length) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    for (;;) {
      const ev = this.events[this.idx];
      const t = this.t0 + (this.loop * this.loopSteps + ev.step) * this.stepDur;
      if (t >= horizon) break;
      if (t >= this.until) {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        return;
      }
      if (t >= now - 0.005) ev.run(Math.max(t, now), this.stepDur);
      if (++this.idx >= this.events.length) {
        this.idx = 0;
        this.loop++;
      }
    }
  }

  /** Огибающая «гейт»: быстрая атака, спад в конце ноты. Возвращает время, когда всё можно остановить. */
  private gate(g: GainNode, t: number, dur: number, peak: number, attack: number, release: number): number {
    const end = t + Math.max(0.03, dur - 0.01);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, end, release / 3);
    return end + release * 2;
  }

  private sub(t: number, dur: number, midi: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const stopAt = this.gate(g, t, dur, 0.55, 0.006, 0.06);
    const f = mtof(midi);
    // Синус — сам саб; тихая октава сверху, чтобы бас читался и в небольших наушниках.
    const parts: [OscillatorType, number, number][] = [['sine', 1, 1], ['triangle', 2, 0.22]];
    for (const [type, mul, level] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * mul, t);
      if (slideTo !== undefined) {
        o.frequency.setValueAtTime(f * mul, t + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(mtof(slideTo) * mul, t + dur * 0.9);
      }
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(stopAt);
    }
    g.connect(this.bus!);
    window.setTimeout(() => g.disconnect(), (stopAt - ctx.currentTime) * 1000 + 100);
  }

  /** Reese и его злые родственники: расстроенные пилы → перегруз → резонансный фильтр, плюс чистый саб. */
  private growl(t: number, dur: number, midi: number, slideTo: number | undefined, p: Growl, wobbleSec: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const stopAt = this.gate(g, t, dur, 1, 0.012, 0.09);
    const f = mtof(midi);
    const pitch = (o: OscillatorNode, mul: number) => {
      o.frequency.setValueAtTime(f * mul, t);
      if (slideTo !== undefined) {
        o.frequency.setValueAtTime(f * mul, t + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(mtof(slideTo) * mul, t + dur * 0.9);
      }
    };
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = p.q;
    const [from, peak, to] = p.lp;
    if (wobbleSec > 0) {
      // Фильтр качается в ритм сетки: каждая нота начинает с закрытого фильтра.
      const mid = (from + peak) / 2;
      lp.frequency.value = mid;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1 / wobbleSec;
      const depth = ctx.createGain();
      depth.gain.value = -(peak - from) / 2;
      lfo.connect(depth);
      depth.connect(lp.frequency);
      // Старт на четверть периода раньше ноты: к её началу фильтр в нижней точке.
      lfo.start(Math.max(0, t - wobbleSec / 4));
      lfo.stop(stopAt);
    } else {
      lp.frequency.setValueAtTime(from, t);
      lp.frequency.linearRampToValueAtTime(peak, t + dur * 0.7);
      lp.frequency.linearRampToValueAtTime(to, t + dur);
    }
    let pre: AudioNode = lp;
    if (p.drive > 0) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(p.drive);
      ws.oversample = '2x';
      ws.connect(lp);
      pre = ws;
    }
    // Расстроенные пилы октавой выше дают характерное «рычание» с биениями.
    for (const cents of [-p.detune, p.detune]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      pitch(o, 2);
      o.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og);
      og.connect(pre);
      o.start(t);
      o.stop(stopAt);
    }
    const top = ctx.createGain();
    top.gain.value = p.level;
    lp.connect(top);
    top.connect(g);
    const s = ctx.createOscillator();
    s.type = 'sine';
    pitch(s, 1);
    const sg = ctx.createGain();
    sg.gain.value = 0.5;
    s.connect(sg);
    sg.connect(g);
    s.start(t);
    s.stop(stopAt);
    g.connect(this.bus!);
    window.setTimeout(() => g.disconnect(), (stopAt - ctx.currentTime) * 1000 + 100);
  }

  private pad(t: number, dur: number, notes: number[]): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const attack = Math.min(0.3, dur * 0.25);
    const stopAt = this.gate(g, t, dur + 0.15, 0.3, attack, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1700, t + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(900, t + dur);
    const level = 0.55 / (notes.length * 2);
    for (const n of notes) {
      for (const cents of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = cents;
        const og = ctx.createGain();
        og.gain.value = level;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(stopAt);
      }
    }
    lp.connect(g);
    g.connect(this.bus!);
    window.setTimeout(() => g.disconnect(), (stopAt - ctx.currentTime) * 1000 + 100);
  }
}
