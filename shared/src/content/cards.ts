import type { ClassId } from './classes';
import type { GearSlot, GearType } from './items';

/**
 * Card combat (M15, user 2026-10-13). Every hero fights from a deck: their class's six cards plus one card for each
 * worn piece of Gear (Fumble for an empty slot). A fight starts with a hand of three; playing a card draws the next.
 * Each card says how long it is until the hero's next action (its `time`); Speed only sets the wait for the first.
 * Burn cards leave the deck for the rest of the run. Every card always does something when played (a weaker
 * fallback is written into the text of the ones that need something to work on).
 */

/** Card schools: an icon on the card. Gear passives and Talents key off them. */
export type School = 'strike' | 'guard' | 'hinder' | 'hasten' | 'venom' | 'mend' | 'conjure' | 'hex' | 'light';

/** `tint`: a card picture's background (dark, then the lighter disc behind its motif), by its first school. */
export const SCHOOLS: Record<School, { name: string; glyph: string; tint: [string, string]; desc: string }> = {
  strike: { name: 'Strike', glyph: '⚔', tint: ['#3a1614', '#6a2a24'], desc: 'Plain damage.' },
  guard: { name: 'Guard', glyph: '⛨', tint: ['#16243a', '#2c4a6e'], desc: 'Shield, Dodge, and holding the front.' },
  hinder: { name: 'Hinder', glyph: '⏳', tint: ['#3a2c10', '#6a5222'], desc: "Delay, Slow and Stun: the enemy's tempo." },
  hasten: { name: 'Hasten', glyph: '➶', tint: ['#0e2e36', '#1e5a68'], desc: "Hurry and Haste: your side's tempo." },
  venom: { name: 'Venom', glyph: '☣', tint: ['#16300f', '#2e5a22'], desc: 'Poison, Bleed and Acid.' },
  mend: { name: 'Mend', glyph: '✚', tint: ['#1a3422', '#356446'], desc: 'Healing and Regen.' },
  conjure: { name: 'Conjure', glyph: '✦', tint: ['#2a1636', '#6a4486'], desc: 'Summons and Corpses.' },
  hex: { name: 'Hex', glyph: '⛧', tint: ['#36122c', '#642452'], desc: 'Hexed, Weak and Exposed.' },
  light: { name: 'Light', glyph: '☀', tint: ['#363010', '#68591e'], desc: 'Light, spent or shared.' },
};

/**
 * enemy: any enemy · enemyFirst: the nearest enemy (no pick) · ally: any conscious hero in the fight, you included ·
 * room: a room on your map · none: nothing to pick (all enemies, all allies, yourself, or chosen for you).
 */
export type CardTarget = 'enemy' | 'enemyFirst' | 'ally' | 'room' | 'none';

export type CardId =
  // Warden
  | 'bash' | 'cover' | 'vengeance' | 'rally' | 'slam' | 'gate'
  // Cutthroat
  | 'backstab' | 'cheap' | 'envenom' | 'signal' | 'smoke' | 'dance'
  // Lampbearer
  | 'flare' | 'mend' | 'vigil' | 'kindle' | 'sanctuary' | 'dawn'
  // Sorceress
  | 'hex' | 'wither' | 'pact' | 'familiar' | 'bargain' | 'ages'
  // Undertaker
  | 'spade' | 'rites' | 'raise' | 'explode' | 'graveward' | 'graves'
  // Bellwright
  | 'clang' | 'knell' | 'peal' | 'ringout' | 'echo' | 'reverberate'
  // Zealot
  | 'scourge' | 'absolution' | 'sins' | 'flagellate' | 'penance' | 'rapture'
  // Alchemist
  | 'acid' | 'fumes' | 'mist' | 'elixir' | 'catalyst' | 'opus'
  // Gear type cards (Common / Uncommon)
  | 'stab1' | 'stab2' | 'thump1' | 'thump2' | 'soothe1' | 'soothe2' | 'sidestep1' | 'sidestep2'
  | 'braceup1' | 'braceup2' | 'wick1' | 'wick2' | 'mutter1' | 'mutter2' | 'evillook1' | 'evillook2'
  // Rare Gear cards
  | 'mercy' | 'whispercut' | 'shatter' | 'earthblow' | 'doublehex' | 'bloom' | 'glass'
  | 'scaleward' | 'fade' | 'runeward' | 'bulwark' | 'liestill' | 'slipaway' | 'blink' | 'veil'
  | 'luckybreak' | 'feverdream' | 'bloodrush' | 'ashes'
  // Legendary cards
  | 'promise' | 'quake' | 'unmake' | 'redeem' | 'bastion' | 'forgive' | 'howl' | 'waystep'
  // The Journeyman Elder's Bless (user, 2026-10-14)
  | 'oil'
  // An empty Gear slot
  | 'fumble';

