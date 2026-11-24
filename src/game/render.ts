import { WINDOWS, type JNote } from './judge';
import type { Feedback } from './session';

export interface Lane {
  sound: string;
  label: string;
  pads: number[];
  color: string;
}

export interface View {
  notes: JNote[];
  time: number; // секунды сессии (для отрисовки)
  beatDur: number;
  stepDur: number;
  grid: number; // шагов на такт
  feedback: Feedback[];
  idle: boolean;
}

const VERDICT_COLOR: Record<string, string> = {
  perfect: '#7dffb0',
  good: '#d6e04a',
  ok: '#ffc23c',
  miss: '#ff4d5e',
  extra: '#ff4d5e',
};

export function feedbackText(f: Feedback): string {
  if (f.kind === 'miss') return 'пропуск';
  if (f.kind === 'extra') return 'лишний';
  if (f.deltaMs === undefined) return 'есть';
  const ms = Math.round(f.deltaMs);
  if (f.kind === 'perfect') return ms === 0 ? 'точно' : `точно ${ms > 0 ? '+' : '−'}${Math.abs(ms)}`;
  return ms > 0 ? `поздно +${ms}` : `рано −${Math.abs(ms)}`;
}

export class Renderer {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private first = 0;
  private lastNotes: JNote[] | null = null;

  constructor(private canvas: HTMLCanvasElement, private lanes: Lane[]) {
    this.g = canvas.getContext('2d')!;
    this.resize();
  }

