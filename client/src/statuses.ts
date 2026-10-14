import { CARD_RULES, type Statuses } from '@stcp/shared';
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
      `Acid ×${st.acid.stacks}: −${st.acid.stacks * 2} Block (takes ${st.acid.stacks * 2} more from every hit, Poison included). One stack fades in ${rounds(st.acid.turns)}; another Flask adds one and starts it over.`),
    st.sunder && sym(`⚟${st.sunder > 1 ? `×${st.sunder}` : ''}`, `Bitten ×${st.sunder}: −${st.sunder} Block (takes ${st.sunder} more from every hit) until the fight ends.`),
    st.hexed && sym(`⛧${st.hexed.length > 1 ? `×${st.hexed.length}` : ''}`,
      `Hexed ×${st.hexed.length}: Hex deals +${st.hexed.length * 100}% to it (${st.hexed.map((n) => rounds(n)).join('; ')}).`),
    st.shield && iconNum('shield', st.shield, `Shield ${st.shield}: soaks up the next ${st.shield} damage from blows. Lasts until the end of your next fight.`),
    st.weak && sym(`↓${st.weak.stacks > 1 ? `×${st.weak.stacks}` : ''}`,
      `Weakened ×${st.weak.stacks}: deals ${Math.round((1 - 0.5 ** st.weak.stacks) * 100)}% less damage. One stack fades in ${rounds(st.weak.turns)}; another Wither adds one and starts it over.`),
    st.witchwood && sym('✶', 'Witchwood: takes 15% more from everyone while it carries any debuff.'),
    st.thornwall && sym('❋', 'Thornwall: until their next turn, whatever their Shield stops is dealt back to the attacker.'),
    st.doom && sym(`☠${st.doom > 1 ? `×${st.doom}` : ''}`,
      `Doom ×${st.doom}: takes +${st.doom} from every blow, aura and poison tick. Holds while a Lich stands in their fight; otherwise one stack fades at the end of each of their turns.`),
    st.clang && sym(`🔔${st.clang.stacks > 1 ? `×${st.clang.stacks}` : ''}`,
      `Clang ×${st.clang.stacks}: every card takes ${st.clang.stacks * CARD_RULES.clangHaste}s less. One stack fades in ${rounds(st.clang.turns)}; Clanging adds one and starts it over.`),
    st.vigil && sym('☀', `Lone Vigil: every enemy action sets off a free Flare, until their ${st.vigilMore ? `turn after next` : 'next turn'}.`),
    st.dodge !== undefined && st.dodge > time && sym('☁', `Dodging: 50% chance to dodge each attack (${Math.ceil(st.dodge - time)}s).${st.fleeSure !== undefined && st.fleeSure > time ? ' Fleeing always works.' : ''}`),
    st.brace && sym('▣', 'Bracing: takes 30% less damage until their next turn.'),
    // ---- Card statuses (M15) ----
    st.bleed && sym(`🩸${st.bleed.length > 1 ? `×${st.bleed.length}` : ''}`,
      `Bleeding: ${st.bleed.map((b) => `${b.dmg} every ${CARD_RULES.pulse}s for ${Math.max(0, Math.ceil(b.until - time))}s`).join('; ')}. Mend cures it.`),
    st.regen && st.regen.until > time && sym('❀', `Regen: +${st.regen.amount} HP every ${CARD_RULES.pulse}s (${Math.ceil(st.regen.until - time)}s).`),
    st.slow && st.slow.until > time && sym('🐌', `Slowed: every action takes ${st.slow.amount}s longer (${Math.ceil(st.slow.until - time)}s).`),
    st.haste && st.haste.until > time && sym('»', `Haste: every card takes ${st.haste.amount}s less (${Math.ceil(st.haste.until - time)}s).`),
    st.blind && sym('◎', 'Blinded: its next attack misses.'),
    st.exposed && sym('◇', `Exposed: the next hit it takes does +${Math.round(st.exposed * 100)}%.`),
    st.expose && sym('☞', 'Their next hit Exposes what it lands on (Hand Signal).'),
    st.evade && sym(`◌${st.evade > 1 ? `×${st.evade}` : ''}`, `The next ${st.evade > 1 ? `${st.evade} attacks` : 'attack'} aimed at them ${st.evade > 1 ? 'miss' : 'misses'}.`),
    st.sidestep && sym('↯', `Sidestepping: ${Math.round(st.sidestep * 100)}% chance to dodge until their next turn.`),
    st.spikes && sym('✧', `Scale Ward: whatever hits them takes ${st.spikes}, until their next turn.`),
    st.gate !== undefined && st.gate > time && sym('⛩', `Holding the Gate: every enemy whose blow lands on their Shield is Delayed (${Math.ceil(st.gate - time)}s).`),
    st.dance !== undefined && st.dance > time && sym('⚔', `Blade Dance: every card takes 1s and Backstab always crits (${Math.ceil(st.dance - time)}s).`),
    st.quick && sym('⏩', `Next card: ${st.quick.set !== undefined ? `takes at most ${st.quick.set}s` : ''}${st.quick.set !== undefined && st.quick.cut ? ', then ' : ''}${st.quick.cut ? `${st.quick.cut}s less` : ''}.`),
    st.conjureHalf && sym('✦', 'Fever Dream: Conjure cards take half their time this fight.'),
    st.quickItems && sym('⚗', 'Opus Magnum: items take 1s this fight.'),
  ].filter((x): x is string => !!x);
}
