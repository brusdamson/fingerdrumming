const KEY = 'padwork.settings.v1';
const PROGRESS_KEY = 'padwork.progress.v1';

export interface Offsets {
  audioMs: number; // сдвиг ударов относительно клика (калибровка звука)
  visualMs: number; // опережение отрисовки (калибровка экрана)
  calibrated: boolean;
}

export interface Settings {
  midiInputId?: string;
  /** MIDI-ноты пэдов 1..16. По умолчанию — банк A MPD218 (36–51). */
  padNotes: number[];
  masterVol: number;
  clickVol: number;
  metronome: boolean;
  sinkId: string;
  offsets: Record<string, Offsets>;
  freeKit: string;
  sliceKit: string;
  /** Кит для уроков на one-shot звуках; пусто — первый доступный. */
  lessonKit: string;
  /** Замены звуков: кит → звук → файл из пула сэмплов. */
  soundOverrides: Record<string, Record<string, string>>;
  /** Свободная игра: кит → номер пэда → файл из пула сэмплов. */
  padOverrides: Record<string, Record<string, string>>;
  /** Подыгрыш (id стиля из audio/backing.ts); пусто — выключен. */
  backing: string;
  backingVol: number;
}

export function defaultPadNotes(): number[] {
  return Array.from({ length: 16 }, (_, i) => 36 + i);
}

function defaults(): Settings {
  return {
    padNotes: defaultPadNotes(),
    masterVol: 0.9,
    clickVol: 0.6,
    metronome: true,
    sinkId: '',
    offsets: {},
    freeKit: '',
    sliceKit: 'amen',
    lessonKit: '',
    soundOverrides: {},
    padOverrides: {},
    backing: '',
    backingVol: 0.6,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* повреждённые настройки — берём значения по умолчанию */
  }
  return defaults();
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* хранилище недоступно */
  }
}

export function getOffsets(s: Settings): Offsets {
  return s.offsets[s.sinkId || 'default'] ?? { audioMs: 0, visualMs: 0, calibrated: false };
}

export function setOffsets(s: Settings, o: Offsets): void {
  s.offsets[s.sinkId || 'default'] = o;
  saveSettings(s);
}

/** Прогресс: урок → темп → лучшая точность в зачёте. */
export type Progress = Record<string, Record<string, number>>;

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return JSON.parse(raw) as Progress;
  } catch {
    /* пусто */
  }
  return {};
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* хранилище недоступно */
  }
}
