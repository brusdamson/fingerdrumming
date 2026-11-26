import { app, type Screen } from '../app';
import { clear, h } from '../util/dom';
import { applyPadOverrides, sampleLabel } from '../audio/kit';
import { backingById } from '../audio/backing';
import { backingControls } from './backingUi';
import { PadGrid } from './padGrid';

export async function freeplayScreen(): Promise<Screen> {
  /** Кит свободной игры = кит из списка + свои звуки на отдельных пэдах. */
  const loadKit = async (id: string) =>
    applyPadOverrides(app.engine, await app.kit(id), app.settings.padOverrides[id], app.pool);
  let kit = await loadKit(app.settings.freeKit || app.lessonKitId()).catch(() => loadKit(app.lessonKitId()));
  app.engine.setKit(kit);

  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts));
  padGrid.setKit(kit);
  const info = h('div', { class: 'status' }, 'Бей по пэдам. Здесь ничего не оценивается — выбери подыгрыш, нажми «Играть» и драмь под него.');

  const useKit = async (id: string): Promise<void> => {
    kit = await loadKit(id);
    app.engine.setKit(kit);
    padGrid.setKit(kit);
  };

  // Свой звук на любой пэд: сэмплы из пула, сгруппированные по типам.
  const CATS: Record<string, string> = {
    kicks: 'Кики', snares: 'Снейры', hats: 'Хэты', cymbals: 'Тарелки', perc: 'Перкуссия', fx: 'Джангл-FX, стэбы, роллы',
  };
  const padsPanel = h('div', { class: 'padsounds', hidden: true });
  function renderPadSounds(): void {
    clear(padsPanel);
    const pool = app.pool;
    if (padsPanel.hidden || !pool) return;
    const current = app.settings.padOverrides[kit.id] ?? {};
    const cells: HTMLElement[] = [];
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) {
        const pad = row * 4 + col + 1;
        const select = h(
          'select',
          {
            class: 'input',
            onchange: async () => {
              const o = (app.settings.padOverrides[kit.id] ??= {});
              if (select.value) o[pad] = select.value;
              else delete o[pad];
              app.save();
              await useKit(kit.id);
              app.engine.trigger(pad, 110);
              padGrid.flash(pad);
            },
          },
          h('option', { value: '', selected: !current[pad] }, '— как в ките —'),
          Object.entries(pool.categories).map(([cat, c]) => {
            const g = h('optgroup', { label: CATS[cat] ?? cat });
            g.append(...c.files.map((f) => h('option', { value: f, selected: current[pad] === f }, sampleLabel(f))));
            return g;
          }),
        );
        cells.push(h('label', { class: 'padsound' }, h('span', { class: 'label' }, `Пэд ${pad}`), select));
      }
    }
    padsPanel.append(
      h('p', { class: 'hint' },
        'На любой пэд можно положить свой сэмпл — он сразу прозвучит (стрелки ↑↓ листают список). Раскладка запоминается для выбранного кита и действует только в свободной игре.'),
      h('div', { class: 'padsound-grid' }, cells),
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: async () => {
          delete app.settings.padOverrides[kit.id];
          app.save();
          await useKit(kit.id);
          renderPadSounds();
        },
      }, 'Вернуть звуки кита'),
    );
  }
  const padsBtn = app.pool
    ? h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
          padsPanel.hidden = !padsPanel.hidden;
          renderPadSounds();
        },
      }, 'Звуки пэдов…')
    : null;

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
            await useKit(id);
            app.settings.freeKit = id;
            app.save();
            renderPadSounds();
          },
        },
        ([['Киты', 'oneshot'], ['Брейки (слайсы)', 'slices']] as const).map(([label, kind]) => {
          const g = h('optgroup', { label });
          g.append(...app.kitChoices(kind).map((k) => h('option', { value: k.id, selected: k.id === kit.id }, k.name)));
          return g;
        }),
      ),
      padsBtn,
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
    padsPanel,
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
