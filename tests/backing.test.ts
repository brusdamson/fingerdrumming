import { describe, expect, it } from 'vitest';
import { BACKINGS } from '../src/audio/backing';

describe('подыгрыш', () => {
  it('id уникальны', () => {
    expect(new Set(BACKINGS.map((b) => b.id)).size).toBe(BACKINGS.length);
  });

  for (const b of BACKINGS) {
    it(`${b.id}: ноты баса в пределах цикла и не накладываются`, () => {
      const steps = b.bars * 16;
      const bass = [...b.bass].sort((x, y) => x[0] - y[0]);
      expect(bass.length).toBeGreaterThan(0);
      bass.forEach(([step, len, midi, slide], i) => {
        expect(step).toBeGreaterThanOrEqual(0);
        expect(len).toBeGreaterThan(0);
        expect(step + len).toBeLessThanOrEqual(steps);
        if (i > 0) expect(step).toBeGreaterThanOrEqual(bass[i - 1][0] + bass[i - 1][1]);
        // бас держим в диапазоне, который слышен и не гудит: E1…E2
        for (const m of slide === undefined ? [midi] : [midi, slide]) {
          expect(m).toBeGreaterThanOrEqual(28);
          expect(m).toBeLessThanOrEqual(40);
        }
      });
      for (const c of b.chords) {
        expect(c.bar + c.bars).toBeLessThanOrEqual(b.bars);
        expect(c.notes.length).toBeGreaterThan(0);
      }
    });
  }
});