export interface CardDef {
  id: CardId;
  name: string;
  /** Seconds until the hero's next action after playing it (before Tempo and other changes; never below MIN_CARD_TIME). */
  time: number;
  schools: School[];
  target: CardTarget;
  /** Leaves the deck for the rest of the run once played (a Loom brings it back). */
  burn?: true;
  desc: string;
}

/** The fastest any card or action can be (seconds). */
export const MIN_CARD_TIME = 1;

/** Numbers for the cards (and the basic actions). Durations: "turns" are the bearer's own actions, "secs" seconds. */
export const CARD_RULES = {
  handSize: 3,
  /** Basic actions, always there beside the hand. */
  braceTime: 2,
  braceMult: 0.7,
  fleeTime: 3,
  reviveTime: 5,
  itemTime: 2,
  /** A stunned hero loses the action and acts again this much later. */
  stunnedTime: 3,
  // ---- Warden ----
  bash: 9, bashDelay: 2,
  coverShield: 8,
  vengeanceTurns: 2,
  rallyShield: 6,
  slamMin: 6, slamDelayPer: 3,
  gateSecs: 12, gateMult: 0.5, gateDelay: 2,
  // ---- Cutthroat ----
  backstab: 6,
  cheap: 2,
  envenom: 2, envenomPoison: 3, envenomTurns: 3,
  signalHurry: 3,
  smokeSecs: 8,
  danceSecs: 10,
  // ---- Lampbearer ----
  flare: 4, flareLight: 10,
  mend: 8,
  vigilLight: 15,
  kindleBase: 4, kindleLight: 20, kindleMax: 14,
  sanctuaryRegen: 2, sanctuarySecs: 10,
  dawnHeal: 15,
  // ---- Sorceress ----
  hex: 5, hexedTurns: 2, hexedBonus: 1,
  witherTurns: 2,
  pact: 14, pactCost: 5,
  familiarMax: 2,
  bargainHp: 5,
  agesStacks: 3, agesDelayPer: 1.5,
  // ---- Undertaker ----
  spade: 9, spadePerRites: 1,
  ritesBelow: 0.4, rites: 8,
  raiseTurns: 4,
  explode: 8, explodeBare: 3,
  graveWard: 3, graveWardCorpse: 8,
  // ---- Bellwright ----
  clang: 8, clangDelay: 4, clangTurns: 2, clangHaste: 0.5,
  knell: 15, knellPerAlly: 5, knellMin: 3,
  pealHurry: 4, pealAlone: 4,
  ringOutDelay: 4, ringOutPerClang: 1,
  echoMult: 0.5, echoBare: 3,
  // ---- Zealot ----
  scourge: 7,
  absolutionBase: 6, absolutionFloor: 50,
  sinsLight: 25, sinsSelf: 15,
  flagellateHp: 4, flagellateLight: 15,
  penanceLight: 10, penanceDiv: 3,
  rapture: 15, raptureLight: 20,
  // ---- Alchemist ----
  acid: 5, acidTurns: 2, acidBonus: 2,
  fumesPoison: 3, fumesTurns: 3,
  mist: 9,
  catalystPoison: 2, catalystTurns: 2,
  opusItems: 4,
  // ---- Gear ----
  stab1: 3, stab2: 5,
  thump1: 3, thump1Delay: 1, thump2: 8, thump2Delay: 2,
  soothe1: 3, soothe2: 8,
  sidestep1: 0.5, sidestep2: 0.5, sidestep2Secs: 6,
  braceup1: 4, braceup2: 7,
  wick1: 8, wick2: 15,
  evillook1: 0.25, evillook2: 0.5, evillook2Dmg: 4,
  mercy: 6, mercyBelow: 0.25,
  whispercut: 2, whispercutBleed: 2, whispercutSecs: 6, whispercutCut: 1,
  shatter: 6, shatterSunder: 3, shatterDelay: 2,
  earthblow: 10, earthblowSlow: 2, earthblowSecs: 10,
  bloomRegen: 3, bloomSecs: 12,
  scaleWard: 10, scaleWardSpikes: 3,
  fadeCut: 1,
  runeWard: 8,
  bulwark: 14, bulwarkDelay: 3,
  lieStillHeal: 14, lieStillLight: 10,
  feverLight: 10,
  bloodRushHp: 4, bloodRushHaste: 1, bloodRushSecs: 8,
  ashesLight: 15,
  promiseBoss: 20,
  quake: 9,
  forgiveHeal: 10,
  bastionPerBlock: 3,
  // ---- Statuses ----
  /** Regen and Bleed tick this often (seconds). */
  pulse: 2,
  /** Exposed: the next hit taken does this much more (the ring and Hand Signal's set it lower or higher). */
  exposed: 0.5,
  /** The Rat, Shade and Imp: at most this many of each per hero in a fight. */
  summonMax: 2,
};

