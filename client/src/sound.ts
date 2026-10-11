import type { SoundCue } from '@stcp/shared';

/** Tiny generated cues (no audio assets). */
let ctx: AudioContext | null = null;

/** One note: `freq` Hz (gliding to `to` if given), starting `at` seconds from now, fading out over `len`. */
function tone(freq: number, at: number, len: number, opts: { type?: OscillatorType; vol?: number; to?: number } = {}) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = opts.type ?? 'square';
  const t = ctx!.currentTime + at;
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.06, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ctx!.destination);
  o.start(t);
  o.stop(t + len + 0.01);
}

export function beep(kind: 'escalate' | 'alarm' | SoundCue) {
  try {
    ctx ??= new AudioContext();
    switch (kind) {
      case 'alarm':
        [440, 330, 440, 330].forEach((f, i) => tone(f, i * 0.18, 0.16));
        break;
      case 'escalate':
        [196, 147].forEach((f, i) => tone(f, i * 0.18, 0.16));
        break;
      case 'toll':
        // A bell: a low strike with a few inharmonic partials ringing out.
        for (const [f, v] of [[110, 0.09], [221, 0.05], [297, 0.03], [440, 0.02]] as const) tone(f, 0, 2.2, { type: 'sine', vol: v });
        tone(110, 0, 0.08, { vol: 0.04 });
        break;
      case 'call':
        // A cry: two rising whoops.
        tone(330, 0, 0.32, { type: 'sawtooth', vol: 0.04, to: 520 });
        tone(330, 0.38, 0.45, { type: 'sawtooth', vol: 0.04, to: 620 });
        break;
      case 'king':
        // A dirge: three falling low notes over a drone.
        tone(55, 0, 2.4, { type: 'sawtooth', vol: 0.03 });
        [98, 92.5, 73.4].forEach((f, i) => tone(f, i * 0.5, i === 2 ? 1.4 : 0.48, { type: 'square', vol: 0.05 }));
        break;
    }
  } catch {
    // Audio unavailable (autoplay policy etc.) — cues are optional.
  }
}
