import { ABILITIES, CLASS_RULES, type AbilityDef } from './abilities';
import type { ClassId } from './classes';

/**
 * Talents (M12): a Character who has survived enough runs picks one of their class's two. Each changes a
 * perk or an existing ability; none adds a new button. Numbers live in TALENT_RULES.
 */
export type TalentId =
  | 'ironOath' | 'unyielding'
  | 'ghostStep' | 'openingAct'
  | 'everflame' | 'triage'
  | 'sanguine' | 'evilEye'
  | 'restlessDead' | 'pallbearer'
  | 'greatBell' | 'resonance'
  | 'martyr' | 'penitent'
  | 'volatile' | 'quickHands';

export interface TalentDef {
  id: TalentId;
  cls: ClassId;
  name: string;
  desc: string;
}

export const TALENT_RULES = {
  /** Iron Oath: once per run, a blow that would drop the Warden leaves them at 1 HP, untouchable for this long (seconds). */
  oathImmune: 6,
  /** Unyielding: Vengeance lasts this many more turns and cools down this many more. */
  unyieldingTurns: 1,
  unyieldingCooldown: 1,
  /** Opening Act: the Cutthroat's first turn in a fight comes after this fraction of their Speed. */
  openingFraction: 0.5,
  /** Everflame: +this much damage (0.0033 = 0.33%) per point of every ally's light. */
  everflamePerLight: 0.0033,
  /** Triage: Mend's healing (and it only targets the Lampbearer). */
  triageHeal: 12,
  /** Sanguine: HP the Sorceress heals per Hexed stack on whatever she damages. */
  sanguineHeal: 2,
  /** Restless Dead: the risen fight this many turns. */
  restlessTurns: 6,
  /** Great Bell: monsters outside fights are dazed this long (seconds) by the Toll. */
  greatBellDaze: 7,
  /** Resonance: Peal also lifts this much stress from, and heals, every ally it hastens. */
  resonanceStress: 5,
  resonanceHeal: 3,
  /** Martyr: Take Their Sins moves up to this much and heals the ally. */
  martyrSins: 40,
  martyrHeal: 5,
};

export const TALENTS: Record<TalentId, TalentDef> = {
  ironOath: { id: 'ironOath', cls: 'warden', name: 'Iron Oath',
    desc: `Once per run, a blow that would drop you leaves you at 1 HP instead, and nothing can hurt you for ${TALENT_RULES.oathImmune}s.` },
  unyielding: { id: 'unyielding', cls: 'warden', name: 'Unyielding',
    desc: `Vengeance lasts ${CLASS_RULES.vengeanceTurns + TALENT_RULES.unyieldingTurns} turns and works out of combat, but its cooldown is ${ABILITIES.warden[1].cooldown + TALENT_RULES.unyieldingCooldown}.` },
  ghostStep: { id: 'ghostStep', cls: 'cutthroat', name: 'Ghost Step',
    desc: 'Your own Flee always succeeds and costs no stress.' },
  openingAct: { id: 'openingAct', cls: 'cutthroat', name: 'Opening Act',
    desc: 'Your first turn in every fight comes after half your Speed.' },
  everflame: { id: 'everflame', cls: 'lampbearer', name: 'Everflame',
    desc: '+0.33% damage for every 1% of light your allies still carry (all three at full light: about double damage).' },
  triage: { id: 'triage', cls: 'lampbearer', name: 'Triage',
    desc: `Mend heals ${TALENT_RULES.triageHeal}, but only yourself.` },
  sanguine: { id: 'sanguine', cls: 'sorceress', name: 'Sanguine',
    desc: `Whenever you damage a Hexed enemy, heal ${TALENT_RULES.sanguineHeal} per Hex on it.` },
  evilEye: { id: 'evilEye', cls: 'sorceress', name: 'Evil Eye',
    desc: 'Every enemy starts the fight with a Hex on it when you are there.' },
  restlessDead: { id: 'restlessDead', cls: 'undertaker', name: 'Restless Dead',
    desc: `The risen fight for ${TALENT_RULES.restlessTurns} turns, and follow you out of the fight into the next one.` },
  pallbearer: { id: 'pallbearer', cls: 'undertaker', name: 'Pallbearer',
    desc: 'Allies you revive come back at full HP, and going down then costs them no Major Injury.' },
  greatBell: { id: 'greatBell', cls: 'bellwright', name: 'Great Bell',
    desc: `Your Toll stuns every monster in the dungeon: those fighting lose their next turn; the rest stop for ${TALENT_RULES.greatBellDaze}s and start any fight in that time Stunned.` },
  resonance: { id: 'resonance', cls: 'bellwright', name: 'Resonance',
    desc: `Peal also lifts ${TALENT_RULES.resonanceStress} stress from every ally it hastens and heals them ${TALENT_RULES.resonanceHeal}.` },
  martyr: { id: 'martyr', cls: 'zealot', name: 'Martyr',
    desc: `Take Their Sins moves up to ${TALENT_RULES.martyrSins} stress and heals the ally ${TALENT_RULES.martyrHeal}.` },
  penitent: { id: 'penitent', cls: 'zealot', name: 'Penitent',
    desc: 'Absolution spends only half the stress it turns into damage.' },
  volatile: { id: 'volatile', cls: 'alchemist', name: 'Volatile',
    desc: 'Using an item in a fight also sets off a free Fumes.' },
  quickHands: { id: 'quickHands', cls: 'alchemist', name: 'Quick Hands',
    desc: 'Items in a fight are used at once and don\'t take your turn.' },
};