const R = CARD_RULES;

const card = (id: CardId, name: string, time: number, schools: School[], target: CardTarget, desc: string, burn = false): CardDef =>
  ({ id, name, time, schools, target, desc, ...(burn ? { burn: true as const } : {}) });

export const CARDS: Record<CardId, CardDef> = {
  // ---- Warden: holding the front, damage made of Shield and Block ----
  bash: card('bash', 'Shield Bash', 5, ['strike', 'hinder'], 'enemyFirst', `${R.bash} dmg to the nearest enemy; Delay it ${R.bashDelay}s.`),
  cover: card('cover', 'Cover', 3, ['guard'], 'ally', `An ally (or you) +${R.coverShield} Shield; you step to the front of the line.`),
  vengeance: card('vengeance', 'Vengeance', 5, ['guard'], 'none', `For your next ${R.vengeanceTurns} turns, every attack on you is dealt back to the attacker in full.`),
  rally: card('rally', 'Rally', 4, ['guard'], 'none', `Every ally +${R.rallyShield} Shield.`),
  slam: card('slam', 'Shield Slam', 5, ['guard', 'hinder'], 'enemyFirst', `Damage equal to your Block + Shield (at least ${R.slamMin}) to the nearest enemy; Delay it 1s per ${R.slamDelayPer} damage dealt.`),
  gate: card('gate', 'Hold the Gate', 6, ['guard', 'hinder'], 'none', `For ${R.gateSecs}s you take half damage, Vengeance is on, and every enemy that hits you is Delayed ${R.gateDelay}s.`, true),
  // ---- Cutthroat: Ambush and quick cards ----
  backstab: card('backstab', 'Backstab', 2.5, ['strike'], 'enemy', `${R.backstab} dmg; ×2 against an enemy that is Stunned, Exposed or hasn't acted yet.`),
  cheap: card('cheap', 'Cheap Shot', 3, ['hinder'], 'enemy', `${R.cheap} dmg and Stun.`),
  envenom: card('envenom', 'Envenom', 2, ['venom'], 'enemy', `${R.envenom} dmg and Poison ${R.envenomPoison} for ${R.envenomTurns} turns.`),
  signal: card('signal', 'Hand Signal', 1, ['hasten'], 'ally', `Hurry an ally (or you) ${R.signalHurry}s, and their next hit Exposes its target.`),
  smoke: card('smoke', 'Smoke Bomb', 3, ['guard', 'hasten'], 'none', `Every ally: 50% Dodge, and fleeing always works, for ${R.smokeSecs}s.`),
  dance: card('dance', 'Blade Dance', 1, ['hasten'], 'none', `For ${R.danceSecs}s every card you play takes 1s, and Backstab always crits.`, true),
  // ---- Lampbearer: light as a resource ----
  flare: card('flare', 'Flare', 4, ['light', 'strike'], 'none', `${R.flare} dmg to every enemy; +${R.flareLight} light to everyone here.`),
  mend: card('mend', 'Mend', 4, ['mend'], 'ally', `Heal an ally (or you) ${R.mend} and cure Poison and Bleed.`),
  vigil: card('vigil', 'Vigil', 4, ['light'], 'ally', `An ally (or you) +${R.vigilLight} light. If you're the only hero in the fight, every enemy action until your next turn sets off a free Flare.`),
  kindle: card('kindle', 'Kindle', 5, ['light', 'strike'], 'enemy', `Spend up to ${R.kindleLight} of your light: ${R.kindleBase} dmg +1 per 2 light spent (at most ${R.kindleMax}); Blind it if you spent the full ${R.kindleLight}.`),
  sanctuary: card('sanctuary', 'Sanctuary', 5, ['mend', 'light'], 'none', `Every ally: Regen ${R.sanctuaryRegen} every ${R.pulse}s for ${R.sanctuarySecs}s.`),
  dawn: card('dawn', 'Dawn', 6, ['light', 'mend'], 'none', `Every ally: light to full, heal ${R.dawnHeal}. Every enemy is Blinded.`, true),
  // ---- Sorceress: Hex, blood and familiars ----
  hex: card('hex', 'Hex', 3.5, ['hex'], 'enemy', `${R.hex} dmg and Hexed for ${R.hexedTurns} turns: Hex deals +100% to it per Hexed stack.`),
  wither: card('wither', 'Wither', 3, ['hex'], 'none', `Every enemy is Weak for ${R.witherTurns} turns (−50% damage per stack).`),
  pact: card('pact', 'Blood Pact', 6, ['hex', 'strike'], 'none', `Every ally, you included, loses ${R.pactCost} HP (never below 1). ${R.pact} dmg to every enemy.`),
  familiar: card('familiar', 'Bound Familiar', 5, ['conjure'], 'none', `Summon an Imp for this fight (its bite adds Hexed). At most ${R.familiarMax}; with more, heal your Imps instead.`),
  bargain: card('bargain', 'Mad Bargain', 1, ['hex', 'hasten'], 'none', `Lose ${R.bargainHp} HP (never below 1); your next card takes 1s.`),
  ages: card('ages', 'Curse of Ages', 4, ['hex', 'hinder'], 'none', `Every enemy gains ${R.agesStacks} Hexed stacks, then is Delayed ${R.agesDelayPer}s per Hexed stack it carries.`, true),
  // ---- Undertaker: Corpses and executions ----
  spade: card('spade', 'Spade', 5, ['strike'], 'enemy', `${R.spade} dmg, +${R.spadePerRites} for every enemy your Last Rites has killed this run.`),
  rites: card('rites', 'Last Rites', 5, ['strike'], 'enemy', `Kill an enemy below ${R.ritesBelow * 100}% HP outright; otherwise (or a Boss) ${R.rites} dmg.`),
  raise: card('raise', 'Raise', 5, ['conjure'], 'none', `Use up a Corpse: it rises on your side at full HP for ${R.raiseTurns} of its turns. With no Corpse, a Rat claws up for the fight.`),
  explode: card('explode', 'Corpse Explosion', 4, ['strike', 'conjure'], 'none', `Use up a Corpse: ${R.explode} dmg to every enemy. With no Corpse, ${R.explodeBare} dmg to every enemy.`),
  graveward: card('graveward', 'Grave Ward', 1, ['guard', 'conjure'], 'ally', `An ally (or you) +${R.graveWard} Shield, or +${R.graveWardCorpse} if you use up a Corpse.`),
  graves: card('graves', 'Open the Graves', 6, ['conjure'], 'none', 'Every Corpse here rises on your side for the rest of the fight (at least one Ghoul claws up).', true),
  // ---- Bellwright: Clang, Echo and the tempo of both sides ----
  clang: card('clang', 'Clang', 6, ['strike', 'hinder'], 'enemyFirst', `${R.clang} dmg to the nearest enemy; Delay it ${R.clangDelay}s. You gain a Clang stack (your cards take ${R.clangHaste}s less per stack; one fades every ${R.clangTurns} turns).`),
  knell: card('knell', 'Knell', 8, ['strike'], 'none', `${R.knell} dmg to every enemy, −${R.knellPerAlly} for each other hero standing in the fight (at least ${R.knellMin}).`),
  peal: card('peal', 'Peal', 4, ['hasten'], 'none', `Hurry every other ally ${R.pealHurry}s (alone: Hurry yourself ${R.pealAlone}s).`),
  ringout: card('ringout', 'Ring Out', 4, ['hinder'], 'none', `Delay every enemy ${R.ringOutDelay}s, +${R.ringOutPerClang}s per Clang stack you have.`),
  echo: card('echo', 'Echo', 3, ['hasten'], 'none', `Your last card (never a Burn) happens again at half power. With nothing to echo, ${R.echoBare} dmg to the nearest enemy.`),
  reverberate: card('reverberate', 'Reverberate', 3, ['hinder', 'hasten'], 'none', "Every enemy is Stunned; every ally's next action comes now.", true),
  // ---- Zealot: darkness as fuel ----
  scourge: card('scourge', 'Scourge', 3.5, ['strike'], 'enemy', `${R.scourge} dmg.`),
  absolution: card('absolution', 'Absolution', 5, ['light', 'strike'], 'none', `${R.absolutionBase} dmg plus the light you lack below ${R.absolutionFloor}, split across enemies; you regain that much light.`),
  sins: card('sins', 'Take Their Sins', 3, ['light'], 'ally', `Give an ally up to ${R.sinsLight} of your light (on yourself: snuff ${R.sinsSelf} of it).`),
  flagellate: card('flagellate', 'Flagellate', 1, ['light'], 'none', `Lose ${R.flagellateHp} HP; snuff ${R.flagellateLight} of your light.`),
  penance: card('penance', 'Penance', 2, ['guard', 'light'], 'none', `Snuff ${R.penanceLight} of your light, then gain Shield equal to a third of the light you lack.`),
  rapture: card('rapture', 'Rapture', 5, ['light', 'strike'], 'enemy', `Every other ally gains up to ${R.raptureLight} light, taken from yours; deal ${R.rapture} + half the light you lack to one enemy.`, true),
  // ---- Alchemist: brews and poisons ----
  acid: card('acid', 'Acid Flask', 4, ['venom'], 'enemy', `${R.acid} dmg and a stack of Acid (−${R.acidBonus} Block each; one fades every ${R.acidTurns} of its turns).`),
  fumes: card('fumes', 'Fumes', 5, ['venom'], 'none', `Poison ${R.fumesPoison} for ${R.fumesTurns} turns on every enemy.`),
  mist: card('mist', 'Healing Mist', 5, ['mend'], 'none', `Heal every ally ${R.mist}.`),
  elixir: card('elixir', 'Elixir', 2, ['mend'], 'ally', "An ally's (or your) next item has double effect."),
  catalyst: card('catalyst', 'Catalyst', 4, ['venom'], 'none', `Every enemy gets Poison ${R.catalystPoison} for ${R.catalystTurns} turns; then every Poison and Bleed on every enemy ticks once now.`),
  opus: card('opus', 'Opus Magnum', 4, ['mend', 'venom'], 'none', `Fill up to ${R.opusItems} empty pack slots with random consumables; your items take 1s for the rest of the fight.`, true),
  // ---- Gear types: Commons are underwhelming, Uncommons match the nearest class card ----
  stab1: card('stab1', 'Stab', 2.5, ['strike'], 'enemy', `${R.stab1} dmg.`),
  stab2: card('stab2', 'Stab', 2.5, ['strike'], 'enemy', `${R.stab2} dmg.`),
  thump1: card('thump1', 'Thump', 5, ['strike', 'hinder'], 'enemyFirst', `${R.thump1} dmg to the nearest enemy; Delay it ${R.thump1Delay}s.`),
  thump2: card('thump2', 'Thump', 5, ['strike', 'hinder'], 'enemyFirst', `${R.thump2} dmg to the nearest enemy; Delay it ${R.thump2Delay}s.`),
  soothe1: card('soothe1', 'Soothe', 4, ['mend'], 'ally', `Heal an ally (or you) ${R.soothe1}.`),
  soothe2: card('soothe2', 'Soothe', 4, ['mend'], 'ally', `Heal an ally (or you) ${R.soothe2}.`),
  sidestep1: card('sidestep1', 'Sidestep', 2, ['guard'], 'none', `${R.sidestep1 * 100}% Dodge until your next turn.`),
  sidestep2: card('sidestep2', 'Sidestep', 2, ['guard'], 'none', `${R.sidestep2 * 100}% Dodge for ${R.sidestep2Secs}s.`),
  braceup1: card('braceup1', 'Brace Up', 3, ['guard'], 'none', `+${R.braceup1} Shield.`),
  braceup2: card('braceup2', 'Brace Up', 3, ['guard'], 'none', `+${R.braceup2} Shield.`),
  wick1: card('wick1', 'Trim the Wick', 2, ['light'], 'none', `+${R.wick1} light.`),
  wick2: card('wick2', 'Trim the Wick', 3, ['light'], 'ally', `An ally (or you) +${R.wick2} light.`),
  mutter1: card('mutter1', 'Mutter', 5, ['conjure'], 'none', `Summon a Rat for this fight. At most ${R.summonMax}; with more, heal them instead.`),
  mutter2: card('mutter2', 'Mutter', 6, ['conjure'], 'none', `Summon a Shade for this fight. At most ${R.summonMax}; with more, heal them instead.`),
  evillook1: card('evillook1', 'Evil Look', 2, ['hex'], 'enemy', `Exposed: its next hit taken does +${R.evillook1 * 100}%.`),
  evillook2: card('evillook2', 'Evil Look', 4, ['hex'], 'enemy', `${R.evillook2Dmg} dmg and Exposed: its next hit taken does +${R.evillook2 * 100}%.`),
  // ---- Rare Gear ----
  mercy: card('mercy', 'Mercy Stroke', 2, ['strike'], 'enemy', `${R.mercy} dmg; a non-Boss enemy below ${R.mercyBelow * 100}% HP dies outright.`),
  whispercut: card('whispercut', 'Whisper Cut', 1, ['venom', 'hasten'], 'enemy', `${R.whispercut} dmg and Bleed ${R.whispercutBleed} every ${R.pulse}s for ${R.whispercutSecs}s; your next card takes ${R.whispercutCut}s less.`),
  shatter: card('shatter', 'Shatter', 5, ['strike', 'hinder'], 'enemy', `${R.shatter} dmg, −${R.shatterSunder} Block on it for the fight, and Delay it ${R.shatterDelay}s.`),
  earthblow: card('earthblow', 'Earthblow', 7, ['strike', 'hinder'], 'none', `${R.earthblow} dmg to the two nearest enemies; both are Slowed (+${R.earthblowSlow}s on each action) for ${R.earthblowSecs}s.`),
  doublehex: card('doublehex', 'Double Hex', 1.5, ['hex'], 'enemy', 'Copy the last debuff you placed in this fight onto an enemy (with none: Exposed).'),
  bloom: card('bloom', 'Verdant Bloom', 5, ['mend'], 'none', `Every ally: Regen ${R.bloomRegen} every ${R.pulse}s for ${R.bloomSecs}s.`),
  glass: card('glass', 'Turn the Glass', 1, ['hasten'], 'none', 'The last card you played in this fight goes back into your hand (with none: discard your leftmost card and draw).'),
  scaleward: card('scaleward', 'Scale Ward', 3, ['guard'], 'none', `+${R.scaleWard} Shield; until your next turn, whatever hits you takes ${R.scaleWardSpikes}.`),
  fade: card('fade', 'Fade', 1, ['guard', 'hasten'], 'none', `The next attack aimed at you misses; your next card takes ${R.fadeCut}s less.`),
  runeward: card('runeward', 'Rune Ward', 2, ['guard'], 'none', `Every ally +${R.runeWard} Shield.`),
  bulwark: card('bulwark', 'Bulwark', 4, ['guard', 'hinder'], 'none', `+${R.bulwark} Shield; step to the front of the line; Delay the nearest enemy ${R.bulwarkDelay}s.`),
  liestill: card('liestill', 'Lie Still', 2, ['mend'], 'none', `Heal yourself ${R.lieStillHeal}; snuff ${R.lieStillLight} of your light; step to the back of the line.`),
  slipaway: card('slipaway', 'Slip Away', 1, ['hasten'], 'none', 'Flee for certain, losing no light, down any tunnel (at the exit: escape).'),
  blink: card('blink', 'Blink', 1, ['hasten'], 'none', 'Step to the back of the line; the next attack aimed at you misses.'),
  veil: card('veil', 'Veil', 1, ['guard'], 'ally', "An ally's (or your) next incoming attack misses."),
  luckybreak: card('luckybreak', 'Lucky Break', 1, ['hasten'], 'none', 'Discard your hand and draw a new one.'),
  feverdream: card('feverdream', 'Fever Dream', 1, ['conjure'], 'none', `Snuff ${R.feverLight} of your light; your Conjure cards take half their time for the rest of this fight.`),
  bloodrush: card('bloodrush', 'Blood Rush', 1, ['hasten'], 'none', `Lose ${R.bloodRushHp} HP; Haste: your cards take ${R.bloodRushHaste}s less for ${R.bloodRushSecs}s.`),
  ashes: card('ashes', 'Ashes', 2, ['hex', 'light'], 'none', `Spend up to ${R.ashesLight} light: every enemy is Weak for 1 turn (2 turns if you spent the full ${R.ashesLight}).`),
  // ---- Legendary ----
  promise: card('promise', 'Promise', 1, ['strike'], 'none', `The strongest foe here that isn't a Boss dies as faint laughter echoes. With only a Boss left, ${R.promiseBoss} dmg to it.`, true),
  quake: card('quake', 'Quake', 6, ['strike', 'hinder'], 'none', `${R.quake} dmg to every enemy; every enemy is Stunned.`),
  unmake: card('unmake', 'Unmake', 3, ['hex'], 'none', 'Every monster in this fight simply ceases to be: no loot, no Corpses.', true),
  redeem: card('redeem', 'Redeem', 4, ['mend'], 'ally', 'An ally (or you): full HP, but their light goes out.', true),
  bastion: card('bastion', 'Bastion', 4, ['guard'], 'none', `Shield equal to ${R.bastionPerBlock} × your Block.`),
  forgive: card('forgive', 'Forgive', 5, ['mend'], 'none', `A downed or dead ally here lives again at full HP. With nobody down, heal the most hurt ally ${R.forgiveHeal}.`, true),
  howl: card('howl', 'Howl', 4, ['conjure'], 'none', 'A Wolf joins you for the rest of the run (at most 4; with more, heal them instead).'),
  waystep: card('waystep', 'Waystep', 1, ['hasten'], 'room', 'Leave the fight for any room on your map.'),
  oil: card('oil', "Elder's Oil", 1, ['light'], 'none', "Your light to full. (The Elder's blessing, for this run.)", true),
  fumble: card('fumble', 'Fumble', 3, [], 'none', 'Nothing: an empty Gear slot.'),
};

