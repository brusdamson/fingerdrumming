import { app, type Screen } from '../app';
import { h } from '../util/dom';
import { PadGrid } from './padGrid';

export async function freeplayScreen(): Promise<Screen> {
  let kit = await app.kit(app.settings.freeKit).catch(() => app.kit('dnb'));
  app.engine.setKit(kit);

  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts));
  padGrid.setKit(kit);
  const info = h('div', { class: 'status' }, 'Бей по пэдам. Здесь ничего не оценивается — просто звук.');

  // Простой метроном для свободной игры
  let bpm = 174;
  let timer: number | undefined;
  let nextBeat = 0;
  let t0 = 0;
  const tick = () => {
    const ctx = app.engine.ctx;
    const beat = 60 / bpm;
    while (t0 + nextBeat * beat < ctx.currentTime + 0.12) {
      app.engine.click(t0 + nextBeat * beat, nextBeat % 4 === 0);
      nextBeat++;
    }
  };
  const stopClick = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    clickBtn.textContent = '▶ Метроном';
  };
  const startClick = () => {
    stopClick();
    t0 = app.engine.ctx.currentTime + 0.1;
    nextBeat = 0;
    timer = window.setInterval(tick, 25);
    clickBtn.textContent = '■ Метроном';
  };
  const clickBtn = h(
    'button',
    { class: 'btn', type: 'button', onclick: () => (timer === undefined ? startClick() : stopClick()) },
    '▶ Метроном',
  );

  const el = h(
    'div',
    { class: 'freeplay' },
    h('h1', null, 'Свободная игра'),
    h(
      'div',
      { class: 'controls' },
      h('span', { class: 'label' }, 'Кит'),
      h(
        'select',
        {
          class: 'input',
          onchange: async (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            kit = await app.kit(id);
            app.engine.setKit(kit);
            padGrid.setKit(kit);
            app.settings.freeKit = id;
            app.save();
          },
        },
        app.kitChoices().map((k) => h('option', { value: k.id, selected: k.id === kit.id }, k.name)),
      ),
      clickBtn,
      h('input', {
        class: 'input num',
        type: 'number',
        min: 40,
        max: 220,
        value: bpm,
        onchange: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (v >= 40 && v <= 220) {
            bpm = v;
            if (timer !== undefined) startClick();
          }
        },
      }),
      h('span', { class: 'label' }, 'BPM'),
    ),
    padGrid.el,
    info,
  );

  return {
    el,
    onPad: (pad, vel) => {
      padGrid.flash(pad);
      const p = kit.pads[pad - 1];
      info.textContent = p ? `Пэд ${pad} · ${p.name} · сила удара ${vel}` : `Пэд ${pad} пуст`;
    },
    destroy: stopClick,
  };
}
