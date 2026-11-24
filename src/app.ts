import { AudioClock } from './audio/clock';
import { AudioEngine, type LoadedKit } from './audio/engine';
import {
  applyOverrides,
  buildSliceKit,
  loadBuiltinKit,
  loadKitIndex,
  loadPool,
  type KitIndexEntry,
  type SamplePool,
} from './audio/kit';
import { markersToSlices } from './audio/slicer';
import { KEY_TO_PAD, MidiInput } from './midi/input';
import { listStoredKits, type StoredKit } from './storage/kits';
import {
  getOffsets,
  loadProgress,
  loadSettings,
  saveSettings,
  type Offsets,
  type Progress,
  type Settings,
} from './storage/settings';
import { clear, h } from './util/dom';

export interface Screen {
  el: HTMLElement;
  /** Удар по пэду (MIDI, клавиатура или мышь). */
  onPad?: (pad: number, velocity: number, timeStamp: number) => void;
  /** true — пэды на этом экране не звучат (например, калибровка экрана). */
  silentPads?: () => boolean;
  destroy?: () => void;
}

export type ScreenFactory = () => Screen | Promise<Screen>;

export interface NavItem {
  id: string;
  label: string;
  open: ScreenFactory;
}

export class App {
  engine = new AudioEngine();
  clock!: AudioClock;
  midi = new MidiInput();
  settings: Settings = loadSettings();
  progress: Progress = loadProgress();
  userKits: StoredKit[] = [];
  /** Перехват сырых MIDI-нот (обучение пэдов). */
  rawNoteHook: ((note: number, velocity: number) => void) | null = null;
  lastNote: { note: number; velocity: number } | null = null;
  /** Экран настроек подписывается на смену MIDI-устройств. */
  onMidiChange: (() => void) | null = null;
  /** Текущая сессия урока — только для отладки и автопроверок из консоли. */
  debugSession: unknown = null;
  /** Любое MIDI-сообщение (монитор в настройках). */
  onMidiActivity: (() => void) | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | undefined;

  /** Доступные встроенные киты и пул сэмплов для замены звуков (null — пул не скачан). */
  kitIndex: KitIndexEntry[] = [];
  pool: SamplePool | null = null;

  private kits = new Map<string, LoadedKit>(); // с применёнными заменами звуков
  private baseKits = new Map<string, LoadedKit>(); // как в манифесте
  private screen: Screen | null = null;
  private main = h('main', { class: 'main' });
  private nav = h('nav', { class: 'nav' });
  private midiPill = h('button', { class: 'pill', type: 'button' });
  private navItems: NavItem[] = [];
  private navId = '';