/** A card picture's main motif: one per kind of effect (tools/card_art.py draws them), or a summon's own sprite. */
export type CardMotif =
  | 'shield' | 'crack' | 'spikes' | 'gate' | 'dagger' | 'hammer' | 'stun' | 'hand' | 'smoke' | 'flame' | 'heal' | 'lamp' | 'leaf'
  | 'sun' | 'eye' | 'wilt' | 'blood' | 'swirl' | 'hourglass' | 'spade' | 'skull' | 'grave' | 'burst' | 'bell' | 'waves' | 'whip'
  | 'flask' | 'venom' | 'dodge' | 'target' | 'veil' | 'door' | 'cards' | 'void'
  | 'rat' | 'shade' | 'imp' | 'ghoul' | 'wolf';
/** The small badge for a card's second effect. */
export type CardMark =
  | 'hourglass' | 'front' | 'back' | 'swirl' | 'shield' | 'spikes' | 'sword' | 'venom' | 'wing' | 'sun' | 'heal' | 'eye' | 'star'
  | 'bone' | 'skull' | 'blood' | 'cards' | 'crack' | 'flask' | 'flame';

const art = (motif: CardMotif, mark?: CardMark) => ({ motif, ...(mark ? { mark } : {}) });

/**
 * Card pictures (user, 2026-10-13): the motif is the card's main effect, the mark its second, so alike cards look alike
 * (every Shield card shows the shield, every Hurry the wing…). The background is the first school's tint. Only a
 * Common and Uncommon of one kind share a picture (their frames differ).
 */
