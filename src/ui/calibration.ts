import { app, type Screen } from '../app';
import { setOffsets } from '../storage/settings';
import { clear, fmtMs, h, median, stddev } from '../util/dom';
import { drawHistogram } from './results';

const BPM = 100;
const BEAT = 60 / BPM;
const LEAD = 4; // вступительные доли, не измеряются
const MEASURED = 20;
const MIN_TAPS = 12;

type Phase = 'audio' | 'visual';

interface Measure {
  medianMs: number;
  sdMs: number;
  taps: number[];
}

/** Убираем случайные промахи: всё, что дальше 100 мс от медианы. */
export function summarize(deltasMs: number[]): Measure {
  const m0 = median(deltasMs);
  const kept = deltasMs.filter((d) => Math.abs(d - m0) <= 100);
  return { medianMs: median(kept), sdMs: stddev(kept), taps: kept };
}

export async function calibrationScreen(): Promise<Screen> {
  app.engine.setKit(await app.kit(app.lessonKitId()));

  const body = h('div', { class: 'calib-body' });
  const el = h('div', { class: 'calib' }, h('h1', null, 'Калибровка'), body);

  let phase: Phase | null = null;
  let t0 = 0; // время AudioContext первой доли
  let timer: number | undefined;
  let raf = 0;
  let nextBeat = 0;
  let taps = new Map<number, number>(); // доля → отклонение, мс
  let audioResult: Measure | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let dots: HTMLElement | null = null;
  let flashUntil = 0;

  const stopRun = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    cancelAnimationFrame(raf);
    phase = null;
  };

  function intro(): void {
    stopRun();
    clear(body);
    const o = app.offsets;
    body.append(
      h('p', null,
        'Браузер не знает точно, сколько времени звук идёт до твоих ушей и картинка — до глаз. ',
        'Калибровка измеряет это на твоей системе, чтобы оценка «рано/поздно» была честной.'),
      h('ol', null,
        h('li', null, h('b', null, 'Звук. '), 'Играет метроном. Бей по любому пэду ровно в щелчок — ', String(LEAD), ' щелчка вступления, затем ', String(MEASURED), ' измеряемых.'),
        h('li', null, h('b', null, 'Экран. '), 'Звука нет. Бей в момент, когда метка пересекает белую линию.')),
      h('p', { class: 'hint' },
        'Делай это в тех же наушниках/колонках, в которых будешь заниматься. Bluetooth-наушники дают 100–300 мс задержки — с ними играть на пэдах нельзя, только провод.'),
      h('p', null, 'Сейчас: звук ', h('b', null, fmtMs(o.audioMs)), ', экран ', h('b', null, fmtMs(o.visualMs)),
        o.calibrated ? '' : ' (ещё не откалибровано)'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run('audio') }, 'Начать'),
        h('button', { class: 'btn', type: 'button', onclick: () => app.open('settings') }, 'Ввести вручную'),
      ),
    );
  }

  function run(p: Phase): void {
    stopRun();
    clear(body);
    phase = p;
    taps = new Map();
    nextBeat = 0;
    app.clock.sample();
    t0 = app.engine.ctx.currentTime + 0.6;
    dots = h('div', { class: 'dots' });
    for (let i = 0; i < MEASURED; i++) dots.append(h('span', { class: 'dot' }));
    canvas = h('canvas', { class: 'calib-canvas', width: 900, height: 140 });
    body.append(
      h('h2', null, p === 'audio' ? 'Шаг 1 из 2 · звук' : 'Шаг 2 из 2 · экран'),
      h('p', null, p === 'audio'
        ? 'Слушай щелчок и бей по пэду точно в него. На экран не смотри.'
        : 'Звука нет. Бей по пэду, когда метка доезжает до белой линии.'),
      canvas,
      dots,
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: intro }, 'Отмена')),
    );
    if (p === 'audio') {
      const tick = () => {
        while (t0 + nextBeat * BEAT < app.engine.ctx.currentTime + 0.12 && nextBeat < LEAD + MEASURED) {
          app.engine.click(t0 + nextBeat * BEAT, nextBeat % 4 === 0);
          nextBeat++;
        }
      };
      tick();
      timer = window.setInterval(tick, 25);
    }
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = app.clock.now() - t0; // сырое слышимое время, без поправок
      draw(t, p);
      if (t > (LEAD + MEASURED) * BEAT + 0.3) done(p);
    };
    frame();
  }

  function draw(t: number, p: Phase): void {
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#15171d';
    g.fillRect(0, 0, W, H);
    const hitX = W * 0.3;
    const now = performance.now();
    if (p === 'visual') {
      const pxPerSec = (W - hitX) / (3 * BEAT);
      for (let k = 0; k < LEAD + MEASURED; k++) {
        const x = hitX + (k * BEAT - t) * pxPerSec;
        if (x < 20 || x > W + 20) continue;
        g.fillStyle = k < LEAD ? '#5b6272' : '#3cd6ff';
        g.beginPath();
        g.roundRect(x - 7, H / 2 - 34, 14, 68, 4);
        g.fill();
      }
    } else {
      const beat = Math.floor(t / BEAT);
      g.fillStyle = '#7c8494';
      g.font = '600 15px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(
        beat < 0 ? 'приготовься…' : beat < LEAD ? `вступление ${beat + 1} / ${LEAD}` : `удар ${Math.min(MEASURED, beat - LEAD + 1)} / ${MEASURED}`,
        W * 0.65, H / 2,
      );
    }
    g.fillStyle = now < flashUntil ? '#7dffb0' : '#ffffff';
    g.fillRect(hitX - 1.5, 10, 3, H - 20);
  }

  function done(p: Phase): void {
    stopRun();
    const deltas = [...taps.values()];
    clear(body);
    if (deltas.length < MIN_TAPS) {
      body.append(
        h('p', { class: 'error' }, `Засчитано ударов: ${deltas.length} из ${MEASURED}. Нужно хотя бы ${MIN_TAPS} — попробуй ещё раз.`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(p) }, 'Повторить'),
          h('button', { class: 'btn', type: 'button', onclick: intro }, 'Назад')),
      );
      return;
    }
    const m = summarize(deltas);
    const quality =
      m.sdMs < 12 ? 'Разброс маленький — результату можно доверять.'
        : m.sdMs < 22 ? 'Разброс приемлемый.'
          : 'Разброс большой — удары были неровные. Лучше повторить.';
    const hist = h('canvas', { class: 'hist', width: 520, height: 120 });
    const center = m.medianMs;
    drawHistogram(hist, m.taps.map((d) => d - center), 60, 5);

    if (p === 'audio') {
      audioResult = m;
      body.append(
        h('h2', null, 'Звук: ', fmtMs(m.medianMs, 1)),
        h('p', null, `Твои удары приходят в среднем на ${fmtMs(m.medianMs, 1)} относительно щелчка (по ${m.taps.length} ударам, разброс ±${m.sdMs.toFixed(1)} мс). ${quality}`),
        h('p', { class: 'hint' }, 'Гистограмма — удары относительно их собственной середины: чем уже горка, тем надёжнее замер.'),
        hist,
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run('visual') }, 'Принять → шаг 2'),
          h('button', { class: 'btn', type: 'button', onclick: () => run('audio') }, 'Повторить'),
          h('button', {
            class: 'btn', type: 'button',
            onclick: () => {
              setOffsets(app.settings, { audioMs: round1(m.medianMs), visualMs: app.offsets.visualMs, calibrated: true });
              intro();
            },
          }, 'Сохранить только звук'),
        ),
      );
    } else {
      const audioMs = audioResult ? audioResult.medianMs : app.offsets.audioMs;
      const visualMs = Math.max(-80, Math.min(250, m.medianMs - audioMs));
      body.append(
        h('h2', null, 'Экран: ', fmtMs(visualMs, 1)),
        h('p', null, `По картинке удары приходят на ${fmtMs(m.medianMs, 1)}, по звуку — на ${fmtMs(audioMs, 1)}. Разница ${fmtMs(visualMs, 1)} — на столько ноты будут рисоваться раньше, чтобы картинка совпадала со звуком. ${quality}`),
        hist,
        h('div', { class: 'actions' },
          h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: () => {
              setOffsets(app.settings, { audioMs: round1(audioMs), visualMs: round1(visualMs), calibrated: true });
              app.open('home');
            },
          }, 'Сохранить и к урокам'),
          h('button', { class: 'btn', type: 'button', onclick: () => run('visual') }, 'Повторить'),
        ),
      );
    }
  }

  intro();

  return {
    el,
    silentPads: () => phase === 'visual',
    onPad: (_pad, _vel, ts) => {
      if (!phase) return;
      // Сырое слышимое время удара — без каких-либо поправок.
      const t = app.clock.perfToCtx(ts) - t0;
      const k = Math.round(t / BEAT);
      if (k < LEAD || k >= LEAD + MEASURED || taps.has(k)) return;
      taps.set(k, (t - k * BEAT) * 1000);
      flashUntil = performance.now() + 90;
      dots?.children[k - LEAD]?.classList.add('on');
    },
    destroy: stopRun,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
