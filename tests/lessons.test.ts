import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OffsetEstimator } from '../src/audio/clock';
import { parseLesson, stepDuration } from '../src/game/pattern';
import { LESSONS } from '../src/lessons';

interface KitFile {
  id: string;
  type: string;
  pads: { pad: number; sound: string; layers: { files: string[] }[] }[];
}
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const index = read<{ id: string; kind: string; requires?: string }[]>('public/kits/index.json');
const oneshotKits = index.filter((k) => k.kind === 'oneshot').map((k) => ({
  ...k,
  kit: read<KitFile>(`public/kits/${k.id}/kit.json`),
}));
const amen = read<{ pick: number[] }>('public/kits/amen/kit.json');
// Сэмплы SampleRadar не лежат в git — проверяем их файлы, только если они скачаны.
const haveSampleRadar = existsSync('public/kits/sampleradar');

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
          // урок должен играться на любом one-shot ките из списка
          for (const k of oneshotKits) {
            expect(k.kit.pads.some((p) => p.sound === sound), `в ките ${k.id} нет звука ${sound}`).toBe(true);
          }
        } else {
          const m = /^s(\d+)$/.exec(sound);
          expect(m, `звук ${sound} — не слайс`).not.toBeNull();
          expect(Number(m![1])).toBeLessThanOrEqual(8); // уроки чопа работают с любым китом от 8 слайсов
        }
      }
    });
  }

  for (const k of oneshotKits) {
    it(`кит ${k.id}: 16 пэдов, файлы существуют`, () => {
      expect(k.kit.id).toBe(k.id);
      expect(k.kit.pads.map((p) => p.pad).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      if (k.requires === 'sampleradar' && !haveSampleRadar) return;
      for (const p of k.kit.pads) {
        for (const layer of p.layers) {
          expect(layer.files.length).toBeGreaterThan(0);
          for (const f of layer.files) expect(existsSync(`public/kits/${k.id}/${f}`), f).toBe(true);
        }
      }
    });
  }

  it('брейки SampleRadar: по 16 слайсов, файлы на месте (если скачаны)', () => {
    const beats = read<{ id: string; kind: string; manifest?: { id: string; file: string; bars: number; slicesPerBar: number; pick: number[] } }[]>(
      'public/kits/index.json',
    ).filter((k) => k.manifest);
    expect(beats.length).toBeGreaterThan(0);
    for (const k of beats) {
      const m = k.manifest!;
      expect(k.kind).toBe('slices');
      expect(m.id).toBe(k.id);
      expect(m.pick.length).toBe(16);
      expect(Math.max(...m.pick)).toBeLessThan(m.bars * m.slicesPerBar);
      if (haveSampleRadar) expect(existsSync(`public/kits/${k.id}/${m.file}`.replace(/[^/]+\/\.\.\//, '')), m.file).toBe(true);
    }
  });

  it('amen: 16 слайсов', () => {
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
