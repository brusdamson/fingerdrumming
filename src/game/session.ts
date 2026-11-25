import type { AudioEngine } from '../audio/engine';
import type { AudioClock } from '../audio/clock';
import { Judge, POINTS, type JNote, type Stats, type Verdict } from './judge';
import { levelVelocity, parseLesson, stepDuration, type Lesson, type PNote } from './pattern';

export type Mode = 'practice' | 'exam' | 'demo' | 'wait';

export interface Feedback {
  sound: string;
  kind: Verdict | 'extra';
  deltaMs?: number;
  at: number; // performance.now() в момент события
}

export interface SessionOpts {
  engine: AudioEngine;
  clock: AudioClock;
  lesson: Lesson;
  bpm: number;
  mode: Mode;
  metronome: boolean;
  audioOffsetMs: number;
  visualOffsetMs: number;
  onFeedback?: (f: Feedback) => void;
  onLoop?: (loop: number, stats: Stats) => void;
  onFinish?: (stats: Stats | null) => void;
}

const LOOKAHEAD = 0.12; // с — насколько вперёд планируем звук
const TICK_MS = 25;
const MISS_GRACE = 0.1; // с

export class Session {
  readonly judge = new Judge();
  readonly stepDur: number;
  readonly beatDur: number;
  readonly loopDur: number;
  readonly countIn: number;
  readonly sounds: Set<string>;
  readonly feedback: Feedback[] = [];
  score = 0;
  combo = 0;
  maxCombo = 0;
  running = false;
  finished = false;

  private pattern: PNote[];
  private steps: number;
  private t0 = 0; // время AudioContext, соответствующее моменту 0 сессии (первая доля паттерна)
  private timer: number | undefined;
  private loopsGenerated = 0;
  private totalLoops: number;
  private nextBeat: number;
  private demoIdx = 0;
  private lastLoopReported = -1;
  private nextId = 1;
  // режим «без темпа»
  private paused = 0;
  private frozenAt: number | null = null;
  private waitHead = 0;

  constructor(private o: SessionOpts) {
    const parsed = parseLesson(o.lesson);
    this.pattern = parsed.notes;
    this.steps = parsed.steps;
    this.stepDur = stepDuration(o.bpm, o.lesson.grid);
    this.beatDur = 60 / o.bpm;
    this.loopDur = this.steps * this.stepDur;
    this.sounds = new Set(Object.keys(o.lesson.tracks));
    this.countIn = o.mode === 'wait' ? 0 : 4 * this.beatDur;
    this.totalLoops =
      o.mode === 'exam' ? o.lesson.repeats : o.mode === 'demo' ? (o.lesson.bars >= 4 ? 1 : 2) : Infinity;
    this.nextBeat = -4;
  }

  get mode(): Mode {
    return this.o.mode;
  }

  get bpm(): number {
    return this.o.bpm;
  }

  /** Время AudioContext первой доли паттерна (после отсчёта). */
  get startTime(): number {
    return this.t0;
  }

  get totalDuration(): number {
    return this.totalLoops * this.loopDur;
  }

