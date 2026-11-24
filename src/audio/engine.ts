// Аудиодвижок. Главное требование — минимальная задержка «удар → звук»:
// сэмплы заранее декодированы, trigger() синхронно создаёт источник и стартует его «сейчас».
// На пути сигнала нет компрессоров и прочих узлов с lookahead.

export interface PadLayer {
  upTo: number; // максимальная velocity слоя
  buffers: AudioBuffer[]; // round-robin варианты
}

export interface PadDef {
  pad: number; // 1..16, пэд 1 — левый нижний
  sound: string;
  name: string;
  color: string;
  choke?: string;
  gain: number;
  layers: PadLayer[];
}

export interface LoadedKit {
  id: string;
  name: string;
  kind: 'oneshot' | 'slices';
  pads: (PadDef | null)[]; // индекс = pad − 1
  builtin: boolean;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioEngine {
  ctx!: AudioContext;
  master!: GainNode;
  private clickBus!: GainNode;
  kit: LoadedKit | null = null;
  private rr = new Map<number, number>();
  private choke = new Map<string, Voice[]>();

  get ready(): boolean {
    return !!this.ctx;
  }

  init(masterVol: number, clickVol: number): void {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = masterVol;
    this.master.connect(this.ctx.destination);
    this.clickBus = this.ctx.createGain();
    this.clickBus.gain.value = clickVol;
    this.clickBus.connect(this.ctx.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setMasterVolume(v: number): void {
    if (this.ctx) this.master.gain.value = v;
  }

  setClickVolume(v: number): void {
    if (this.ctx) this.clickBus.gain.value = v;
  }

  async setSink(sinkId: string): Promise<void> {
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (c.setSinkId) await c.setSinkId(sinkId);
  }

  latencyInfo(): { baseMs: number; outputMs: number; sampleRate: number } {
    return {
      baseMs: (this.ctx.baseLatency || 0) * 1000,
      outputMs: (this.ctx.outputLatency || 0) * 1000,
      sampleRate: this.ctx.sampleRate,
    };
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  setKit(kit: LoadedKit): void {
    this.kit = kit;
    this.rr.clear();
  }

  padsForSound(sound: string): PadDef[] {
    return (this.kit?.pads.filter((p) => p && p.sound === sound) as PadDef[]) ?? [];
  }

  /** Удар по пэду. when = 0 → немедленно. */
  trigger(pad: number, velocity: number, when = 0): void {
    const p = this.kit?.pads[pad - 1];
    if (p) this.play(p, velocity, when);
  }

  /** Сыграть звук по имени (демо-воспроизведение урока). */
  playSound(sound: string, velocity: number, when = 0): void {
    const p = this.kit?.pads.find((x) => x && x.sound === sound);
    if (p) this.play(p, velocity, when);
  }

  private play(p: PadDef, velocity: number, when: number): void {
    const ctx = this.ctx;
    const layer = p.layers.find((l) => velocity <= l.upTo) ?? p.layers[p.layers.length - 1];
    if (!layer || layer.buffers.length === 0) return;
    const idx = this.rr.get(p.pad) ?? 0;
    this.rr.set(p.pad, idx + 1);
    const buffer = layer.buffers[idx % layer.buffers.length];

    const t = when > 0 ? when : ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    const v = Math.min(127, Math.max(1, velocity)) / 127;
    g.gain.value = p.gain * (0.22 + 0.78 * Math.pow(v, 1.6));
    src.connect(g);
    g.connect(this.master);

    if (p.choke) {
      const list = this.choke.get(p.choke) ?? [];
      for (const old of list) {
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setTargetAtTime(0, t, 0.003);
        try {
          old.src.stop(t + 0.03);
        } catch {
          /* уже остановлен */
        }
      }
      const voice: Voice = { src, gain: g };
      this.choke.set(p.choke, [voice]);
      src.onended = () => {
        const cur = this.choke.get(p.choke!);
        if (cur) {
          const i = cur.indexOf(voice);
          if (i >= 0) cur.splice(i, 1);
        }
        g.disconnect();
      };
    } else {
      src.onended = () => g.disconnect();
    }
    src.start(when > 0 ? when : 0);
  }

  /** Щелчок метронома (служебный сигнал, не драм-звук). */
  click(when: number, accent: boolean): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    osc.connect(g);
    g.connect(this.clickBus);
    osc.start(when);
    osc.stop(when + 0.05);
    osc.onended = () => g.disconnect();
  }

  stopAll(): void {
    // Быстро глушим всё запланированное (при остановке урока/демо).
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    const v = this.master.gain.value;
    this.master.disconnect();
    const m = this.ctx.createGain();
    m.gain.value = v;
    m.connect(this.ctx.destination);
    this.master = m;
    this.choke.clear();
  }
}
