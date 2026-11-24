// Web MIDI. Время удара берём из event.timeStamp — это момент прихода сообщения
// в систему в шкале performance.now(), он не зависит от загрузки главного потока.

export type MidiStatus = 'unsupported' | 'denied' | 'none' | 'connected';

export class MidiInput {
  status: MidiStatus = 'none';
  inputs: MIDIInput[] = [];
  current: MIDIInput | null = null;
  onNote: (note: number, velocity: number, timeStamp: number) => void = () => {};
  onChange: () => void = () => {};
  private access: MIDIAccess | null = null;
  private preferredId: string | undefined;

  async init(preferredId?: string): Promise<void> {
    this.preferredId = preferredId;
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      this.onChange();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.status = 'denied';
      this.onChange();
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  private refresh(): void {
    if (!this.access) return;
    this.inputs = [...this.access.inputs.values()].filter((i) => i.state === 'connected');
    const keep = this.current && this.inputs.find((i) => i.id === this.current!.id);
    const pick =
      keep ??
      this.inputs.find((i) => i.id === this.preferredId) ??
      this.inputs.find((i) => /mpd\s*218/i.test(i.name ?? '')) ??
      this.inputs.find((i) => /mpd|akai/i.test(i.name ?? '')) ??
      this.inputs[0] ??
      null;
    this.attach(pick);
  }

  select(id: string): void {
    this.preferredId = id;
    this.attach(this.inputs.find((i) => i.id === id) ?? null);
  }

  private attach(input: MIDIInput | null): void {
    if (this.current && this.current !== input) this.current.onmidimessage = null;
    this.current = input;
    if (input) {
      input.onmidimessage = (e) => {
        const d = e.data;
        if (!d || d.length < 3) return;
        // Только Note On с ненулевой velocity. Aftertouch, CC, Note Off — не удары.
        if ((d[0] & 0xf0) === 0x90 && d[2] > 0) this.onNote(d[1], d[2], e.timeStamp);
      };
    }
    this.status = input ? 'connected' : 'none';
    this.onChange();
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