export const TALENT_IDS = Object.keys(TALENTS) as TalentId[];

/** The two talents a Character of this class chooses between. */
export function talentsFor(cls: ClassId): [TalentId, TalentId] {
  return TALENT_IDS.filter((t) => TALENTS[t].cls === cls) as [TalentId, TalentId];
}

/** A class's abilities as a hero with this talent has them (cooldowns, field use, numbers and text). */
export function abilitiesFor(cls: ClassId, talent: TalentId | null | undefined): [AbilityDef, AbilityDef, AbilityDef] {
  const base = ABILITIES[cls];
  if (!talent) return base;
  return base.map((ab): AbilityDef => {
    switch (`${talent}:${ab.id}`) {
      case 'unyielding:vengeance': {
        const turns = CLASS_RULES.vengeanceTurns + TALENT_RULES.unyieldingTurns;
        return { ...ab, cooldown: ab.cooldown + TALENT_RULES.unyieldingCooldown, field: true,
          desc: ab.desc.replace(`next ${CLASS_RULES.vengeanceTurns} turns`, `next ${turns} turns`) + ' Works out of combat too.' };
      }
      case 'triage:mend':
        return { ...ab, target: 'self', power: TALENT_RULES.triageHeal, desc: `Heal yourself ${TALENT_RULES.triageHeal} and cure Poison.` };
      case 'restlessDead:raise':
        return { ...ab, desc: `The last enemy slain in this fight rises on your side at full HP, for ${TALENT_RULES.restlessTurns} of its turns, and follows you into your next fight.` };
      case 'resonance:peal':
        return { ...ab, desc: `${ab.desc} They also get −${TALENT_RULES.resonanceStress} stress and +${TALENT_RULES.resonanceHeal} HP.` };
      case 'martyr:sins':
        return { ...ab, power: TALENT_RULES.martyrSins, desc: `Take up to ${TALENT_RULES.martyrSins} stress off an ally onto yourself, and heal them ${TALENT_RULES.martyrHeal}.` };
      case 'penitent:absolution':
        return { ...ab, desc: 'Spend half your stress above 50; it all becomes damage, split across enemies.' };
      default:
        return ab;
    }
  }) as [AbilityDef, AbilityDef, AbilityDef];
}
