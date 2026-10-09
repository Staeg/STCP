/**
 * The game's stat and keyword icons: little pixel-art SVGs, each with a hover explanation. `iconize` swaps the
 * words in a rules text (ability and item descriptions, event choices) for them.
 */

export type IconId = 'hp' | 'stress' | 'speed' | 'cooldown' | 'field' | 'dmg' | 'stun' | 'light' | 'bleed' | 'shield'
  | 'revive' | 'flee' | 'brace';

const PAL: Record<string, string> = {
  r: '#d94a4a', R: '#8a2a2a', w: '#f0e8d8', W: '#9a9488', k: '#2a2420', g: '#7a7a7a', b: '#7a4a22', B: '#4a2c14',
  y: '#f2c84b', o: '#e8742a', s: '#c4ccd4', S: '#7f8a94', p: '#b07ae0',
};

/** Pixel grids (8×8; the bodies 10×9), one letter per palette colour, '.' for nothing. */
const ART: Record<Exclude<IconId, 'bleed'>, string[]> = {
  hp: ['.rr..rr.', 'rwrrrrrR', 'rrrrrrrR', 'rrrrrrrR', '.rrrrrR.', '..rrrR..', '...rR...', '........'],
  stress: ['.ww..ww.', 'wwwwwwwW', 'wwwwwwwW', 'wwwwwwwW', '.wwwwwW.', '..wwwW..', '...wW...', '........'],
  speed: ['..gggg..', '.gwwwwg.', 'gwwkwwwg', 'gwwkwwwg', 'gwwkkkwg', 'gwwwwwwg', '.gwwwwg.', '..gggg..'],
  cooldown: ['bbbbbbbb', '.g....g.', '..gyyg..', '...yy...', '...gg...', '..g..g..', '.gyyyyg.', 'bbbbbbbb'],
  // A tent: works out in the field (a campfire read too much like the torch).
  field: ['...wW...', '..wwWW..', '..wwWW..', '.wwwkWW.', '.wwkkWW.', 'wwwkkWWW', 'wwkkkkWW', 'BBBBBBBB'],
  dmg: ['.......s', '......sS', '.....sS.', '....sS..', 'y..sS...', '.ysS....', '.by.....', 'b..y....'],
  stun: ['.pppppp.', 'p......p', 'p.pppp.p', 'p.p..p.p', 'p.p.pp.p', 'p.p....p', 'p.pppppp', '........'],
  light: ['...o....', '..oyo...', '..oyyo..', '...yo...', '..BbbB..', '...bb...', '...bb...', '...bb...'],
  shield: ['SSSSSSSS', 'SssssssS', 'SsswwssS', 'SsswwssS', 'SssssssS', '.SssssS.', '..SssS..', '...SS...'],
  // Combat actions: a body getting up, one running away, one cowering behind its arms.
  revive: ['..ww....y.', '..ww...yyy', '.wwww...y.', '..ww....y.', '..ww....y.', '..wwww..y.', '.ww..w....', '.w...w....', 'gggggggggg'],
  flee: ['......ww..', '......ww..', '.gg..wwwww', '....w.ww..', '.gg...ww..', '.....w..w.', '.gg.w....w', '...w......', '..........'],
  brace: ['..........', '...wwww...', 'g.w.ww.w.g', '..wwwwww..', '...wwww...', '..wwwww...', '..ww.ww...', '.ww..ww...', 'gggggggggg'],
};

function svg(rows: string[]): string {
  let rects = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[c]}"/>`;
  }));
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

const GLYPH: Record<IconId, string> = {
  ...(Object.fromEntries(Object.entries(ART).map(([id, rows]) => [id, svg(rows)])) as Record<Exclude<IconId, 'bleed'>, string>),
  // The same drop the combat screen shows on a bleeding unit.
  bleed: '<span class="ic-emoji">🩸</span>',
};

export const ICON_TIPS: Record<IconId, string> = {
  hp: 'HP: health. At 0 you go down, and bleed out unless an ally gets you back up.',
  stress: 'Stress (0–100): builds up in the dark, in fights and from horrors. At 100 you get an affliction.',
  speed: 'Speed: seconds between your turns in a fight, and to walk a tunnel. Lower is faster.',
  cooldown: 'Cooldown: after using it, unusable for this many of your own turns.',
  field: 'Also works outside fights: pick it, and it happens when your timer runs out (using up that turn).',
  dmg: 'Damage: HP taken off whoever is hit.',
  stun: 'Stun: the target skips its next action.',
  light: 'Light: fades as you explore. Dim and you can’t see next door; in the dark, stress climbs and monsters hit harder.',
  bleed: 'Bleed: takes damage at the end of each of its turns, for a few turns. Mend or a Bandage cures it.',
  shield: 'Shield: soaks up that much damage taken, then is gone.',
  revive: 'Revive',
  flee: 'Flee',
  brace: 'Brace',
};

function attr(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** An icon with its explanation on hover (`tip` replaces the standard one). */
export function icon(id: IconId, tip = ICON_TIPS[id]): string {
  return `<span class="ic ic-${id}" title="${attr(tip)}">${GLYPH[id]}</span>`;
}

/** An icon followed by a number, e.g. ❤ 30, as one unit. */
export function iconNum(id: IconId, n: string | number, tip?: string): string {
  return `<span class="ic-num">${icon(id, tip)}${n}</span>`;
}

/** The hourglass for an ability's cooldown, with how long it is on hover. */
export function cooldownIcon(turns: number, left?: number): string {
  const tip = left
    ? `Cooldown: ready in ${left} of your turn${left === 1 ? '' : 's'}.`
    : `Cooldown ${turns}: after using it, unusable for your next ${turns === 1 ? 'turn' : `${turns} turns`}.`;
  return iconNum('cooldown', left ?? turns, tip);
}

const WORDS: [RegExp, IconId][] = [
  [/\b(?:dmg|damage)\b/gi, 'dmg'],
  [/\bHP\b/g, 'hp'],
  [/\b[Ss]tun(?:ned|s)?\b/g, 'stun'],
  [/\b[Bb]leed(?:s|ing)?\b/g, 'bleed'],
  [/\bShield\b(?! Bash)/g, 'shield'],
  [/\b[Ss]tress\b/g, 'stress'],
  [/\blight\b/g, 'light'],
  [/\bSpeed\b/g, 'speed'],
  [/\bCooldown\b/gi, 'cooldown'],
];

/** Plain rules text → HTML with the keywords as icons. */
export function iconize(text: string): string {
  // Swap each keyword for a placeholder first, so later patterns never match inside an earlier icon's markup.
  const found: IconId[] = [];
  let s = attr(text);
  for (const [re, id] of WORDS) s = s.replace(re, () => `\u0000${found.push(id) - 1}\u0000`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => icon(found[Number(i)]));
}
