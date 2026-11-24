// Web MIDI. Время удара берём из event.timeStamp — это момент прихода сообщения
// в систему в шкале performance.now(), он не зависит от загрузки главного потока.

export type MidiStatus = 'unsupported' | 'denied' | 'none' | 'connected';

export interface MidiEventInfo {
  port: string;
  text: string; // человекочитаемое описание сообщения
  at: number;
}

/**
 * Слушаем сразу все подключённые MIDI-входы: так не нужно угадывать «правильный» порт,
 * а выбор в настройках лишь ограничивает приём одним устройством.
 */
export class MidiInput {
  status: MidiStatus = 'none';
  inputs: MIDIInput[] = [];
  /** id выбранного входа; пусто — принимаем со всех. */
  selectedId = '';
  /** Порты, которые не удалось открыть (обычно заняты другой программой). */
  failed = new Map<string, string>();
  /** Последнее любое MIDI-сообщение — для диагностики. */
  last: MidiEventInfo | null = null;
  messageCount = 0;
  error = '';
  onNote: (note: number, velocity: number, timeStamp: number) => void = () => {};
  onChange: () => void = () => {};
  onActivity: () => void = () => {};
  private access: MIDIAccess | null = null;
  private attached = new Set<MIDIInput>();

  get current(): MIDIInput | null {
    return this.inputs.find((i) => i.id === this.selectedId) ?? this.inputs[0] ?? null;
  }

  async init(preferredId?: string): Promise<void> {
    this.selectedId = preferredId ?? '';
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      this.onChange();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.status = 'denied';
      this.error = String(err);
      this.onChange();
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  /** Повторный запрос доступа (кнопка «Переподключить»). */
  async retry(): Promise<void> {
    for (const i of this.attached) i.onmidimessage = null;
    this.attached.clear();
    this.failed.clear();
    this.access = null;
    await this.init(this.selectedId);
  }

  select(id: string): void {
    this.selectedId = id;
    this.onChange();
  }

  private refresh(): void {
    if (!this.access) return;
    this.inputs = [...this.access.inputs.values()].filter((i) => i.state === 'connected');
    if (this.selectedId && !this.inputs.some((i) => i.id === this.selectedId)) {
      // Сохранённого устройства нет (другой USB-порт, другой id) — не глушим остальные.
      this.selectedId = '';
    }
    for (const i of [...this.attached]) {
      if (!this.inputs.includes(i)) {
        i.onmidimessage = null;
        this.attached.delete(i);
      }
    }
    for (const input of this.inputs) {
      if (this.attached.has(input)) continue;
      this.attached.add(input);
      input.onmidimessage = (e) => this.handle(input, e);
      // Явно открываем порт, чтобы поймать ошибку «устройство занято».
      input.open().then(
        () => {
          if (this.failed.delete(input.id)) this.onChange();
        },
        (err: unknown) => {
          this.failed.set(input.id, String(err));
          this.onChange();
        },
      );
    }
    this.status = this.inputs.length ? 'connected' : 'none';
    this.onChange();
  }

  private handle(input: MIDIInput, e: MIDIMessageEvent): void {
    const d = e.data;
    if (!d || d.length === 0) return;
    const type = d[0] & 0xf0;
    if (d[0] >= 0xf8) return; // clock / active sensing — шум
    this.messageCount++;
    const ch = (d[0] & 0x0f) + 1;
    const text =
      type === 0x90 && d[2] > 0 ? `нота ${d[1]}, сила ${d[2]}, канал ${ch}`
        : type === 0x80 || type === 0x90 ? `нота ${d[1]} отпущена`
          : type === 0xb0 ? `регулятор CC ${d[1]} = ${d[2]}`
            : type === 0xd0 || type === 0xa0 ? 'давление (aftertouch)'
              : type === 0xc0 ? `смена программы ${d[1]}`
                : `сообщение 0x${d[0].toString(16)}`;
    this.last = { port: input.name ?? input.id, text, at: performance.now() };
    this.onActivity();
    if (this.selectedId && input.id !== this.selectedId) return;
    // Удар — только Note On с ненулевой velocity. Aftertouch, CC, Note Off — не удары.
    if (type === 0x90 && d.length >= 3 && d[2] > 0) this.onNote(d[1], d[2], e.timeStamp);
  }
}

/** Клавиатурный запасной вариант: физические клавиши (не зависят от раскладки). */
export const KEY_TO_PAD: Record<string, number> = {
  KeyZ: 1, KeyX: 2, KeyC: 3, KeyV: 4,
  KeyA: 5, KeyS: 6, KeyD: 7, KeyF: 8,
  KeyQ: 9, KeyW: 10, KeyE: 11, KeyR: 12,
  Digit1: 13, Digit2: 14, Digit3: 15, Digit4: 16,
};

export const PAD_TO_KEY: string[] = ['Z', 'X', 'C', 'V', 'A', 'S', 'D', 'F', 'Q', 'W', 'E', 'R', '1', '2', '3', '4'];
