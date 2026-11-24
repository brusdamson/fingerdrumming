import { app, type Screen } from '../app';
import { defaultPadNotes, saveProgress, setOffsets } from '../storage/settings';
import { clear, h } from '../util/dom';
import { PadGrid } from './padGrid';

export async function settingsScreen(): Promise<Screen> {
  const kit = await app.kit(app.lessonKitId());
  app.engine.setKit(kit);
  const el = h('div', { class: 'settings' }, h('h1', null, 'Настройки'));

  // ───────── MIDI ─────────
  const midiBox = h('div', { class: 'card' });
  const padGrid = new PadGrid((pad, vel, ts) => app.pad(pad, vel, ts), true);
  padGrid.setKit(kit);
  let learnIdx: number | null = null;
  let learned: number[] = [];
  const learnInfo = h('div', { class: 'status' });

  const stopLearn = () => {
    learnIdx = null;
    app.rawNoteHook = null;
    padGrid.mark(null);
  };

  const startLearn = () => {
    learnIdx = 0;
    learned = [];
    padGrid.mark(1);
    learnInfo.textContent = 'Ударь по пэду 1 (левый нижний), затем по порядку слева направо, снизу вверх.';
    app.rawNoteHook = (note) => {
      if (learnIdx === null) return;
      if (learned.includes(note)) {
        learnInfo.textContent = `Нота ${note} уже назначена — ударь по пэду ${learnIdx + 1}.`;
        return;
      }
      learned.push(note);
      learnIdx++;
      if (learnIdx >= 16) {
        app.settings.padNotes = learned;
        app.save();
        stopLearn();
        learnInfo.textContent = 'Готово, раскладка сохранена: ' + learned.join(', ');
        renderMidi();
      } else {
        padGrid.mark(learnIdx + 1);
        learnInfo.textContent = `Принято (нота ${note}). Теперь пэд ${learnIdx + 1}.`;
      }
    };
  };

  // Монитор: видно, доходит ли вообще сигнал от контроллера и какие ноты он шлёт.
  const monitor = h('p', { class: 'monitor' });
  const renderMonitor = () => {
    const l = app.midi.last;
    monitor.textContent = l
      ? `Монитор: ${l.port} → ${l.text} (всего сообщений: ${app.midi.messageCount})`
      : 'Монитор: сообщений от контроллера пока не было. Ударь по пэду — здесь должна появиться нота.';
    monitor.classList.toggle('live', !!l);
  };
  renderMonitor();
  app.onMidiActivity = renderMonitor;

  function renderMidi(): void {
    clear(midiBox);
    const m = app.midi;
    const statusText =
      m.status === 'unsupported' ? 'Этот браузер не поддерживает Web MIDI — нужен Chrome.'
        : m.status === 'denied' ? 'Доступ к MIDI запрещён. Разреши его в настройках сайта (значок слева от адреса) и перезагрузи страницу.'
          : m.status === 'none' ? 'Контроллер не найден. Подключи MPD218 по USB — он появится сам.'
            : 'Найдено: ' + m.inputs.map((i) => i.name ?? i.id).join(', ') + '. Сигнал принимается со всех входов, если не выбран один.';
    const busy = m.inputs.filter((i) => m.failed.has(i.id));
    const parts: (Node | null)[] = [
      h('h2', null, 'MIDI-контроллер'),
      h('p', null, statusText),
      busy.length
        ? h('p', { class: 'error' }, 'Не удалось открыть: ', busy.map((i) => i.name ?? i.id).join(', '),
            '. В Windows MIDI-порт может держать только одна программа — закрой DAW (Ableton, FL Studio), MPD218 Editor и другие вкладки с MIDI, затем нажми «Переподключить».')
        : null,
      monitor,
      m.inputs.length
        ? h('div', { class: 'controls' },
            h('span', { class: 'label' }, 'Вход'),
            h('select', {
              class: 'input',
              onchange: (e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                app.midi.select(id);
                app.settings.midiInputId = id;
                app.save();
              },
            }, h('option', { value: '', selected: !m.selectedId }, 'Все входы'),
              m.inputs.map((i) => h('option', { value: i.id, selected: i.id === m.selectedId }, i.name ?? i.id))),
            h('button', { class: 'btn', type: 'button', onclick: () => void app.midi.retry() }, 'Переподключить'))
        : h('div', { class: 'controls' },
            h('button', { class: 'btn', type: 'button', onclick: () => void app.midi.retry() }, 'Переподключить')),
      h('p', { class: 'hint' }, 'Ноты пэдов 1–16: ', app.settings.padNotes.join(', '),
        '. По умолчанию — 36–51 (банк A заводского пресета MPD218). Если пэды звучат не на своих местах или молчат — обучи раскладку.'),
      h('div', { class: 'controls' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: startLearn }, 'Обучить пэды'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            stopLearn();
            app.settings.padNotes = defaultPadNotes();
            app.save();
            learnInfo.textContent = 'Раскладка сброшена на 36–51.';
            renderMidi();
          },
        }, 'Сбросить на 36–51')),
      padGrid.el,
      learnInfo,
      h('p', { class: 'hint' }, 'На MPD218 выключи Note Repeat и Full Level: повторы контроллер шлёт сам, и оценивать по ним твой тайминг бессмысленно.'),
    ];
    midiBox.append(...parts.filter((n): n is Node => n !== null));
  }
  app.onMidiChange = renderMidi;
  renderMidi();

  // ───────── Звук ─────────
  const lat = h('div', { class: 'status' });
  const renderLat = () => {
    const i = app.engine.latencyInfo();
    lat.textContent =
      `Буфер браузера: ${i.baseMs.toFixed(1)} мс · задержка вывода (по данным системы): ${i.outputMs.toFixed(1)} мс · ` +
      `${i.sampleRate} Гц · часы: ${app.clock.mode === 'output-timestamp' ? 'точные (output timestamp)' : 'приближённые (currentTime)'} · ` +
      `таймеры высокой точности: ${window.crossOriginIsolated ? 'да' : 'нет'}`;
  };
  renderLat();
  const latTimer = window.setInterval(renderLat, 1000);

  const slider = (label: string, value: number, fn: (v: number) => void) =>
    h('label', { class: 'slider' }, h('span', { class: 'label' }, label),
      h('input', {
        type: 'range', min: 0, max: 1, step: 0.01, value,
        oninput: (e: Event) => fn(Number((e.target as HTMLInputElement).value)),
      }));

  const sinkSelect = h('select', { class: 'input', hidden: true });
  const sinkBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      try {
        // Названия устройств браузер отдаёт только после разрешения на микрофон; сам микрофон не используется.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        clear(sinkSelect);
        sinkSelect.append(h('option', { value: '' }, 'Системное по умолчанию'));
        for (const d of outs) {
          if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
          sinkSelect.append(h('option', { value: d.deviceId, selected: d.deviceId === app.settings.sinkId }, d.label || d.deviceId));
        }
        sinkSelect.hidden = false;
        sinkBtn.hidden = true;
      } catch {
        sinkBtn.textContent = 'Нет доступа к списку устройств';
      }
    },
  }, 'Выбрать устройство вывода…');
  sinkSelect.addEventListener('change', async () => {
    try {
      await app.engine.setSink(sinkSelect.value);
      app.settings.sinkId = sinkSelect.value;
      app.save();
      app.clock.reset();
      renderOffsets();
    } catch {
      sinkSelect.value = app.settings.sinkId;
    }
  });

  el.append(
    midiBox,
    h('div', { class: 'card' },
      h('h2', null, 'Звук и задержка'),
      slider('Громкость пэдов', app.settings.masterVol, (v) => {
        app.settings.masterVol = v;
        app.engine.setMasterVolume(v);
        app.save();
      }),
      slider('Громкость метронома', app.settings.clickVol, (v) => {
        app.settings.clickVol = v;
        app.engine.setClickVolume(v);
        app.save();
      }),
      h('div', { class: 'controls' }, sinkBtn, sinkSelect),
      lat,
      h('ul', { class: 'hint' },
        h('li', null, 'Только проводные наушники или колонки. Bluetooth добавляет 100–300 мс — играть невозможно.'),
        h('li', null, 'Windows: Параметры → Звук → устройство → отключи «Улучшения звука» и пространственный звук — они добавляют задержку.'),
        h('li', null, 'Закрой тяжёлые вкладки и программы: щелчки и заикания звука — это нехватка времени у аудиопотока.'),
        h('li', null, 'Chrome на Windows выводит звук через общий режим WASAPI: 10–30 мс — нормальная цифра. Меньше даёт только внешняя звуковая карта с хорошим драйвером.')),
    ),
  );

  // ───────── Смещения ─────────
  const offBox = h('div', { class: 'card' });
  function renderOffsets(): void {
    clear(offBox);
    const o = app.offsets;
    const num = (label: string, value: number, key: 'audioMs' | 'visualMs') =>
      h('label', { class: 'slider' }, h('span', { class: 'label' }, label),
        h('input', {
          class: 'input num', type: 'number', step: 1, min: -200, max: 400, value,
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) setOffsets(app.settings, { ...app.offsets, [key]: v, calibrated: true });
          },
        }), h('span', { class: 'label' }, 'мс'));
    offBox.append(
      h('h2', null, 'Калибровка'),
      h('p', null, o.calibrated ? 'Смещения для текущего устройства вывода:' : 'Ещё не откалибровано — оценка может быть сдвинута.'),
      num('Звук (сдвиг ударов)', o.audioMs, 'audioMs'),
      num('Экран (опережение картинки)', o.visualMs, 'visualMs'),
      h('p', { class: 'hint' }, 'Если в результатах стабильно «спешишь на N мс» на всех уроках и темпах — уменьши «Звук» на N. Если ноты визуально доезжают до линии позже щелчка — увеличь «Экран».'),
      h('div', { class: 'controls' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => app.open('calibration') }, 'Запустить калибровку')),
    );
  }
  renderOffsets();
  el.append(offBox);

  el.append(
    h('div', { class: 'card' },
      h('h2', null, 'Прогресс'),
      h('div', { class: 'controls' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (b.dataset.sure) {
              app.progress = {};
              saveProgress(app.progress);
              b.textContent = 'Прогресс сброшен';
              b.disabled = true;
            } else {
              b.dataset.sure = '1';
              b.textContent = 'Точно сбросить? Нажми ещё раз';
            }
          },
        }, 'Сбросить прогресс уроков')),
    ),
  );

  return {
    el,
    onPad: (pad) => padGrid.flash(pad),
    destroy: () => {
      stopLearn();
      app.onMidiChange = null;
      app.onMidiActivity = null;
      clearInterval(latTimer);
    },
  };
}
