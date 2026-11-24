import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OffsetEstimator } from '../src/audio/clock';
import { parseLesson, stepDuration } from '../src/game/pattern';
import { LESSONS } from '../src/lessons';

const dnb = JSON.parse(readFileSync('public/kits/dnb/kit.json', 'utf8')) as {
  pads: { pad: number; sound: string; layers: { files: string[] }[] }[];
};
const amen = JSON.parse(readFileSync('public/kits/amen/kit.json', 'utf8')) as { pick: number[] };

describe('уроки', () => {
  it('id уникальны', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  for (const l of LESSONS) {
    it(`${l.id}: корректная сетка, звуки есть в ките, темпы по возрастанию`, () => {
      const { notes, steps } = parseLesson(l); // бросит ошибку при неверной длине дорожки
      expect(steps).toBe(l.grid * l.bars);
      expect(notes.length).toBeGreaterThan(0);
      expect(l.tempos.length).toBeGreaterThan(0);
      expect([...l.tempos].sort((a, b) => a - b)).toEqual(l.tempos);
      expect(l.repeats).toBeGreaterThan(0);
      for (const sound of Object.keys(l.tracks)) {
        if (l.kit === 'dnb') {
          expect(dnb.pads.some((p) => p.sound === sound), `нет звука ${sound}`).toBe(true);
        } else {
          const m = /^s(\d+)$/.exec(sound);
          expect(m, `звук ${sound} — не слайс`).not.toBeNull();
          expect(Number(m![1])).toBeLessThanOrEqual(8); // уроки чопа работают с любым китом от 8 слайсов
        }
      }
    });
  }

  it('DnB-кит: 16 пэдов, файлы существуют', () => {
    expect(dnb.pads.map((p) => p.pad).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const p of dnb.pads) {
      for (const layer of p.layers) {
        for (const f of layer.files) expect(() => readFileSync('public/kits/dnb/' + f)).not.toThrow();
      }
    }
    expect(amen.pick.length).toBe(16);
  });

  it('длительность шага: шестнадцатая на 174 BPM ≈ 86.2 мс', () => {
    expect(stepDuration(174, 16) * 1000).toBeCloseTo(86.2, 1);
  });
});

describe('часы', () => {
  it('медиана гасит выбросы и следует за дрейфом', () => {
    const e = new OffsetEstimator(9);
    for (const v of [10, 10.001, 9.999, 10, 55, 10.0005, 9.9995, 10, 10]) e.push(v);
    expect(e.value).toBeCloseTo(10, 3);
    for (let i = 0; i < 9; i++) e.push(12);
    expect(e.value).toBe(12);
  });
});
