import { PASS_ACCURACY, WINDOWS, type Stats } from '../game/judge';
import { fmtMs, h } from '../util/dom';

export interface ResultAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface ResultsOpts {
  stats: Stats;
  bpm: number;
  maxCombo: number;
  stars: number;
  ladder: boolean;
  labels: Record<string, string>;
  actions: (ResultAction | null | false | undefined)[];
}

export function resultsPanel(o: ResultsOpts): HTMLElement {
  const st = o.stats;
  const passed = st.accuracy >= PASS_ACCURACY;

  let verdict: string;
  if (!st.deltasMs.length) verdict = 'Ни одного попадания — попробуй темп ниже или режим «Без темпа».';
  else if (Math.abs(st.meanMs) < 6) verdict = 'В среднем ты попадаешь точно в долю.';
  else if (st.meanMs < 0) verdict = `В среднем ты спешишь на ${Math.abs(st.meanMs).toFixed(0)} мс.`;
  else verdict = `В среднем ты опаздываешь на ${st.meanMs.toFixed(0)} мс.`;
  if (st.deltasMs.length) {
    verdict +=
      st.sdMs < 12
        ? ' Разброс маленький — играешь ровно.'
        : st.sdMs < 22
          ? ' Разброс средний.'
          : ' Разброс большой — удары «гуляют», помедленнее будет полезнее.';
  }

  const rows = Object.entries(st.bySound).map(([sound, s]) =>
    h(
      'tr',
      null,
      h('td', null, o.labels[sound] ?? sound),
      h('td', null, `${s.hit} / ${s.total}`),
      h('td', null, s.hit ? fmtMs(s.meanMs) : '—'),
    ),
  );

  const hist = h('canvas', { class: 'hist', width: 520, height: 120 });
  drawHistogram(hist, st.deltasMs);

  return h(
    'div',
    { class: 'results' },
    h('div', { class: 'results-top' },
      h('div', { class: 'big-acc ' + (passed ? 'pass' : 'fail') }, st.accuracy.toFixed(1) + '%'),
      h('div', null,
        h('div', { class: 'stars' }, '★'.repeat(o.stars) + '☆'.repeat(3 - o.stars)),
        h('div', { class: 'results-sub' },
          `${o.bpm} BPM · `,
          passed ? 'зачёт сдан' : `нужно ≥ ${PASS_ACCURACY}%`,
          o.ladder ? '' : ' · свой темп, в прогресс не идёт',
        ),
      ),
    ),
    h('div', { class: 'counts' },
      h('span', { class: 'c-perfect' }, `точно ${st.perfect}`),
      h('span', { class: 'c-good' }, `хорошо ${st.good}`),
      h('span', { class: 'c-ok' }, `неточно ${st.ok}`),
      h('span', { class: 'c-miss' }, `пропуск ${st.miss}`),
      h('span', { class: 'c-miss' }, `лишние ${st.extras}`),
      h('span', null, `макс. комбо ${o.maxCombo}`),
    ),
    h('p', { class: 'verdict' }, verdict,
      st.deltasMs.length ? ` (сдвиг ${fmtMs(st.meanMs, 1)}, разброс ±${st.sdMs.toFixed(1)} мс)` : ''),
    hist,
    h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Звук'), h('th', null, 'Попаданий'), h('th', null, 'Сдвиг'))),
      h('tbody', null, rows),
    ),
    h('p', { class: 'hint' },
      `Окна: точно ±${WINDOWS.perfect * 1000} мс, хорошо ±${WINDOWS.good * 1000} мс, неточно ±${WINDOWS.ok * 1000} мс. ` +
      'Точность = очки за ноты (100/70/40/0) минус 25 за каждый лишний удар.'),
    h('div', { class: 'actions' },
      o.actions
        .filter((a): a is ResultAction => !!a)
        .map((a) => h('button', { class: 'btn' + (a.primary ? ' btn-primary' : ''), type: 'button', onclick: a.run }, a.label)),
    ),
  );
}

/** Гистограмма отклонений: слева — рано, справа — поздно. */
export function drawHistogram(canvas: HTMLCanvasElement, deltas: number[], range = 70, binMs = 5): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  const bins = Math.round((range * 2) / binMs);
  const counts = new Array<number>(bins).fill(0);
  for (const d of deltas) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((d + range) / binMs)));
    counts[i]++;
  }
  const max = Math.max(1, ...counts);
  const base = H - 18;
  const bw = W / bins;
  for (let i = 0; i < bins; i++) {
    const center = -range + (i + 0.5) * binMs;
    const a = Math.abs(center);
    g.fillStyle = a <= 20 ? '#7dffb0' : a <= 40 ? '#d6e04a' : '#ffc23c';
    const bh = (counts[i] / max) * (base - 6);
    g.fillRect(i * bw + 1, base - bh, bw - 2, bh);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(W / 2 - 0.5, 0, 1, base);
  g.fillStyle = '#7c8494';
  g.font = '10px ui-monospace, Consolas, monospace';
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillText(`рано −${range} мс`, 2, H - 4);
  g.textAlign = 'center';
  g.fillText('0', W / 2, H - 4);
  g.textAlign = 'right';
  g.fillText(`поздно +${range} мс`, W - 2, H - 4);
}
