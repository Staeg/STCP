import type { Statuses } from '@stcp/shared';
import { icon, iconNum } from './icons';

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * One icon per buff and debuff on a unit, each with a hover tip. Shared by the fight screen's unit cards and the
 * HUD beside your class name, so a status reads the same in and out of a fight. `time` is game time (for Smoke).
 */
export function statusIcons(st: Statuses, time: number): string[] {
  const rounds = (n: number) => `${n} more turn${n === 1 ? '' : 's'} of theirs`;
  const sym = (glyph: string, tip: string) => `<span title="${esc(tip)}">${glyph}</span>`;
  return [
    st.stun && icon('stun', 'Stunned: skips their next action.'),
    st.poison && iconNum('poison', st.poison.length > 1 ? `×${st.poison.length}` : st.poison[0].rounds,
      `Poisoned: ${st.poison.map((b) => `${b.dmg} damage for ${rounds(b.rounds)}`).join('; ')}, each at the end of their turns. Mend or a Bandage cures it.`),
    st.acid && sym(`☣${st.acid.stacks > 1 ? `×${st.acid.stacks}` : ''}`,
      `Acid ×${st.acid.stacks}: takes +${st.acid.stacks * 2} from every hit, Poison included. One stack fades in ${rounds(st.acid.turns)}; another Flask adds one and starts it over.`),
    st.hexed && sym(`⛧${st.hexed.length > 1 ? `×${st.hexed.length}` : ''}`,
      `Hexed ×${st.hexed.length}: Hex deals +${st.hexed.length * 100}% to it (${st.hexed.map((n) => rounds(n)).join('; ')}).`),
    st.block && iconNum('shield', st.block, `Shield ${st.block}: soaks up the next ${st.block} damage taken, then is gone.`),
    st.weak && sym('↓', `Weakened: deals 50% less damage (${rounds(st.weak)}).`),
    st.vengeance && sym('⚔', `Vengeance: whoever attacks them takes the full blow back (${st.vengeance === 1 ? 'until their next turn' : `${st.vengeance} more turns of theirs`}).`),
    st.doom && sym(`☠${st.doom > 1 ? `×${st.doom}` : ''}`,
      `Doom ×${st.doom}: takes +${st.doom} from every blow, aura and poison tick. Holds while a Lich stands in their fight; otherwise one stack fades at the end of each of their turns.`),
    st.clang && sym(`🔔${st.clang.stacks > 1 ? `×${st.clang.stacks}` : ''}`,
      `Clang ×${st.clang.stacks}: −${st.clang.stacks}s Speed. One stack fades in ${rounds(st.clang.turns)}; Clanging adds one and starts it over.`),
    st.vigil && sym('☀', 'Lone Vigil: every enemy action sets off a free Flare, until their next turn.'),
    st.dodge !== undefined && st.dodge > time && sym('☁', `Smoke: 50% chance to dodge each attack, and fleeing always works (${Math.ceil(st.dodge - time)}s).`),
    st.brace && sym('▣', 'Bracing: takes 30% less damage until their next turn.'),
  ].filter((x): x is string => !!x);
}