  start(): void {
    const { engine, clock } = this.o;
    clock.sample();
    this.t0 = engine.ctx.currentTime + 0.2 + this.countIn;
    if (this.o.mode === 'wait') this.t0 = clock.now() + 0.6;
    this.running = true;
    this.generate(0);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Слышимое время сессии без поправок (для режима «без темпа» — с учётом пауз). */
  private rawTime(perfMs: number): number {
    return this.o.clock.perfToCtx(perfMs) - this.t0;
  }

  /** Время для оценки: из слышимого времени вычитается калибровочный сдвиг ударов. */
  judgeTime(perfMs: number): number {
    return this.rawTime(perfMs) - this.o.audioOffsetMs / 1000;
  }

  /** Время для отрисовки. */
  visualTime(): number {
    if (this.o.mode === 'wait') {
      if (this.frozenAt !== null) return this.frozenAt;
      return this.rawTime(performance.now()) - this.paused;
    }
    return this.rawTime(performance.now()) + this.o.visualOffsetMs / 1000;
  }

  private generate(untilTime: number): void {
    while (
      this.loopsGenerated < this.totalLoops &&
      this.loopsGenerated * this.loopDur < untilTime + this.loopDur + 4
    ) {
      const k = this.loopsGenerated++;
      const base = k * this.loopDur;
      const ns: JNote[] = this.pattern.map((p) => ({
        id: this.nextId++,
        t: base + p.step * this.stepDur,
        sound: p.sound,
        level: p.level,
        loop: k,
      }));
      this.judge.addNotes(ns);
    }
  }

  private tick(): void {
    if (!this.running) return;
    const { engine, clock } = this.o;
    clock.sample();
    const mode = this.o.mode;
    if (mode === 'wait') {
      this.generate(this.visualTime());
      return;
    }
    const nowS = engine.ctx.currentTime - this.t0;
    this.generate(nowS);
    const horizon = nowS + LOOKAHEAD;
    const endTime = this.totalDuration;

    // Метроном: отсчёт звучит всегда, дальше — если включён (в демо тоже, для ориентира).
    while (this.nextBeat * this.beatDur < horizon) {
      const bt = this.nextBeat * this.beatDur;
      if (bt >= endTime) break;
      const isCountIn = this.nextBeat < 0;
      if ((isCountIn || this.o.metronome) && bt >= nowS - 0.01) {
        engine.click(this.t0 + bt, ((this.nextBeat % 4) + 4) % 4 === 0);
      }
      this.nextBeat++;
    }

    if (mode === 'demo') {
      const notes = this.judge.notes;
      while (this.demoIdx < notes.length && notes[this.demoIdx].t < horizon) {
        const n = notes[this.demoIdx++];
        if (n.t >= nowS - 0.01) engine.playSound(n.sound, levelVelocity(n.level), this.t0 + n.t);
        n.verdict = 'perfect';
      }
    }
  }

  /** Вызывается каждый кадр: промахи, границы кругов, завершение. */
  update(): void {
    if (!this.running) return;
    const mode = this.o.mode;
    const perf = performance.now();

    if (mode === 'wait') {
      const notes = this.judge.notes;
      while (this.waitHead < notes.length && notes[this.waitHead].verdict) this.waitHead++;
      const next = notes[this.waitHead];
      if (this.frozenAt === null && next && next.t <= this.visualTime()) this.frozenAt = next.t;
      return;
    }

    const t = mode === 'demo' ? this.rawTime(perf) : this.judgeTime(perf);
    if (mode !== 'demo') {
      // Удар несёт собственную метку времени, поэтому пропуск фиксируем с запасом:
      // если главный поток подвис и событие доставлено с опозданием, оно всё равно зачтётся.
      for (const n of this.judge.advance(t - MISS_GRACE)) {
        this.combo = 0;
        this.pushFeedback({ sound: n.sound, kind: 'miss', at: perf });
      }
      const loop = Math.floor((t - 0.15) / this.loopDur);
      if (loop - 1 > this.lastLoopReported && loop >= 1) {
        this.lastLoopReported = loop - 1;
        const k = loop - 1;
        this.o.onLoop?.(k, this.judge.stats((n) => n.loop === k, 0));
      }
    }
    if (Number.isFinite(this.totalDuration) && t > this.totalDuration + 0.35) {
      this.finished = true;
      this.stop();
      this.o.onFinish?.(mode === 'demo' ? null : this.judge.stats());
    }
  }

  /** Удар по пэду со звуком sound. perfMs — timeStamp события ввода. */
  onHit(sound: string, perfMs: number): void {
    if (!this.running || this.o.mode === 'demo') return;
    if (this.o.mode === 'wait') {
      this.waitHit(sound, perfMs);
      return;
    }
    const t = this.judgeTime(perfMs);
    if (t < -0.3) return; // удары во время отсчёта не считаем
    if (!this.sounds.has(sound)) {
      this.judge.extras++;
      this.combo = 0;
      this.pushFeedback({ sound, kind: 'extra', at: perfMs });
      return;
    }
    const r = this.judge.hit(sound, t);
    if (r.kind === 'extra') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += POINTS[r.kind as Verdict];
    }
    this.pushFeedback({ sound, kind: r.kind, deltaMs: r.deltaMs, at: perfMs });
  }

  private waitHit(sound: string, perfMs: number): void {
    const notes = this.judge.notes;
    while (this.waitHead < notes.length && notes[this.waitHead].verdict) this.waitHead++;
    const next = notes[this.waitHead];
    if (!next) return;
    const now = this.visualTime();
    if (this.frozenAt === null && next.t - now > 0.3) return; // слишком рано — ждём, пока нота подъедет
    const target = next.t;
    let matched = false;
    let remaining = 0;
    for (let i = this.waitHead; i < notes.length && notes[i].t - target < 1e-4; i++) {
      const n = notes[i];
      if (n.verdict) continue;
      if (!matched && n.sound === sound) {
        n.verdict = 'good';
        matched = true;
      } else {
        remaining++;
      }
    }
    this.pushFeedback({ sound, kind: matched ? 'good' : 'extra', at: perfMs });
    if (matched && remaining === 0 && this.frozenAt !== null) {
      this.paused = this.rawTime(performance.now()) - this.frozenAt;
      this.frozenAt = null;
    }
  }

  private pushFeedback(f: Feedback): void {
    this.feedback.push(f);
    if (this.feedback.length > 64) this.feedback.splice(0, this.feedback.length - 64);
    this.o.onFeedback?.(f);
  }
}
