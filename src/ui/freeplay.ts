import { app, type Screen } from '../app';
import { h } from '../util/dom';
import { backingById } from '../audio/backing';
import { backingControls } from './backingUi';
import { PadGrid } from './padGrid';

export async function freeplayScreen(): Promise<Screen> {
  let kit = await app.kit(app.settings.freeKit || app.lessonKitId()).catch(() => app.kit(app.lessonKitId()));
  app.engine.setKit(kit);

  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts));
  padGrid.setKit(kit);
  const info = h('div', { class: 'status' }, 'Бей по пэдам. Здесь ничего не оценивается — выбери подыгрыш, нажми «Играть» и драмь под него.');

  // Транспорт свободной игры: метроном и подыгрыш идут по одной сетке от t0.
  let bpm = 174;
  let running = false;
  let clickOn = app.settings.metronome;
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
  /** Привести звучащее к текущим настройкам, не сбивая сетку. */
  const apply = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (!running) {
      app.backing.stop();
      return;
    }
    const ctx = app.engine.ctx;
    if (clickOn) {
      nextBeat = Math.max(0, Math.ceil((ctx.currentTime + 0.02 - t0) / (60 / bpm)));
      tick();
      timer = window.setInterval(tick, 25);
    }
    const style = backingById(app.settings.backing);
    if (style) app.backing.start(ctx, style, bpm, t0);
    else app.backing.stop();
  };
  const stopClick = () => {
    running = false;
    apply();
    clickBtn.textContent = '▶ Играть';
  };
  const startClick = () => {
    running = true;
    t0 = app.engine.ctx.currentTime + 0.1;
    apply();
    clickBtn.textContent = '■ Стоп';
  };
  const clickBtn = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => (running ? stopClick() : startClick()) },
    '▶ Играть',
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
            if (running) startClick();
          }
        },
      }),
      h('span', { class: 'label' }, 'BPM'),
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: clickOn,
          onchange: (e: Event) => {
            clickOn = (e.target as HTMLInputElement).checked;
            apply();
          },
        }),
        'метроном',
      ),
      ...backingControls(apply),
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
