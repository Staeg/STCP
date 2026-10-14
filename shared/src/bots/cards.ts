import { CARD_RULES as R, CARDS, type CardId } from '../content/cards';
import { LIGHT_BRIGHT, LIGHT_MAX } from '../content/constants';
import type { Rng } from '../rng';
import type { CombatUnitView, EncounterView, PlayerView } from '../sim/views';

/** What a bot knows about the fight it's in (all from its own view). */
export interface BotFight {
  view: PlayerView;
  enc: EncounterView;
  me: CombatUnitView;
  allies: CombatUnitView[];
  enemies: CombatUnitView[];
  /** The enemies' HP outweighs ours. */
  losing: boolean;
  rng: Rng;
}

/** Seconds of a monster's action a Stun or a Delay is worth, in damage-like points per second. */
const TEMPO_VALUE = 1;
/** Shield is worth a little less than healing: it may never be needed. */
const SHIELD_VALUE = 0.7;
/** Light matters most below 75 (where paths start slipping the mind). */
const LIGHT_VALUE = 0.3;

/**
 * A rough worth for playing `card` now, in damage-like points (the caller divides by its time). Bots are meant to be
 * mediocre: this is a sensible guess, not a search.
 */
export function cardValue(f: BotFight, card: CardId): number {
  const { allies, enemies, me, view, enc } = f;
  const n = enemies.length;
  if (!n) return 0;
  const missing = (u: CombatUnitView) => Math.max(0, u.maxHp - u.hp);
  const hurtest = allies.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), me);
  const heal = (amount: number, u: CombatUnitView = hurtest) => Math.min(amount, missing(u)) * (u.hp / u.maxHp < 0.5 ? 1.6 : 1.1);
  const healAll = (amount: number) => allies.reduce((s, a) => s + Math.min(amount, missing(a)), 0);
  const lightOf = (u: CombatUnitView) => u.light ?? LIGHT_MAX;
  /** Worth of `amount` light given to `u`: full below Bright, a third above it. */
  const brighten = (amount: number, u: CombatUnitView) =>
    Math.min(amount, LIGHT_MAX - lightOf(u)) * (lightOf(u) < LIGHT_BRIGHT ? LIGHT_VALUE : LIGHT_VALUE / 3);
  const darkest = allies.reduce((a, b) => (lightOf(b) < lightOf(a) ? b : a), me);
  const fervour = 1 + (LIGHT_MAX - view.you.light) * 0.01;
  const soft = enemies.some((m) => m.st.stun || m.st.exposed || !m.st.acted);
  const corpses = enc.corpses;
  // Burn cards are for when it counts: losing, or a Boss in the room.
  const dire = f.losing || enemies.some((m) => m.enemy === 'king') || hurtest.hp / hurtest.maxHp < 0.35;
  const burn = (v: number) => (dire ? v : v * 0.2);
  switch (card) {
    // Warden
    case 'bash': return R.bash + Math.floor((me.st.shield ?? 0) * R.bashPerShield) + R.bashDelay * TEMPO_VALUE;
    case 'cover': return R.coverShield * SHIELD_VALUE + (hurtest.id !== me.id ? 2 : 0);
    case 'thornwall': return R.thornwallShield * SHIELD_VALUE + Math.min(R.thornwallShield + (me.st.shield ?? 0), 4) * Math.min(n, 2);
    case 'rally': return allies.length * R.rallyShield * SHIELD_VALUE;
    case 'slam': return Math.max(R.slamMin, (me.st.shield ?? 0) + 2) * 1.2;
    case 'gate': return burn(allies.length * R.gateShield * SHIELD_VALUE + n * 4);
    // Cutthroat
    case 'backstab': return soft ? R.backstab * 2 : R.backstab;
    case 'cheap': return R.cheap + 5 * TEMPO_VALUE;
    case 'envenom': return R.envenom + R.envenomPoison * 2;
    case 'signal': return allies.length > 1 ? 4 : 1;
    case 'smoke': return allies.filter((a) => a.hp / a.maxHp < 0.5).length * 4 + 1;
    case 'dance': return burn(14);
    // Lampbearer
    case 'flare': return R.flare * n + (view.you.light < 40 ? 4 : 0);
    case 'mend': return heal(R.mend);
    case 'vigil': return (allies.length === 1 ? 2 + n * 2 : 0) + brighten(R.vigilLight, darkest);
    case 'kindle': return Math.min(R.kindleMax, R.kindleBase + Math.floor(Math.min(R.kindleLight, view.you.light) / 2)) + (view.you.light >= R.kindleLight ? 3 : 0);
    case 'sanctuary': return healAll(R.sanctuaryRegen * (R.sanctuarySecs / R.pulse)) * 0.8;
    case 'dawn': return burn(healAll(R.dawnHeal) + n * 4);
    // Sorceress
    case 'hex': return R.hex * (1 + Math.max(0, ...enemies.map((m) => m.st.hexed?.length ?? 0)));
    case 'wither': return n * 3;
    case 'pact': return allies.every((a) => a.hp > R.pactCost * 2) ? R.pact * n - allies.length * 2 : 0;
    case 'familiar': return 7;
    case 'bargain': return me.hp > R.bargainHp * 3 ? 3 : 0;
    case 'ages': return burn(n * 8);
    // Undertaker
    case 'spade': return R.spade + view.you.spadeBonus;
    case 'rites': return enemies.some((m) => m.hp < m.maxHp * R.ritesBelow && m.enemy !== 'king') ? 18 : R.rites;
    case 'raise': return corpses ? 10 : 3;
    case 'explode': return (corpses ? R.explode : R.explodeBare) * n;
    case 'graveward': return (corpses ? R.graveWardCorpse : R.graveWard) * SHIELD_VALUE;
    case 'graves': return burn(corpses * 10 + 6);
    // Bellwright
    case 'clang': return R.clang + R.clangDelay * TEMPO_VALUE;
    case 'knell': return Math.max(R.knellMin, R.knell - R.knellPerAlly * (allies.length - 1)) * n;
    case 'peal': return allies.length > 1 ? (allies.length - 1) * 3 : 1;
    case 'ringout': return n * (R.ringOutDelay + (view.you.st.clang?.stacks ?? 0)) * TEMPO_VALUE;
    case 'echo': return view.you.lastCard ? cardValue(f, view.you.lastCard) * R.echoMult : R.echoBare;
    case 'reverberate': return burn(n * 6 + (allies.length - 1) * 3);
    // Zealot
    case 'scourge': return R.scourge * fervour;
    case 'absolution': return (R.absolutionBase + Math.max(0, R.absolutionFloor - view.you.light)) * fervour;
    case 'sins': return Math.max(0, ...allies.filter((a) => a.id !== me.id).map((a) => brighten(Math.min(R.sinsLight, view.you.light), a))) + 1;
    case 'martyrdom': return view.you.light > 30 ? 3 : 0;
    case 'penance': return 4 + (LIGHT_MAX - view.you.light) / 6;
    case 'rapture': return burn((R.rapture + (LIGHT_MAX - view.you.light) / 2) * fervour);
    // Alchemist
    case 'acid': return R.acid + R.acidBonus * 2;
    case 'fumes': return n * R.fumesPoison * 2;
    case 'mist': return healAll(R.mist);
    case 'elixir': return view.you.elixir ? 0 : 3;
    case 'catalyst': return n * 2 + enemies.reduce((s, m) => s + (m.st.poison ?? []).reduce((t, p) => t + p.dmg, 0), 0);
    case 'opus': return burn(12);
    // Gear
    case 'stab1': return R.stab1;
    case 'stab2': return R.stab2;
    case 'thump1': return R.thump1 + R.thump1Delay;
    case 'thump2': return R.thump2 + R.thump2Delay;
    case 'soothe1': return heal(R.soothe1);
    case 'soothe2': return heal(R.soothe2);
    case 'sidestep1': return 2;
    case 'sidestep2': return 4;
    case 'braceup1': return R.braceup1 * SHIELD_VALUE;
    case 'braceup2': return R.braceup2 * SHIELD_VALUE;
    case 'wick1': return brighten(R.wick1, me);
    case 'wick2': return brighten(R.wick2, darkest);
    case 'mutter1': return 3;
    case 'mutter2': return 7;
    case 'evillook1': return 2;
    case 'evillook2': return R.evillook2Dmg + 3;
    case 'mercy': return enemies.some((m) => m.hp < m.maxHp * R.mercyBelow) ? 15 : R.mercy;
    case 'whispercut': return R.whispercut + R.whispercutBleed * 3;
    case 'shatter': return R.shatter + R.shatterSunder + R.shatterDelay;
    case 'earthblow': return R.earthblow * Math.min(2, n) + 4;
    case 'doublehex': return 4;
    case 'bloom': return healAll(R.bloomRegen * (R.bloomSecs / R.pulse)) * 0.8;
    case 'glass': return 3;
    case 'scaleward': return R.scaleWard * SHIELD_VALUE + 2;
    case 'fade': return 3;
    case 'runeward': return allies.length * R.runeWard * SHIELD_VALUE;
    case 'bulwark': return R.bulwark * SHIELD_VALUE + R.bulwarkDelay;
    case 'liestill': return heal(R.lieStillHeal, me);
    case 'slipaway': return 0;
    case 'blink': return me.hp / me.maxHp < 0.5 ? 5 : 1;
    case 'veil': return 3;
    case 'luckybreak': return enc.yourHand.filter((c) => c.weak).length * 3;
    case 'feverdream': return 1;
    case 'bloodrush': return me.hp > R.bloodRushHp * 3 ? 5 : 0;
    case 'ashes': return n * 2;
    // Legendary
    case 'promise': return burn(25);
    case 'quake': return n * (R.quake + 4);
    case 'unmake': return burn(30);
    case 'redeem': return burn(heal(99) - lightOf(hurtest) * LIGHT_VALUE);
    case 'bastion': return 8;
    case 'forgive': return burn(20);
    case 'howl': return 8;
    case 'waystep': return 0;
    case 'oil': return burn(brighten(LIGHT_MAX, me) * 2);
    case 'fumble': return 0;
  }
  return CARDS[card] ? 1 : 0;
}
