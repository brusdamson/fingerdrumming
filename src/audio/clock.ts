// Связь часов performance.now() (в них приходят MIDI-события) и времени AudioContext
// (в нём запланированы метроном и ноты).
//
// «Слышимое время» — это время AudioContext того звука, который сейчас реально выходит
// из динамиков. Нота, запланированная на момент T, слышна, когда слышимое время = T.
// Удар оценивается так: timeStamp MIDI-события → слышимое время → сравнение с T.

/** Скользящая медиана: сглаживает джиттер отдельных замеров и плавно следует за дрейфом часов. */
export class OffsetEstimator {
  private buf: number[] = [];
  private cached: number | null = null;

  constructor(private size = 41) {}

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    this.cached = null;
  }

  get count(): number {
    return this.buf.length;
  }

  get value(): number {
    if (this.cached !== null) return this.cached;
    if (this.buf.length === 0) return 0;
    const s = [...this.buf].sort((a, b) => a - b);
    const m = s.length >> 1;
    this.cached = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return this.cached;
  }

  reset(): void {
    this.buf = [];
    this.cached = null;
  }
}

export type ClockMode = 'output-timestamp' | 'current-time';

export class AudioClock {
  private est = new OffsetEstimator();
  mode: ClockMode | null = null;

  constructor(private ctx: AudioContext) {}

  /** Снять замер соответствия часов. Вызывается часто (каждый тик планировщика). */
  sample(): void {
    if (this.ctx.state !== 'running') return;
    const ts = typeof this.ctx.getOutputTimestamp === 'function' ? this.ctx.getOutputTimestamp() : null;
    const valid = !!ts && (ts.performanceTime ?? 0) > 0 && (ts.contextTime ?? 0) > 0;
    const mode: ClockMode = valid ? 'output-timestamp' : 'current-time';
    if (this.mode !== mode) {
      // Режим фиксируется; смена режима сбрасывает оценку, чтобы не смешивать разные базы.
      if (this.mode === 'output-timestamp' && this.est.count > 5) return;
      this.mode = mode;
      this.est.reset();
    }
    if (valid) {
      this.est.push(ts!.contextTime! - ts!.performanceTime! / 1000);
    } else {
      const lat = (this.ctx.outputLatency || 0) + 0;
      this.est.push(this.ctx.currentTime - lat - performance.now() / 1000);
    }
  }

  get ready(): boolean {
    return this.est.count > 0;
  }

  /** performance-время (мс) → слышимое время AudioContext (с). */
  perfToCtx(perfMs: number): number {
    return perfMs / 1000 + this.est.value;
  }

  /** Слышимое время прямо сейчас. */
  now(): number {
    return this.perfToCtx(performance.now());
  }

  reset(): void {
    this.est.reset();
    this.mode = null;
  }
}
