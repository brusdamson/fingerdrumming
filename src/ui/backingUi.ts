import { app } from '../app';
import { BACKINGS } from '../audio/backing';
import { h } from '../util/dom';

/** Выбор подыгрыша и его громкость. onChange вызывается при смене стиля. */
export function backingControls(onChange: () => void): HTMLElement[] {
  return [h('span', { class: 'backing' }, ...parts(onChange))];
}

function parts(onChange: () => void): HTMLElement[] {
  return [
    h('span', { class: 'label' }, 'Подыгрыш'),
    h(
      'select',
      {
        class: 'input',
        title: 'Бас и аккорды, под которые можно играть',
        onchange: (e: Event) => {
          app.settings.backing = (e.target as HTMLSelectElement).value;
          app.save();
          onChange();
        },
      },
      h('option', { value: '', selected: !app.settings.backing }, 'нет'),
      BACKINGS.map((b) => h('option', { value: b.id, selected: b.id === app.settings.backing }, b.name)),
    ),
    h('input', {
      class: 'backing-vol',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      value: app.settings.backingVol,
      title: 'Громкость подыгрыша',
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        app.settings.backingVol = v;
        app.backing.setVolume(v);
        app.save();
      },
    }),
  ];
}
