import type { SoundCue } from '@stcp/shared';

/** Tiny generated cues (no audio assets). */
let ctx: AudioContext | null = null;

/**
 * One note: `freq` Hz (gliding to `to` if given), starting `at` seconds from now, swelling in over `attack`
 * and fading out by `len`. `lp` darkens it through a lowpass filter at that many Hz.
 */
function tone(freq: number, at: number, len: number, opts: { type?: OscillatorType; vol?: number; to?: number; attack?: number; lp?: number } = {}) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = opts.type ?? 'square';
  const t = ctx!.currentTime + at;
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.06, t + (opts.attack ?? 0.02));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  if (opts.lp) {
    const f = ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.lp;
    o.connect(f).connect(g);
  } else o.connect(g);
  g.connect(ctx!.destination);
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
      case 'abandon':
        // The bots are left to the dark: three falling notes, the last one dying away.
        [196, 165, 110].forEach((f, i) => tone(f, i * 0.3, i === 2 ? 1.2 : 0.28, { vol: 0.05, lp: 900 }));
        break;
      case 'king':
        // A funeral march: a dark, beating drone swells under four heavy strikes, a tritone creeps in beneath them,
        // and it all sinks into a long falling groan.
        tone(41.2, 0, 7, { type: 'sawtooth', vol: 0.06, attack: 1.5, lp: 300 });
        tone(41.7, 0, 7, { type: 'sawtooth', vol: 0.06, attack: 1.5, lp: 300 });
        tone(58.3, 2, 5, { type: 'sawtooth', vol: 0.035, attack: 1.5, lp: 400 });
        [82.4, 82.4, 87.3, 77.8].forEach((f, i) => {
          tone(f, i * 0.85, 0.75, { vol: 0.06, lp: 900 });
          tone(f / 2, i * 0.85, 0.3, { type: 'sine', vol: 0.1 });
        });
        tone(61.7, 3.4, 3.6, { vol: 0.06, lp: 700 });
        tone(220, 3.4, 3.6, { type: 'sawtooth', vol: 0.03, to: 55, attack: 0.8, lp: 600 });
        break;
    }
  } catch {
    // Audio unavailable (autoplay policy etc.) — cues are optional.
  }
}
