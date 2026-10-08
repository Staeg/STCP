/** Tiny generated cues (no audio assets). */
let ctx: AudioContext | null = null;

export function beep(kind: 'tier' | 'alarm') {
  try {
    ctx ??= new AudioContext();
    const notes = kind === 'alarm' ? [440, 330, 440, 330] : [196, 147];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'square';
      o.frequency.value = f;
      const t = ctx!.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
  } catch {
    // Audio unavailable (autoplay policy etc.) — cues are optional.
  }
}
