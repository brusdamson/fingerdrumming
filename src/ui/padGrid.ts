import type { LoadedKit } from '../audio/engine';
import { PAD_TO_KEY } from '../midi/input';
import { h } from '../util/dom';

/** Сетка 4×4, как на MPD218: пэд 1 — слева внизу, пэд 16 — справа вверху. */
export class PadGrid {
  el: HTMLElement;
  private cells: HTMLElement[] = [];

  constructor(onPress: (pad: number, velocity: number, timeStamp: number) => void, small = false) {
    this.el = h('div', { class: 'pads' + (small ? ' pads-small' : '') });
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) {
        const pad = row * 4 + col + 1;
        const cell = h(
          'button',
          {
            class: 'pad',
            type: 'button',
            onpointerdown: (e: PointerEvent) => {
              e.preventDefault();
              onPress(pad, 100, e.timeStamp);
            },
          },
          h('span', { class: 'pad-num' }, pad),
          h('span', { class: 'pad-name' }),
          h('span', { class: 'pad-key' }, PAD_TO_KEY[pad - 1]),
        );
        this.cells[pad - 1] = cell;
        this.el.append(cell);
      }
    }
  }

  /** used — звуки, задействованные в уроке; остальные пэды приглушаются. */
  setKit(kit: LoadedKit | null, used?: Set<string>): void {
    this.cells.forEach((cell, i) => {
      const p = kit?.pads[i] ?? null;
      cell.querySelector('.pad-name')!.textContent = p ? p.name : '—';
      cell.style.setProperty('--c', p ? p.color : '#3a3f4b');
      cell.classList.toggle('pad-empty', !p);
      cell.classList.toggle('pad-dim', !!p && !!used && !used.has(p.sound));
    });
  }

  mark(pad: number | null): void {
    this.cells.forEach((c, i) => c.classList.toggle('pad-target', pad === i + 1));
  }

  flash(pad: number): void {
    const cell = this.cells[pad - 1];
    if (!cell) return;
    cell.classList.remove('pad-hit');
    void cell.offsetWidth; // перезапуск анимации
    cell.classList.add('pad-hit');
  }
}