  setLanes(lanes: Lane[]): void {
    this.lanes = lanes;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, r.width);
    this.h = Math.max(160, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(v: View): void {
    const g = this.g;
    const W = this.w;
    const H = this.h;
    const lanes = this.lanes;
    const top = 26;
    const meterH = 62;
    const laneH = Math.min(58, (H - top - meterH - 8) / Math.max(1, lanes.length));
    const lanesH = laneH * lanes.length;
    const labelW = 118;
    const hitX = Math.max(labelW + 90, W * 0.24);
    const beatsVisible = v.grid >= 32 ? 4 : 6;
    const pxPerSec = (W - hitX) / (beatsVisible * v.beatDur);
    const x = (t: number) => hitX + (t - v.time) * pxPerSec;
    const now = performance.now();

    g.clearRect(0, 0, W, H);

    // Дорожки
    lanes.forEach((_, i) => {
      g.fillStyle = i % 2 ? '#15171d' : '#191c23';
      g.fillRect(0, top + i * laneH, W, laneH);
    });

    // Сетка
    const tMin = v.time - (hitX - labelW) / pxPerSec;
    const tMax = v.time + (W - hitX) / pxPerSec;
    const stepsPerBeat = v.grid / 4;
    const s0 = Math.floor(tMin / v.stepDur);
    const s1 = Math.ceil(tMax / v.stepDur);
    g.textBaseline = 'middle';
    g.font = '600 11px ui-monospace, Consolas, monospace';
    for (let s = s0; s <= s1; s++) {
      const px = x(s * v.stepDur);
      if (px < labelW) continue;
      const isBeat = ((s % stepsPerBeat) + stepsPerBeat) % stepsPerBeat === 0;
      const isBar = ((s % v.grid) + v.grid) % v.grid === 0;
      if (!isBeat && (v.grid > 16 ? s % 2 !== 0 : false)) continue;
      g.fillStyle = isBar ? 'rgba(255,255,255,0.34)' : isBeat ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.045)';
      g.fillRect(Math.round(px), top, isBar ? 2 : 1, lanesH);
      if (isBeat) {
        const beat = Math.floor(s / stepsPerBeat);
        const inBar = ((beat % 4) + 4) % 4;
        g.fillStyle = s < 0 ? '#ffc23c' : isBar ? '#e9edf5' : '#7c8494';
        g.textAlign = 'left';
        g.fillText(String(inBar + 1), px + 4, top / 2 + 1);
      }
    }

    // Ноты
    if (v.notes !== this.lastNotes) {
      this.lastNotes = v.notes;
      this.first = 0;
    }
    while (this.first < v.notes.length && v.notes[this.first].t < tMin - 0.5) this.first++;
    const laneIdx = new Map(lanes.map((l, i) => [l.sound, i]));
    for (let i = this.first; i < v.notes.length; i++) {
      const n = v.notes[i];
      if (n.t > tMax + 0.2) break;
      const li = laneIdx.get(n.sound);
      if (li === undefined) continue;
      const px = x(n.t);
      if (px < labelW + 4) continue;
      const cy = top + li * laneH + laneH / 2;
      const ghost = n.level === 'ghost';
      const accent = n.level === 'accent';
      const nw = ghost ? 8 : accent ? 16 : 13;
      const nh = laneH * (ghost ? 0.34 : accent ? 0.74 : 0.6);
      let color = lanes[li].color;
      let alpha = 1;
      if (n.verdict) {
        color = VERDICT_COLOR[n.verdict];
        alpha = n.verdict === 'miss' ? 0.75 : 0.5;
      }
      g.globalAlpha = alpha;
      if (n.verdict === 'miss') {
        g.strokeStyle = color;
        g.lineWidth = 2;
        roundRect(g, px - nw / 2, cy - nh / 2, nw, nh, 3);
        g.stroke();
      } else {
        g.fillStyle = color;
        roundRect(g, px - nw / 2, cy - nh / 2, nw, nh, 3);
        g.fill();
        if (accent && !n.verdict) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    // Подписи дорожек
    g.fillStyle = '#0f1115';
    g.fillRect(0, top, labelW, lanesH);
    lanes.forEach((l, i) => {
      const cy = top + i * laneH + laneH / 2;
      g.fillStyle = l.color;
      g.fillRect(0, top + i * laneH + 4, 4, laneH - 8);
      g.textAlign = 'left';
      g.fillStyle = '#e9edf5';
      g.font = '600 13px system-ui, sans-serif';
      g.fillText(l.label, 12, cy - 7);
      g.fillStyle = '#7c8494';
      g.font = '11px ui-monospace, Consolas, monospace';
      g.fillText(l.pads.length ? 'пэд ' + l.pads.join(' / ') : 'нет в ките', 12, cy + 9);
    });

    // Линия удара
    g.fillStyle = '#ffffff';
    g.fillRect(Math.round(hitX) - 1, top - 4, 2, lanesH + 8);

    // Вспышки и подписи вердиктов
    g.textAlign = 'right';
    for (const f of v.feedback) {
      const age = now - f.at;
      if (age > 700 || age < 0) continue;
      const li = laneIdx.get(f.sound);
      if (li === undefined) continue;
      const cy = top + li * laneH + laneH / 2;
      const k = 1 - age / 700;
      const color = VERDICT_COLOR[f.kind];
      g.globalAlpha = Math.min(1, k * 1.6);
      if (age < 160) {
        g.fillStyle = color;
        g.globalAlpha = 0.35 * (1 - age / 160);
        g.fillRect(hitX - 5, top + li * laneH, 10, laneH);
        g.globalAlpha = Math.min(1, k * 1.6);
      }
      g.fillStyle = color;
      g.font = '700 12px ui-monospace, Consolas, monospace';
      g.fillText(feedbackText(f), hitX - 10, cy - (1 - k) * 10);
    }
    g.globalAlpha = 1;

    // Отсчёт
    if (!v.idle && v.time < 0) {
      const beat = Math.ceil(-v.time / v.beatDur);
      if (beat >= 1 && beat <= 4) {
        g.textAlign = 'center';
        g.font = '800 64px system-ui, sans-serif';
        g.fillStyle = 'rgba(255,194,60,0.9)';
        g.fillText(String(5 - beat), hitX + (W - hitX) / 2, top + lanesH / 2);
      }
    }

    this.drawMeter(v, 0, top + lanesH + 10, W, H - top - lanesH - 12, now);
  }

  /** Шкала «рано — поздно»: последние удары в миллисекундах относительно идеала. */
  private drawMeter(v: View, x0: number, y0: number, W: number, H: number, now: number): void {
    const g = this.g;
    const range = WINDOWS.ok * 1000 + 10;
    const pad = 64;
    const cx = x0 + W / 2;
    const half = Math.min(360, W / 2 - pad);
    const barY = y0 + 22;
    const barH = Math.max(10, Math.min(18, H - 34));
    const mx = (ms: number) => cx + (Math.max(-range, Math.min(range, ms)) / range) * half;

    const zone = (ms: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(mx(-ms), barY, mx(ms) - mx(-ms), barH);
    };
    zone(range, '#20232b');
    zone(WINDOWS.ok * 1000, 'rgba(255,194,60,0.16)');
    zone(WINDOWS.good * 1000, 'rgba(214,224,74,0.2)');
    zone(WINDOWS.perfect * 1000, 'rgba(125,255,176,0.3)');
    g.fillStyle = '#ffffff';
    g.fillRect(Math.round(cx) - 1, barY - 4, 2, barH + 8);

    g.font = '600 11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#7c8494';
    g.textAlign = 'right';
    g.fillText('РАНО', cx - half - 10, barY + barH / 2);
    g.textAlign = 'left';
    g.fillText('ПОЗДНО', cx + half + 10, barY + barH / 2);
    g.textAlign = 'center';
    g.font = '10px ui-monospace, Consolas, monospace';
    for (const ms of [-70, -40, -20, 0, 20, 40, 70]) {
      g.fillText(ms === 0 ? '0 мс' : String(ms), mx(ms), barY - 12);
    }

    let sum = 0;
    let cnt = 0;
    const hits = v.feedback.filter((f) => f.deltaMs !== undefined);
    const recent = hits.slice(-16);
    recent.forEach((f, i) => {
      const age = now - f.at;
      const a = Math.max(0.15, 1 - age / 4000) * (0.4 + (0.6 * (i + 1)) / recent.length);
      g.globalAlpha = a;
      g.fillStyle = VERDICT_COLOR[f.kind];
      g.fillRect(Math.round(mx(f.deltaMs!)) - 1.5, barY - 2, 3, barH + 4);
      sum += f.deltaMs!;
      cnt++;
    });
    g.globalAlpha = 1;
    if (cnt >= 3) {
      const mean = sum / cnt;
      const px = mx(mean);
      g.fillStyle = '#e9edf5';
      g.beginPath();
      g.moveTo(px, barY + barH + 3);
      g.lineTo(px - 5, barY + barH + 11);
      g.lineTo(px + 5, barY + barH + 11);
      g.closePath();
      g.fill();
    }
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
