import type { Level } from './judge';

export type KitKind = 'dnb' | 'slices';

export interface Lesson {
  id: string;
  group: string;
  title: string;
  text: string;
  kit: KitKind;
  /** Шагов на такт: 16 — шестнадцатые, 32 — тридцать вторые, 24 — триоли шестнадцатых. */
  grid: number;
  bars: number;
  /**
   * Дорожки: звук → строка шагов. 'x' — обычный удар, 'X' — акцент, 'o' — ghost (тихо),
   * '.' — пауза. Пробелы и '|' игнорируются (для читаемости).
   */
  tracks: Record<string, string>;
  /** Лесенка темпа, по возрастанию. */
  tempos: number[];
  /** Сколько раз паттерн повторяется в зачёте. */
  repeats: number;
}

export interface PNote {
  step: number;
  sound: string;
  level: Level;
}

export function cleanTrack(s: string): string {
  return s.replace(/[\s|]/g, '');
}

export function parseLesson(lesson: Lesson): { notes: PNote[]; steps: number } {
  const steps = lesson.grid * lesson.bars;
  const notes: PNote[] = [];
  for (const [sound, raw] of Object.entries(lesson.tracks)) {
    const s = cleanTrack(raw);
    if (s.length !== steps) {
      throw new Error(`Урок ${lesson.id}: дорожка ${sound} — ${s.length} шагов, ожидалось ${steps}`);
    }
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '.') continue;
      const level: Level | null = c === 'x' ? 'normal' : c === 'X' ? 'accent' : c === 'o' ? 'ghost' : null;
      if (!level) throw new Error(`Урок ${lesson.id}: неизвестный символ '${c}' в дорожке ${sound}`);
      notes.push({ step: i, sound, level });
    }
  }
  notes.sort((a, b) => a.step - b.step);
  return { notes, steps };
}

/** Длительность одного шага сетки в секундах (такт 4/4). */
export function stepDuration(bpm: number, grid: number): number {
  return (60 / bpm) * 4 / grid;
}

export function levelVelocity(level: Level): number {
  return level === 'accent' ? 122 : level === 'ghost' ? 42 : 100;
}
