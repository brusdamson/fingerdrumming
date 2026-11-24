import { app, type Screen } from '../app';
import { PASS_ACCURACY, stars, type JNote, type Stats } from '../game/judge';
import { parseLesson, stepDuration, type Lesson } from '../game/pattern';
import { Renderer, type Lane, type View } from '../game/render';
import { Session, type Mode } from '../game/session';
import { LESSONS } from '../lessons';
import { saveProgress } from '../storage/settings';
import { clear, fmtMs, h } from '../util/dom';
import { PadGrid } from './padGrid';
import { resultsPanel } from './results';

export async function lessonScreen(lesson: Lesson): Promise<Screen> {
  const kitId = lesson.kit === 'dnb' ? 'dnb' : app.settings.sliceKit;
  let kit = await app.kit(kitId).catch(() => app.kit('amen'));
  app.engine.setKit(kit);

  const sounds = Object.keys(lesson.tracks);
  const used = new Set(sounds);
  const soundOfPad = (pad: number) => kit.pads[pad - 1]?.sound;
  const buildLanes = (): Lane[] =>
    sounds.map((s) => {
      const pads = kit.pads.filter((p) => p && p.sound === s).map((p) => p!.pad);
      const first = kit.pads.find((p) => p && p.sound === s);
      return { sound: s, label: first?.name ?? s, pads, color: first?.color ?? '#666' };
    });

  const best = () => (app.progress[lesson.id] ??= {});
  const unlocked = (i: number) => i === 0 || (best()[String(lesson.tempos[i - 1])] ?? 0) >= PASS_ACCURACY;
  let bpm = lesson.tempos[0];
  for (let i = 0; i < lesson.tempos.length; i++) if (unlocked(i)) bpm = lesson.tempos[i];
  // Если последняя открытая ступень уже сдана — остаёмся на ней, иначе на первой несданной.
  let session: Session | null = null;
  let metronome = app.settings.metronome;

  const canvas = h('canvas', { class: 'stage' });
  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts), true);
  padGrid.setKit(kit, used);
  const tempoRow = h('div', { class: 'tempo-row' });
  const hud = h('div', { class: 'hud' });
  const status = h('div', { class: 'status' });
  const overlay = h('div', { class: 'overlay', hidden: true });
  const customBpm = h('input', {
    class: 'input num',
    type: 'number',
    min: 40,
    max: 220,
    value: bpm,
    title: 'Свой темп (результат зачёта на нестандартном темпе не сохраняется)',
    onchange: () => {
      const v = Math.round(Number(customBpm.value));
      if (v >= 40 && v <= 220) {
        bpm = v;
        stop();
        renderTempos();
      } else customBpm.value = String(bpm);
    },
  });

  const btn = (label: string, cls: string, fn: () => void) =>
    h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);
  const stopBtn = btn('■ Стоп', 'btn-ghost', () => stop());
  const controls = h(
    'div',
    { class: 'controls' },
    btn('▶ Практика', 'btn-primary', () => start('practice')),
    btn('★ Зачёт', 'btn-accent', () => start('exam')),
    btn('♪ Послушать', '', () => start('demo')),
    btn('⏸ Без темпа', '', () => start('wait')),
    stopBtn,
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: metronome,
        onchange: (e: Event) => {
          metronome = (e.target as HTMLInputElement).checked;
          app.settings.metronome = metronome;
          app.save();
        },
      }),
      'метроном',
    ),
  );

  const kitSelect =
    lesson.kit === 'slices'
      ? h(
          'select',
          {
            class: 'input',
            onchange: async (e: Event) => {
              stop();
              const id = (e.target as HTMLSelectElement).value;
              kit = await app.kit(id);
              app.settings.sliceKit = id;
              app.save();
              app.engine.setKit(kit);
              padGrid.setKit(kit, used);
              renderer.setLanes(buildLanes());
            },
          },
          app.kitChoices(true).map((k) => h('option', { value: k.id, selected: k.id === kit.id }, k.name)),
        )
      : null;

  const idx = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[idx + 1];

  const el = h(
    'div',
    { class: 'lesson' },
    h(
      'div',
      { class: 'lesson-head' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => app.open('home') }, '← Уроки'),
      h('div', null, h('div', { class: 'crumb' }, lesson.group), h('h1', null, lesson.title)),
    ),
    h('p', { class: 'lesson-text' }, lesson.text),
    h('div', { class: 'tempo-line' }, h('span', { class: 'label' }, 'Темп'), tempoRow, customBpm, h('span', { class: 'label' }, 'BPM'), kitSelect),
    controls,
    h('div', { class: 'stage-wrap' }, canvas, overlay),
    h('div', { class: 'under' }, h('div', { class: 'hud-col' }, hud, status), padGrid.el),
  );

  const renderer = new Renderer(canvas, buildLanes());
  const idleNotes: JNote[] = parseLesson(lesson).notes.map((p, i) => ({
    id: i,
    t: p.step,
    sound: p.sound,
    level: p.level,
    loop: 0,
  }));
  let idleCache: { bpm: number; notes: JNote[] } | null = null;

  function renderTempos(): void {
    clear(tempoRow);
    lesson.tempos.forEach((t, i) => {
      const ok = unlocked(i);
      const acc = best()[String(t)];
      tempoRow.append(
        h(
          'button',
          {
            class: 'chip' + (t === bpm ? ' active' : '') + ((acc ?? 0) >= PASS_ACCURACY ? ' passed' : ''),
            type: 'button',
            disabled: !ok,
            title: ok
              ? acc !== undefined
                ? `Лучший зачёт: ${acc.toFixed(1)}%`
                : 'Зачёт ещё не сдан'
              : `Откроется после зачёта на ${lesson.tempos[i - 1]} BPM (≥ ${PASS_ACCURACY}%)`,
            onclick: () => {
              bpm = t;
              stop();
              renderTempos();
            },
          },
          ok ? String(t) : '🔒 ' + t,
        ),
      );
    });
    customBpm.value = String(bpm);
  }

  function renderHud(text?: string): void {
    clear(hud);
    const s = session;
    if (!s || s.mode === 'demo' || s.mode === 'wait') {
      hud.append(h('div', { class: 'hud-item' }, h('span', null, 'Режим'), h('b', null, modeName(s?.mode))));
    } else {
      const st = s.judge.stats();
      hud.append(
        h('div', { class: 'hud-item' }, h('span', null, 'Точность'), h('b', null, st.total ? st.accuracy.toFixed(0) + '%' : '—')),
        h('div', { class: 'hud-item' }, h('span', null, 'Комбо'), h('b', null, s.combo)),
        h('div', { class: 'hud-item' }, h('span', null, 'Средний сдвиг'), h('b', null, st.deltasMs.length ? fmtMs(st.meanMs) : '—')),
        h('div', { class: 'hud-item' }, h('span', null, 'Пропуски / лишние'), h('b', null, `${st.miss} / ${st.extras}`)),
      );
    }
    if (text !== undefined) status.textContent = text;
  }

  function modeName(m?: Mode): string {
    return m === 'practice' ? 'практика' : m === 'exam' ? 'зачёт' : m === 'demo' ? 'образец' : m === 'wait' ? 'без темпа' : 'готов';
  }

  function start(mode: Mode): void {
    stop();
    overlay.hidden = true;
    const o = app.offsets;
    session = new Session({
      engine: app.engine,
      clock: app.clock,
      lesson,
      bpm,
      mode,
      metronome,
      audioOffsetMs: o.audioMs,
      visualOffsetMs: o.visualMs,
      onFeedback: () => renderHud(),
      onLoop: (k, st) => {
        if (mode === 'practice') {
          renderHud(`Круг ${k + 1}: точность ${st.accuracy.toFixed(0)}%` + (st.deltasMs.length ? `, сдвиг ${fmtMs(st.meanMs)}` : ''));
        }
      },
      onFinish: (st) => finish(st, mode),
    });
    app.debugSession = session;
    session.start();
    renderHud(
      mode === 'practice'
        ? 'Паттерн идёт по кругу. Остановить — «Стоп».'
        : mode === 'exam'
          ? `Зачёт: ${lesson.repeats} повторов. Для следующей ступени нужно ≥ ${PASS_ACCURACY}%.`
          : mode === 'demo'
            ? 'Слушай, как это звучит.'
            : 'Темпа нет: нота ждёт на линии, пока не ударишь нужный пэд. Тайминг не оценивается.',
    );
  }

  function stop(): void {
    if (session) {
      const wasDemo = session.mode === 'demo';
      session.stop();
      session = null;
      if (wasDemo) app.engine.stopAll();
    }
    renderHud('');
  }

  function finish(st: Stats | null, mode: Mode): void {
    const s = session;
    session = null;
    renderHud('');
    if (!st || mode !== 'exam' || !s) return;
    const key = String(bpm);
    const ladder = lesson.tempos.includes(bpm);
    const prev = best()[key];
    if (ladder && (prev === undefined || st.accuracy > prev)) {
      best()[key] = st.accuracy;
      saveProgress(app.progress);
    }
    const i = lesson.tempos.indexOf(bpm);
    const passed = st.accuracy >= PASS_ACCURACY;
    const nextTempo = ladder && passed ? lesson.tempos[i + 1] : undefined;
    renderTempos();
    clear(overlay);
    overlay.append(
      resultsPanel({
        stats: st,
        bpm,
        maxCombo: s.maxCombo,
        stars: stars(st.accuracy),
        ladder,
        labels: Object.fromEntries(buildLanes().map((l) => [l.sound, l.label])),
        actions: [
          { label: 'Ещё раз', primary: !passed, run: () => start('exam') },
          nextTempo
            ? {
                label: `Дальше: ${nextTempo} BPM`,
                primary: true,
                run: () => {
                  bpm = nextTempo;
                  renderTempos();
                  overlay.hidden = true;
                },
              }
            : null,
          ladder && passed && !nextTempo && nextLesson
            ? { label: 'Следующий урок →', primary: true, run: () => app.go(() => lessonScreen(nextLesson)) }
            : null,
          { label: 'Закрыть', run: () => (overlay.hidden = true) },
        ],
      }),
    );
    overlay.hidden = false;
  }

  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const s = session;
    if (s) {
      s.update();
      const v: View = {
        notes: s.judge.notes,
        time: s.visualTime(),
        beatDur: s.beatDur,
        stepDur: s.stepDur,
        grid: lesson.grid,
        feedback: s.feedback,
        idle: false,
      };
      renderer.draw(v);
    } else {
      // Превью паттерна, пока ничего не запущено.
      if (!idleCache || idleCache.bpm !== bpm) {
        const sd = stepDuration(bpm, lesson.grid);
        idleCache = { bpm, notes: idleNotes.map((n) => ({ ...n, t: n.t * sd })) };
      }
      const sd = stepDuration(bpm, lesson.grid);
      renderer.draw({
        notes: idleCache.notes,
        time: -sd * (lesson.grid / 8),
        beatDur: 60 / bpm,
        stepDur: sd,
        grid: lesson.grid,
        feedback: [],
        idle: true,
      });
    }
  };

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  renderTempos();
  renderHud('Выбери темп и режим. Клавиатура тоже работает: Z X C V / A S D F / Q W E R / 1 2 3 4 (Shift — тихий удар).');
  requestAnimationFrame(() => {
    renderer.resize();
    frame();
  });

  return {
    el,
    onPad: (pad, _vel, ts) => {
      padGrid.flash(pad);
      const sound = soundOfPad(pad);
      if (sound && session) session.onHit(sound, ts);
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (session) {
        session.stop();
        app.engine.stopAll();
      }
    },
  };
}