  mount(root: HTMLElement, navItems: NavItem[], onStart: () => void): void {
    this.navItems = navItems;
    const header = h(
      'header',
      { class: 'header' },
      h('div', { class: 'logo' }, 'PAD', h('b', null, 'WORK')),
      this.nav,
      this.midiPill,
    );
    root.append(header, this.main);
    this.midiPill.addEventListener('click', () => this.open('settings'));
    this.renderNav();
    this.renderMidi();

    // AudioContext и MIDI можно запускать только по действию пользователя.
    const gate = h(
      'div',
      { class: 'gate' },
      h('h1', null, 'Тренажёр фингердрамминга'),
      h('p', null, 'Drum & bass, jungle, amen break. Подключи MPD218 по USB и нажми кнопку — браузер спросит разрешение на MIDI.'),
      h(
        'button',
        {
          class: 'btn btn-primary btn-big',
          type: 'button',
          onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            b.textContent = 'Загружаю сэмплы…';
            try {
              await this.boot();
              onStart();
            } catch (err) {
              b.disabled = false;
              b.textContent = 'Попробовать ещё раз';
              gate.append(h('p', { class: 'error' }, String(err)));
            }
          },
        },
        'Начать',
      ),
    );
    this.main.append(gate);
  }

  private async boot(): Promise<void> {
    this.engine.init(this.settings.masterVol, this.settings.clickVol);
    await this.engine.resume();
    if (this.settings.sinkId) {
      try {
        await this.engine.setSink(this.settings.sinkId);
      } catch {
        this.settings.sinkId = '';
      }
    }
    this.clock = new AudioClock(this.engine.ctx);
    window.setInterval(() => this.clock.sample(), 50);

    this.midi.onChange = () => {
      this.renderMidi();
      this.onMidiChange?.();
    };
    this.midi.onNote = (note, velocity, ts) => {
      this.lastNote = { note, velocity };
      if (this.rawNoteHook) {
        this.rawNoteHook(note, velocity);
        return;
      }
      const idx = this.settings.padNotes.indexOf(note);
      if (idx >= 0) this.pad(idx + 1, velocity, ts);
      else {
        // Сигнал пришёл, но нота не назначена ни одному пэду — говорим об этом прямо, а не молчим.
        this.toast(
          `Контроллер прислал ноту ${note}, но она не назначена ни одному пэду (ждём ${this.settings.padNotes[0]}–${this.settings.padNotes[15]}).`,
          'Обучить пэды',
          () => this.open('settings'),
        );
      }
    };
    let pillTimer: number | undefined;
    this.midi.onActivity = () => {
      this.onMidiActivity?.();
      if (pillTimer === undefined) {
        pillTimer = window.setTimeout(() => {
          pillTimer = undefined;
          this.renderMidi();
        }, 120);
      }
    };
    // MIDI не блокирует запуск: без контроллера работает клавиатура.
    void this.midi.init(this.settings.midiInputId);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const pad = KEY_TO_PAD[e.code];
      if (pad) {
        e.preventDefault();
        this.pad(pad, e.shiftKey ? 42 : 100, e.timeStamp);
      }
    });

    const [index, pool] = await Promise.all([loadKitIndex(), loadPool()]);
    this.pool = pool;
    // Киты, которым нужны нескачанные сэмплы, в списках не показываем.
    this.kitIndex = index.filter((k) => !k.requires || (k.requires === 'sampleradar' && pool !== null));
    this.userKits = await listStoredKits();
    const [first] = await Promise.all([this.kit(this.lessonKitId()), this.kit('amen')]);
    this.engine.setKit(first);
  }

  /** Кит для уроков на one-shot звуках: выбранный пользователем, иначе первый доступный. */
  lessonKitId(): string {
    const ids = this.kitChoices('oneshot').map((k) => k.id);
    return ids.includes(this.settings.lessonKit) ? this.settings.lessonKit : (ids[0] ?? 'dnb');
  }

  /** Кит со слайсами для уроков чопа. */
  sliceKitId(): string {
    const ids = this.kitChoices('slices').map((k) => k.id);
    return ids.includes(this.settings.sliceKit) ? this.settings.sliceKit : 'amen';
  }

  /** Заменить звук кита сэмплом из пула (file = null — вернуть родной звук кита). */
  setSoundOverride(kitId: string, sound: string, file: string | null): void {
    const o = (this.settings.soundOverrides[kitId] ??= {});
    if (file) o[sound] = file;
    else delete o[sound];
    this.save();
    this.kits.delete(kitId);
  }

  /** Центральная точка ввода: сначала звук (минимум задержки), потом логика экрана. */
  pad(pad: number, velocity: number, timeStamp: number): void {
    // Chrome может усыпить AudioContext (долгий простой, смена устройства) — будим его ударом.
    if (this.engine.ctx.state !== 'running') void this.engine.resume();
    if (!this.screen?.silentPads?.()) this.engine.trigger(pad, velocity);
    this.screen?.onPad?.(pad, velocity, timeStamp);
  }

  async kit(id: string): Promise<LoadedKit> {
    const cached = this.kits.get(id);
    if (cached) return cached;
    let kit: LoadedKit;
    if (id.startsWith('user:')) {
      const stored = this.userKits.find((k) => k.id === id) ?? (await listStoredKits()).find((k) => k.id === id);
      if (!stored) throw new Error('Кит не найден: ' + id);
      const buffer = await this.engine.decode(stored.file.slice(0));
      const scale = buffer.sampleRate / stored.sampleRate;
      const slices = markersToSlices(stored.markers.map((m) => m * scale), buffer.length);
      kit = buildSliceKit(this.engine, stored.id, stored.name, buffer, slices);
    } else {
      let base = this.baseKits.get(id);
      if (!base) {
        base = await loadBuiltinKit(this.engine, id);
        this.baseKits.set(id, base);
      }
      kit = await applyOverrides(this.engine, base, this.settings.soundOverrides[id], this.pool);
    }
    this.kits.set(id, kit);
    return kit;
  }

  forgetKit(id: string): void {
    this.kits.delete(id);
    this.baseKits.delete(id);
  }

  /** Список китов для выбора: встроенные + пользовательские (нарезанные брейки). */
  kitChoices(kind?: 'oneshot' | 'slices'): { id: string; name: string }[] {
    const out = this.kitIndex.filter((k) => !kind || k.kind === kind).map((k) => ({ id: k.id, name: k.name }));
    if (kind !== 'oneshot') for (const k of this.userKits) out.push({ id: k.id, name: k.name });
    return out;
  }

  async refreshUserKits(): Promise<void> {
    this.userKits = await listStoredKits();
  }

  get offsets(): Offsets {
    return getOffsets(this.settings);
  }

  save(): void {
    saveSettings(this.settings);
  }

  open(id: string): void {
    const item = this.navItems.find((n) => n.id === id);
    if (item) {
      this.navId = id;
      void this.go(item.open);
    }
  }

  async go(factory: ScreenFactory): Promise<void> {
    if (!this.engine.ready) return;
    this.screen?.destroy?.();
    this.screen = null;
    clear(this.main);
    this.renderNav();
    try {
      const s = await factory();
      this.screen = s;
      clear(this.main);
      this.main.append(s.el);
    } catch (err) {
      this.main.append(h('p', { class: 'error' }, 'Ошибка: ' + String(err)));
    }
  }

  private renderNav(): void {
    clear(this.nav);
    for (const item of this.navItems) {
      this.nav.append(
        h(
          'button',
          {
            class: 'nav-item' + (item.id === this.navId ? ' active' : ''),
            type: 'button',
            onclick: () => this.open(item.id),
          },
          item.label,
        ),
      );
    }
  }

  /** Всплывающая подсказка внизу экрана с необязательной кнопкой действия. */
  toast(text: string, actionLabel?: string, action?: () => void): void {
    this.toastEl?.remove();
    const el = h(
      'div',
      { class: 'toast' },
      h('span', null, text),
      actionLabel && action
        ? h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: () => {
              el.remove();
              action();
            },
          }, actionLabel)
        : null,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => el.remove() }, '✕'),
    );
    document.body.append(el);
    this.toastEl = el;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 12000);
  }

  private renderMidi(): void {
    const m = this.midi;
    const names = m.inputs.map((i) => i.name ?? 'MIDI').join(', ');
    const busy = m.inputs.length > 0 && m.inputs.every((i) => m.failed.has(i.id));
    const fresh = m.last && performance.now() - m.last.at < 1500 ? ' · ' + m.last.text : '';
    const text =
      busy
        ? '⚠ ' + names + ': порт занят'
        : m.status === 'connected'
        ? '● ' + names + fresh
        : m.status === 'unsupported'
          ? 'MIDI не поддерживается'
          : m.status === 'denied'
            ? 'MIDI: нет разрешения'
            : '○ контроллер не найден';
    this.midiPill.textContent = text;
    this.midiPill.className = 'pill ' + (m.status === 'connected' && !busy ? 'pill-ok' : 'pill-warn');
    if (fresh) window.setTimeout(() => this.renderMidi(), 1600);
  }
}

export const app = new App();

if (import.meta.env.DEV) (window as unknown as { padwork: App }).padwork = app;
