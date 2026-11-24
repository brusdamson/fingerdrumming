import { app, type Screen } from '../app';
import { buildSliceKit, channelsOf } from '../audio/kit';
import {
  detectOnsets,
  estimateBpm,
  gridMarkers,
  markersToSlices,
  mixToMono,
  snapMarkersToOnsets,
  snapToZero,
} from '../audio/slicer';
import { deleteStoredKit, putStoredKit } from '../storage/kits';
import { clear, h } from '../util/dom';
import { PadGrid } from './padGrid';

type SliceMode = 'transients' | 'grid';

export async function sliceEditorScreen(): Promise<Screen> {
  let file: ArrayBuffer | null = null;
  let fileName = '';
  let buffer: AudioBuffer | null = null;
  let mono: Float32Array | null = null;
  let markers: number[] = [];
  let mode: SliceMode = 'transients';
  let sensitivity = 0.45;
  let gridCount = 16;
  let playing: AudioBufferSourceNode | null = null;
  let drag: number | null = null;

  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts), true);
  padGrid.setKit(null);
  const canvas = h('canvas', { class: 'wave' });
  const info = h('div', { class: 'status' }, 'Перетащи сюда WAV (или MP3/FLAC/OGG) с брейком — или выбери файл.');
  const nameInput = h('input', { class: 'input', type: 'text', placeholder: 'Название кита', maxlength: 40 });
  const editor = h('div', { class: 'slice-editor', hidden: true });
  const savedBox = h('div', { class: 'card' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'audio/*,.wav,.flac,.mp3,.ogg,.aiff,.aif',
    hidden: true,
    onchange: () => {
      const f = fileInput.files?.[0];
      if (f) void loadFile(f);
      fileInput.value = '';
    },
  });

  const drop = h(
    'div',
    {
      class: 'drop',
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        drop.classList.add('over');
      },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        drop.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) void loadFile(f);
      },
      onclick: () => fileInput.click(),
    },
    h('b', null, 'Брось файл с брейком сюда'),
    h('span', null, 'или нажми, чтобы выбрать. Файл никуда не отправляется — всё происходит в браузере.'),
    fileInput,
  );

  async function loadFile(f: File): Promise<void> {
    info.textContent = 'Декодирую…';
    try {
      const data = await f.arrayBuffer();
      const decoded = await app.engine.decode(data.slice(0));
      if (decoded.duration > 60) {
        info.textContent = `Файл длиной ${decoded.duration.toFixed(0)} с — это слишком много для брейка. Нужен луп до минуты.`;
        return;
      }
      file = data;
      fileName = f.name;
      buffer = decoded;
      mono = mixToMono(channelsOf(decoded));
      nameInput.value = f.name.replace(/\.[^.]+$/, '').slice(0, 40);
      editor.hidden = false;
      reslice();
    } catch {
      info.textContent = 'Не получилось прочитать файл как аудио. Попробуй WAV 16/24 бит.';
    }
  }

  function reslice(): void {
    if (!buffer || !mono) return;
    if (mode === 'grid') {
      const onsets = detectOnsets(mono, buffer.sampleRate, 0.8);
      markers = snapMarkersToOnsets(gridMarkers(buffer.length, gridCount), onsets, Math.round(buffer.sampleRate * 0.02));
      markers[0] = 0;
    } else {
      markers = detectOnsets(mono, buffer.sampleRate, sensitivity);
      if (markers.length === 0) markers = [0];
    }
    applyMarkers();
  }

  function applyMarkers(): void {
    if (!buffer) return;
    markers = [...new Set(markers)].sort((a, b) => a - b);
    const slices = markersToSlices(markers, buffer.length);
    const kit = buildSliceKit(app.engine, 'preview', 'Предпросмотр', buffer, slices);
    app.engine.setKit(kit);
    padGrid.setKit(kit);
    const est = estimateBpm(buffer.duration);
    info.textContent =
      `${fileName} · ${buffer.duration.toFixed(2)} с · похоже на ${est.bars} такт(а) в ${est.bpm} BPM · слайсов: ${slices.length}` +
      (slices.length > 16 ? ' (на пэды попадут первые 16)' : '') +
      '. Клик по волне — прослушать слайс, перетаскивание линии — сдвинуть, двойной клик — добавить маркер, правый клик по линии — удалить.';
    drawWave();
  }

  function drawWave(): void {
    const g = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const W = Math.max(300, r.width);
    const H = Math.max(120, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15171d';
    g.fillRect(0, 0, W, H);
    if (!mono || !buffer) return;
    const n = mono.length;
    const slices = markersToSlices(markers, n);
    slices.forEach((s, i) => {
      const x0 = (s.start / n) * W;
      const x1 = (s.end / n) * W;
      g.fillStyle = i >= 16 ? 'rgba(0,0,0,0.35)' : i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)';
      g.fillRect(x0, 0, x1 - x0, H);
    });
    g.fillStyle = '#7dffb0';
    const mid = H / 2;
    for (let px = 0; px < W; px++) {
      const a = Math.floor((px / W) * n);
      const b = Math.max(a + 1, Math.floor(((px + 1) / W) * n));
      let lo = 0;
      let hi = 0;
      for (let i = a; i < b; i++) {
        const v = mono[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      g.fillRect(px, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
    }
    g.font = '600 11px ui-monospace, Consolas, monospace';
    g.textBaseline = 'top';
    slices.forEach((s, i) => {
      const x = (s.start / n) * W;
      g.fillStyle = i >= 16 ? '#5b6272' : '#ffc23c';
      g.fillRect(Math.round(x), 0, 1.5, H);
      g.fillText(String(i + 1), x + 4, 4);
    });
  }

  const posOf = (e: MouseEvent): number => {
    const r = canvas.getBoundingClientRect();
    return Math.round(((e.clientX - r.left) / r.width) * (mono?.length ?? 0));
  };
  const nearMarker = (e: MouseEvent): number | null => {
    if (!mono) return null;
    const r = canvas.getBoundingClientRect();
    let best: number | null = null;
    let bestD = 7;
    markers.forEach((m, i) => {
      const d = Math.abs((m / mono!.length) * r.width - (e.clientX - r.left));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  function playRange(start: number, end: number): void {
    if (!buffer) return;
    try {
      playing?.stop();
    } catch {
      /* уже остановлен */
    }
    const src = app.engine.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(app.engine.master);
    src.start(0, start / buffer.sampleRate, (end - start) / buffer.sampleRate);
    playing = src;
  }

  let moved = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    moved = false;
    const i = nearMarker(e);
    if (i !== null && markers[i] !== 0) {
      drag = i;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    canvas.style.cursor = drag !== null || nearMarker(e) !== null ? 'ew-resize' : 'pointer';
    if (drag === null || !mono) return;
    moved = true;
    markers[drag] = Math.min(mono.length - 32, Math.max(1, posOf(e)));
    drawWave();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag !== null && mono && buffer) {
      if (moved) markers[drag] = snapToZero(mono, markers[drag], Math.round(buffer.sampleRate * 0.002));
      drag = null;
      applyMarkers();
      if (moved) return;
    }
    if (!mono) return;
    const pos = posOf(e);
    const s = markersToSlices(markers, mono.length).find((x) => pos >= x.start && pos < x.end);
    if (s) playRange(s.start, s.end);
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!mono || !buffer) return;
    markers.push(snapToZero(mono, posOf(e), Math.round(buffer.sampleRate * 0.002)));
    applyMarkers();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = nearMarker(e);
    if (i !== null && markers[i] !== 0) {
      markers.splice(i, 1);
      applyMarkers();
    }
  });

  const sensRow = h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Чувствительность'),
    h('input', {
      type: 'range', min: 0, max: 1, step: 0.02, value: sensitivity,
      oninput: (e: Event) => {
        sensitivity = Number((e.target as HTMLInputElement).value);
        reslice();
      },
    }));
  const gridRow = h('label', { class: 'slider', hidden: true }, h('span', { class: 'label' }, 'Слайсов'),
    h('select', {
      class: 'input',
      onchange: (e: Event) => {
        gridCount = Number((e.target as HTMLSelectElement).value);
        reslice();
      },
    }, [4, 8, 16, 32].map((n) => h('option', { value: n, selected: n === gridCount }, n))));

  const modeBtn = (m: SliceMode, label: string) =>
    h('button', {
      class: 'chip' + (mode === m ? ' active' : ''), type: 'button', 'data-mode': m,
      onclick: () => {
        mode = m;
        modeRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.getAttribute('data-mode') === m));
        sensRow.hidden = m !== 'transients';
        gridRow.hidden = m !== 'grid';
        reslice();
      },
    }, label);
  const modeRow = h('div', { class: 'tempo-row' }, modeBtn('transients', 'По транзиентам'), modeBtn('grid', 'Равная сетка'));

  editor.append(
    h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Нарезка'), modeRow, sensRow, gridRow,
      h('button', { class: 'btn', type: 'button', onclick: () => buffer && playRange(0, buffer.length) }, '▶ Целиком'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          try {
            playing?.stop();
          } catch {
            /* уже остановлен */
          }
        },
      }, '■')),
    canvas,
    h('div', { class: 'under' },
      h('div', { class: 'hud-col' },
        h('p', { class: 'hint' }, 'Слайсы уже лежат на пэдах 1–16 по порядку — можно сразу играть на MPD218. Каждый новый удар обрывает предыдущий слайс, как в классическом чопе.'),
        h('div', { class: 'controls' }, nameInput,
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void save() }, 'Сохранить кит'))),
      padGrid.el),
  );

  async function save(): Promise<void> {
    if (!file || !buffer) return;
    const slices = markersToSlices(markers, buffer.length);
    if (slices.length < 2) {
      info.textContent = 'Нужно хотя бы два слайса.';
      return;
    }
    const id = 'user:' + Date.now().toString(36);
    await putStoredKit({
      id,
      name: nameInput.value.trim() || 'Мой брейк',
      file,
      markers: slices.map((s) => s.start),
      sampleRate: buffer.sampleRate,
      created: Date.now(),
    });
    await app.refreshUserKits();
    app.settings.freeKit = id;
    if (slices.length >= 8) app.settings.sliceKit = id;
    app.save();
    info.textContent =
      'Сохранено. Кит доступен в «Свободной игре»' + (slices.length >= 8 ? ' и выбран для уроков чопа.' : '. Для уроков чопа нужно минимум 8 слайсов.');
    renderSaved();
  }

  function renderSaved(): void {
    clear(savedBox);
    savedBox.append(h('h2', null, 'Сохранённые киты'));
    if (!app.userKits.length) {
      savedBox.append(h('p', { class: 'hint' }, 'Пока пусто.'));
      return;
    }
    for (const k of app.userKits) {
      savedBox.append(
        h('div', { class: 'saved-row' },
          h('span', null, k.name, h('span', { class: 'label' }, ` · слайсов: ${k.markers.length}`)),
          h('button', {
            class: 'btn btn-ghost', type: 'button',
            onclick: async () => {
              await deleteStoredKit(k.id);
              app.forgetKit(k.id);
              if (app.settings.freeKit === k.id) app.settings.freeKit = 'dnb';
              if (app.settings.sliceKit === k.id) app.settings.sliceKit = 'amen';
              app.save();
              await app.refreshUserKits();
              renderSaved();
            },
          }, 'Удалить')),
      );
    }
  }
  renderSaved();

  const onResize = () => drawWave();
  window.addEventListener('resize', onResize);

  const el = h('div', { class: 'slicer' }, h('h1', null, 'Мой брейк'), drop, info, editor, savedBox);
  return {
    el,
    onPad: (pad) => padGrid.flash(pad),
    destroy: () => {
      window.removeEventListener('resize', onResize);
      try {
        playing?.stop();
      } catch {
        /* уже остановлен */
      }
    },
  };
}
