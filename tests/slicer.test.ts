import { describe, expect, it } from 'vitest';
import {
  detectOnsets,
  estimateBpm,
  gridMarkers,
  markersToSlices,
  snapMarkersToOnsets,
  snapToZero,
} from '../src/audio/slicer';

const SR = 48000;

/** Синтетический «брейк»: затухающие шумовые удары в заданных точках. */
function bursts(times: number[], dur: number, amps?: number[]): Float32Array {
  const x = new Float32Array(Math.round(dur * SR));
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  times.forEach((t, k) => {
    const s = Math.round(t * SR);
    const amp = amps?.[k] ?? 0.8;
    for (let i = 0; i < SR * 0.12 && s + i < x.length; i++) {
      x[s + i] += amp * rnd() * 2 * Math.exp(-i / (SR * 0.025));
    }
  });
  return x;
}

describe('slicer', () => {
  it('находит удары с точностью до нескольких миллисекунд', () => {
    const times = [0.1, 0.35, 0.6, 0.85, 1.1, 1.35];
    const onsets = detectOnsets(bursts(times, 1.6), SR, 0.6);
    expect(onsets.length).toBe(times.length);
    onsets.forEach((o, i) => expect(Math.abs(o / SR - times[i])).toBeLessThan(0.008));
  });

  it('чувствительность управляет тихими ударами', () => {
    const x = bursts([0.1, 0.4, 0.7, 1.0], 1.3, [0.9, 0.06, 0.9, 0.06]);
    expect(detectOnsets(x, SR, 0.05).length).toBe(2);
    expect(detectOnsets(x, SR, 1).length).toBe(4);
  });

  it('тишина не даёт слайсов', () => {
    expect(detectOnsets(new Float32Array(SR), SR, 1)).toEqual([]);
  });

  it('сетка и привязка к транзиентам', () => {
    expect(gridMarkers(1600, 4)).toEqual([0, 400, 800, 1200]);
    expect(snapMarkersToOnsets([0, 400, 800], [390, 900], 20)).toEqual([0, 390, 800]);
  });

  it('маркеры превращаются в непрерывные слайсы без дыр', () => {
    const s = markersToSlices([800, 0, 400, 400], 1000);
    expect(s).toEqual([
      { start: 0, end: 400 },
      { start: 400, end: 800 },
      { start: 800, end: 1000 },
    ]);
  });

  it('snapToZero ищет пересечение нуля', () => {
    const x = new Float32Array(200);
    for (let i = 0; i < 200; i++) x[i] = Math.sin((2 * Math.PI * (i - 50)) / 100);
    expect(Math.abs(snapToZero(x, 55, 20) - 50)).toBeLessThanOrEqual(1);
  });

  it('оценка темпа: 4 такта amen ≈ 140 BPM', () => {
    const e = estimateBpm(6.857);
    expect(e.bars).toBe(4);
    expect(e.bpm).toBeCloseTo(140, 0);
  });
});
