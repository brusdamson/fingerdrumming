import { app, type Screen } from '../app';
import { PASS_ACCURACY } from '../game/judge';
import { LESSONS } from '../lessons';
import { h } from '../util/dom';
import { lessonScreen } from './lesson';

export function homeScreen(): Screen {
  const el = h('div', { class: 'home' });

  if (!app.offsets.calibrated) {
    el.append(
      h(
        'div',
        { class: 'banner' },
        h('div', null, h('b', null, 'Сначала калибровка.'), ' Без неё оценка «рано/поздно» будет сдвинута на задержку твоей звуковой карты и экрана. Это две минуты.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => app.open('calibration') }, 'Откалибровать'),
      ),
    );
  }

  const groups = new Map<string, typeof LESSONS>();
  for (const l of LESSONS) {
    if (!groups.has(l.group)) groups.set(l.group, []);
    groups.get(l.group)!.push(l);
  }

  for (const [group, lessons] of groups) {
    const list = h('div', { class: 'lesson-list' });
    for (const l of lessons) {
      const best = app.progress[l.id] ?? {};
      const passed = l.tempos.filter((t) => (best[String(t)] ?? 0) >= PASS_ACCURACY);
      const done = passed.length === l.tempos.length;
      list.append(
        h(
          'button',
          {
            class: 'lesson-card' + (done ? ' done' : ''),
            type: 'button',
            onclick: () => app.go(() => lessonScreen(l)),
          },
          h('div', { class: 'lesson-title' }, l.title),
          h(
            'div',
            { class: 'tempo-dots' },
            l.tempos.map((t) =>
              h('span', { class: 'tempo-dot' + ((best[String(t)] ?? 0) >= PASS_ACCURACY ? ' on' : '') }, t),
            ),
          ),
        ),
      );
    }
    el.append(h('section', null, h('h2', null, group), list));
  }

  el.append(
    h(
      'p',
      { class: 'hint' },
      'Цифры под уроком — ступени темпа (BPM). Ступень засчитана, когда зачёт сдан на ',
      String(PASS_ACCURACY),
      '% и выше; следующая открывается после предыдущей.',
    ),
  );
  return { el };
}