export const CARD_ART: Record<CardId, { motif: CardMotif; mark?: CardMark }> = {
  bash: art('shield', 'hourglass'),
  cover: art('shield', 'front'),
  vengeance: art('spikes'),
  rally: art('shield', 'swirl'),
  slam: art('crack', 'shield'),
  gate: art('gate', 'spikes'),
  backstab: art('dagger', 'back'),
  cheap: art('stun', 'sword'),
  envenom: art('dagger', 'venom'),
  signal: art('hand', 'wing'),
  smoke: art('smoke'),
  dance: art('dagger', 'wing'),
  flare: art('flame', 'sun'),
  mend: art('heal', 'sun'),
  vigil: art('lamp', 'swirl'),
  kindle: art('lamp', 'flame'),
  sanctuary: art('leaf', 'sun'),
  dawn: art('sun', 'heal'),
  hex: art('eye', 'sword'),
  wither: art('wilt'),
  pact: art('blood', 'sword'),
  familiar: art('imp'),
  bargain: art('swirl', 'wing'),
  ages: art('hourglass', 'eye'),
  spade: art('spade'),
  rites: art('skull', 'sword'),
  raise: art('grave'),
  explode: art('burst', 'bone'),
  graveward: art('shield', 'bone'),
  graves: art('ghoul', 'bone'),
  clang: art('bell', 'hourglass'),
  knell: art('bell', 'skull'),
  peal: art('bell', 'wing'),
  ringout: art('waves', 'hourglass'),
  echo: art('waves', 'cards'),
  reverberate: art('bell', 'star'),
  scourge: art('whip'),
  absolution: art('swirl', 'sword'),
  sins: art('hand', 'swirl'),
  flagellate: art('whip', 'blood'),
  penance: art('swirl', 'shield'),
  rapture: art('swirl', 'sun'),
  acid: art('flask', 'venom'),
  fumes: art('venom'),
  mist: art('heal', 'flask'),
  elixir: art('flask', 'star'),
  catalyst: art('venom', 'star'),
  opus: art('flask', 'cards'),
  stab1: art('dagger'),
  stab2: art('dagger'),
  thump1: art('hammer', 'hourglass'),
  thump2: art('hammer', 'hourglass'),
  soothe1: art('heal'),
  soothe2: art('heal'),
  sidestep1: art('dodge'),
  sidestep2: art('dodge'),
  braceup1: art('shield'),
  braceup2: art('shield'),
  wick1: art('lamp'),
  wick2: art('lamp', 'heal'),
  mutter1: art('rat'),
  mutter2: art('shade'),
  evillook1: art('target'),
  evillook2: art('target', 'sword'),
  mercy: art('dagger', 'skull'),
  whispercut: art('dagger', 'blood'),
  shatter: art('crack', 'hourglass'),
  earthblow: art('hammer', 'crack'),
  doublehex: art('eye', 'cards'),
  bloom: art('leaf'),
  glass: art('hourglass', 'cards'),
  scaleward: art('shield', 'spikes'),
  fade: art('veil', 'wing'),
  runeward: art('shield', 'sun'),
  bulwark: art('gate', 'shield'),
  liestill: art('heal', 'back'),
  slipaway: art('door', 'wing'),
  blink: art('veil', 'back'),
  veil: art('veil'),
  luckybreak: art('cards'),
  feverdream: art('swirl', 'bone'),
  bloodrush: art('blood', 'wing'),
  ashes: art('wilt', 'sun'),
  promise: art('skull'),
  quake: art('crack', 'star'),
  unmake: art('void'),
  redeem: art('heal', 'swirl'),
  bastion: art('gate'),
  forgive: art('grave', 'heal'),
  howl: art('wolf'),
  waystep: art('door'),
  oil: art('lamp', 'star'),
  fumble: art('hand'),
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function isCardId(id: unknown): id is CardId {
  return typeof id === 'string' && id in CARDS;
}

/** Each class's six cards: five that reshuffle and one Burn (last). */
export const CLASS_CARDS: Record<ClassId, CardId[]> = {
  warden: ['bash', 'cover', 'vengeance', 'rally', 'slam', 'gate'],
  cutthroat: ['backstab', 'cheap', 'envenom', 'signal', 'smoke', 'dance'],
  lampbearer: ['flare', 'mend', 'vigil', 'kindle', 'sanctuary', 'dawn'],
  sorceress: ['hex', 'wither', 'pact', 'familiar', 'bargain', 'ages'],
  undertaker: ['spade', 'rites', 'raise', 'explode', 'graveward', 'graves'],
  bellwright: ['clang', 'knell', 'peal', 'ringout', 'echo', 'reverberate'],
  zealot: ['scourge', 'absolution', 'sins', 'flagellate', 'penance', 'rapture'],
  alchemist: ['acid', 'fumes', 'mist', 'elixir', 'catalyst', 'opus'],
};

/** Gear kinds that share a card: the six Gear types plus amulets and rings. */
export type CardKind = GearType | 'amulet' | 'ring';

/** The card Commons (index 0) and Uncommons (index 1) of each kind share. Rares and Legendaries have their own. */
export const TYPE_CARDS: Record<CardKind, [CardId, CardId]> = {
  dagger: ['stab1', 'stab2'],
  hammer: ['thump1', 'thump2'],
  staff: ['soothe1', 'soothe2'],
  leather: ['sidestep1', 'sidestep2'],
  mail: ['braceup1', 'braceup2'],
  cloth: ['wick1', 'wick2'],
  amulet: ['mutter1', 'mutter2'],
  ring: ['evillook1', 'evillook2'],
};

/** "Shield Bash · 5s · ⚔⏳": a card's head line. */
export function cardLine(id: CardId): string {
  const c = CARDS[id];
  const schools = c.schools.map((s) => SCHOOLS[s].glyph).join('');
  return `${c.name} · ${c.time}s${schools ? ` · ${schools}` : ''}${c.burn ? ' · Burn' : ''}`;
}

/** The card text with its head line: what tooltips show. */
export function cardText(id: CardId): string {
  return `${cardLine(id)}: ${CARDS[id].desc}`;
}

export type { GearSlot };
