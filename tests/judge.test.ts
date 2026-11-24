import { describe, expect, it } from 'vitest';
import { Judge, WINDOWS, type JNote } from '../src/game/judge';

function notes(times: number[], sound = 'kick'): JNote[] {
  return times.map((t, i) => ({ id: i + 1, t, sound, level: 'normal', loop: 0 }));
}

describe('Judge', () => {
  it('сообщает ровно то отклонение, с которым пришёл удар', () => {
    const j = new Judge();
    j.addNotes(notes([1, 2, 3, 4]));
    const late = j.hit('kick', 1.015);
    expect(late.kind).toBe('perfect');
    expect(late.deltaMs).toBeCloseTo(15, 6);
    const early = j.hit('kick', 1.97);
    expect(early.kind).toBe('good');
    expect(early.deltaMs).toBeCloseTo(-30, 6);
    const ok = j.hit('kick', 3.06);
    expect(ok.kind).toBe('ok');
    expect(ok.deltaMs).toBeCloseTo(60, 6);
  });

  it('удар вне окна — лишний, нота остаётся ждать и потом становится пропуском', () => {
    const j = new Judge();
    j.addNotes(notes([1, 2]));
    expect(j.hit('kick', 1 + WINDOWS.ok + 0.01).kind).toBe('extra');
    expect(j.extras).toBe(1);
    const missed = j.advance(1.5);
    expect(missed.map((n) => n.id)).toEqual([1]);
    expect(j.notes[1].verdict).toBeUndefined();
  });

  it('удар по другому звуку не засчитывается ноте', () => {
    const j = new Judge();
    j.addNotes(notes([1], 'kick'));
    expect(j.hit('snare', 1).kind).toBe('extra');
    expect(j.hit('kick', 1.001).kind).toBe('perfect');
  });

  it('одна нота не засчитывается дважды', () => {
    const j = new Judge();
    j.addNotes(notes([1, 2]));
    expect(j.hit('kick', 1).kind).toBe('perfect');
    expect(j.hit('kick', 1.01).kind).toBe('extra');
  });

  it('на плотном ролле окно сужается до половины интервала и удары не прилипают к соседям', () => {
    // 32-е на 174 BPM: интервал ≈ 43.1 мс
    const gap = 60 / 174 / 8;
    const times = Array.from({ length: 8 }, (_, i) => 1 + i * gap);
    const j = new Judge();
    j.addNotes(notes(times, 'snare'));
    expect(j.matchWindow('snare')).toBeCloseTo(gap / 2, 9);
    // Удар на 10 мс позже третьей ноты должен достаться именно ей.
    const r = j.hit('snare', times[2] + 0.01);
    expect(r.note?.id).toBe(3);
    expect(r.deltaMs).toBeCloseTo(10, 6);
    // Удар на 15 мс раньше пятой ноты — ей, а не четвёртой.
    const r2 = j.hit('snare', times[4] - 0.015);
    expect(r2.note?.id).toBe(5);
    expect(r2.deltaMs).toBeCloseTo(-15, 6);
  });

  it('постоянный сдвиг ударов виден в статистике как есть', () => {
    const j = new Judge();
    const times = Array.from({ length: 16 }, (_, i) => 1 + i * 0.5);
    j.addNotes(notes(times));
    for (const t of times) j.hit('kick', t - 0.03);
    j.advance(100);
    const st = j.stats();
    expect(st.meanMs).toBeCloseTo(-30, 6);
    expect(st.sdMs).toBeCloseTo(0, 6);
    expect(st.good).toBe(16);
    expect(st.accuracy).toBeCloseTo(70, 6);
  });

  it('точность: идеальная игра = 100, лишние удары её снижают, пропуски считаются', () => {
    const j = new Judge();
    j.addNotes(notes([1, 2, 3, 4]));
    j.hit('kick', 1);
    j.hit('kick', 2);
    j.hit('kick', 3);
    j.hit('kick', 4);
    expect(j.stats().accuracy).toBe(100);
    j.hit('kick', 4.5);
    expect(j.stats().accuracy).toBeCloseTo((400 - 25) / 4, 6);

    const j2 = new Judge();
    j2.addNotes(notes([1, 2]));
    j2.hit('kick', 1);
    j2.advance(10);
    const st = j2.stats();
    expect(st.miss).toBe(1);
    expect(st.accuracy).toBe(50);
  });

  it('ноты другого звука с более широким окном не мешают отмечать пропуски', () => {
    const j = new Judge();
    j.addNotes([
      { id: 1, t: 1, sound: 'a', level: 'normal', loop: 0 },
      { id: 2, t: 1.02, sound: 'a', level: 'normal', loop: 0 },
      { id: 3, t: 1.03, sound: 'b', level: 'normal', loop: 0 },
    ]);
    const missed = j.advance(1.05);
    // у 'a' окно 10 мс → обе просрочены; у 'b' окно 70 мс → ещё ждёт
    expect(missed.map((n) => n.id)).toEqual([1, 2]);
    expect(j.hit('b', 1.04).kind).toBe('perfect');
  });
});
