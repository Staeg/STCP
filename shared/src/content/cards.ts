import type { ClassId } from './classes';
import type { GearSlot, GearType } from './items';

/**
 * Card combat (M15, user 2026-10-13). Every hero fights from a deck: their class's six cards plus one card for each
 * worn piece of Gear (Fumble for an empty slot). A fight starts with a hand of three; playing a card draws the next.
 * Each card says how long it is until the hero's next action (its `time`); Speed only sets the wait for the first.
 * Burn cards leave the deck for the rest of the run. Every card always does something when played (a weaker
 * fallback is written into the text of the ones that need something to work on).
 */

/** Card schools: what a card does, its main effect first (its picture shows the first two). Gear passives key off them. */
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
  hex: { name: 'Hex', glyph: '⛧', tint: ['#36122c', '#642452'], desc: 'Hexed, Weak, Exposed and Blind.' },
  light: { name: 'Light', glyph: '☀', tint: ['#363010', '#68591e'], desc: 'Light, spent or shared.' },
};

/**
 * enemy: any enemy · enemyFirst: the nearest enemy (no pick) · ally: any conscious character in the fight, you included ·
 * room: a room on your map · none: nothing to pick (all enemies, all allies, yourself, or chosen for you).
 *
 * Card wording (user, 2026-10-17): "ally" means everyone on your side, you and summons included; "another ally" or
 * "other allies" leaves you out; "character" leaves summons out (heroes only). A card aimed at an ally can only be
 * aimed at a character, so its text says "a character".
 */
export type CardTarget = 'enemy' | 'enemyFirst' | 'ally' | 'room' | 'none';

export type CardId =
  // Warden
  | 'bash' | 'cover' | 'thornwall' | 'rally' | 'slam' | 'gate'
  // Cutthroat
  | 'backstab' | 'cheap' | 'envenom' | 'signal' | 'smoke' | 'dance'
  // Lampbearer
  | 'flare' | 'mend' | 'vigil' | 'kindle' | 'sanctuary' | 'dawn'
  // Sorceress
  | 'hex' | 'wither' | 'pact' | 'familiar' | 'bargain' | 'ages'
  // Undertaker
  | 'spade' | 'rites' | 'raise' | 'explode' | 'embalm' | 'graves'
  // Bellwright
  | 'clang' | 'knell' | 'peal' | 'ringout' | 'echo' | 'reverberate'
  // Zealot
  | 'scourge' | 'absolution' | 'sins' | 'martyrdom' | 'penance' | 'rapture'
  // Alchemist
  | 'acid' | 'fumes' | 'contagion' | 'elixir' | 'catalyst' | 'opus'
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
  // Found cards: events add them to a deck for the rest of the run (user, 2026-10-16)
  | 'riposte' | 'parry' | 'ember' | 'shard' | 'oathstrike' | 'snakeeyes' | 'unmaking' | 'halting' | 'borrowed'
  // Level-up cards (user, 2026-10-17): a Character learns one per level and can swap it in for a class card
  | 'aegis' | 'linked' | 'mirror' | 'banner' | 'phalanx'
  | 'marked' | 'flurry' | 'coup' | 'misdirect' | 'cuts'
  | 'hymn' | 'lightwell' | 'halo' | 'march' | 'eternal'
  | 'puppet' | 'surge' | 'witching' | 'bloodmoon' | 'wander'
  | 'danse' | 'plague' | 'preserve' | 'claim' | 'lord'
  | 'bellguard' | 'resonant' | 'discord' | 'metronome' | 'tollthee'
  | 'eclipse' | 'brand' | 'bloodforblood' | 'purge' | 'litany'
  | 'mutagen' | 'bottomless' | 'corrosive' | 'flash' | 'distill'
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
  bash: 5, bashPerShield: 0.5, bashDelay: 2,
  coverShield: 8,
  thornwallShield: 5,
  rallyShield: 6,
  slamMin: 6, slamDelayPer: 3,
  gateShield: 10, gateSecs: 12, gateDelay: 2,
  // ---- Cutthroat ----
  backstab: 6, backstabSneakCrit: 3,
  cheap: 2,
  envenom: 2, envenomPoison: 3, envenomTurns: 3, envenomSneakTurns: 6,
  signalHurry: 3, signalLoudHurry: 5,
  smokeSecs: 8,
  danceSecs: 10, danceSneakSecs: 15,
  // ---- Lampbearer ----
  flare: 4, flareLight: 10,
  mend: 8, mendBright: 12,
  vigilLight: 15,
  kindleBase: 4, kindleLight: 20, kindleMax: 14,
  sanctuaryRegen: 2, sanctuarySecs: 10, sanctuaryBrightSecs: 16,
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
  explode: 8, explodeBare: 3, explodePerDecay: 2,
  embalmHeal: 6, embalmBare: 3,
  // ---- Bellwright ----
  clang: 8, clangDelay: 4, clangTurns: 2, clangHaste: 0.5,
  knell: 15, knellPerAlly: 5, knellMin: 3, knellPerClang: 2,
  pealHurry: 4, pealPerClang: 1, pealAloneClang: 2,
  ringOutDelay: 3, ringOutPerClang: 1.5,
  echoMult: 0.5, echoBare: 3, echoFullAt: 3,
  // ---- Zealot ----
  scourge: 7,
  absolutionBase: 6, absolutionFloor: 50,
  sinsLight: 25, sinsSelf: 15,
  martyrdomLight: 15,
  penanceLight: 10, penanceDiv: 3,
  rapture: 15, raptureLight: 20,
  // ---- Alchemist ----
  acid: 5, acidTurns: 2, acidBonus: 2,
  fumesPoison: 3, fumesTurns: 3,
  contagionPoison: 2, contagionTurns: 3,
  catalystPoison: 2, catalystTurns: 2,
  opusItems: 4, opusItemTime: 1,
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
  // ---- Found cards ----
  riposte: 8, riposteDelay: 2,
  ember: 8, emberLight: 8,
  shardBare: 3,
  oathstrike: 12,
  /** Word of Unmaking: an enemy of this tier or above (Bone Giant, Queen, Lich, Dead King) loses half its HP instead of dying. */
  unmakingTier: 2,
  // ---- Level-up cards (user, 2026-10-17) ----
  aegisMin: 6, aegisBounce: 0.5, aegisCost: 0.5,
  linkedShield: 6,
  mirrorShield: 5,
  bannerShield: 2,
  markedHits: 2,
  flurry: 3, flurryHits: 3,
  coup: 6,
  misdirect: 1, misdirectSneak: 2,
  cutsStart: 1,
  hymnLight: 20, hymnCap: 150, radiantMult: 0.2,
  wellLight: 5, wellHeal: 2,
  haloSecs: 12, haloHeal: 2,
  marchPer: 20,
  eternalFloor: 25, eternalBonus: 2,
  puppet: 1, puppetAnima: 2,
  surgePer: 0.5, surgeBare: 0.25,
  witchingSecs: 15,
  bloodMoonHp: 6, bloodMoonSecs: 10, lifesteal: 0.5,
  wander: 4, wanderAnima: 2,
  plaguePoison: 2, plagueTurns: 2, plagueHeal: 3,
  preserveBare: 4,
  claimHp: 0.5,
  lordCap: 6,
  bellguardPer: 2, bellguardMin: 2,
  resonant: 7,
  discordClang: 1,
  metronomeSecs: 12, metronomeTime: 3,
  tollthee: 8, tolltheePer: 3,
  brand: 6, brandPer: 10,
  bloodHp: 8, bloodHeal: 16, bloodBare: 8,
  purgeLight: 20, purge: 8,
  litany: 4, litanyPer: 25, litanyMax: 5,
  mutagenSecs: 12, mutagenMult: 0.5, mutagenRegen: 1, mutagenWeak: 2,
  flash: 2,
  distillMult: 1.5, distillPoison: 2, distillTurns: 3,
  corrosive: 1,
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
  // ---- Warden: Shield above all (M16): gained, shared, kept (Stalwart) and turned into damage ----
  bash: card('bash', 'Shield Bash', 4, ['strike', 'hinder'], 'enemyFirst', `${R.bash} dmg +1 per ${1 / R.bashPerShield} Shield you have to the nearest enemy; Delay it ${R.bashDelay}s.`),
  cover: card('cover', 'Cover', 3, ['guard'], 'ally', `A character +${R.coverShield} Shield; you step to the front of the line.`),
  thornwall: card('thornwall', 'Thornwall', 3, ['guard', 'strike'], 'none', `+${R.thornwallShield} Shield. Until your next turn, whatever your Shield stops is dealt back to the attacker.`),
  rally: card('rally', 'Rally', 4, ['guard'], 'none', `Every ally +${R.rallyShield} Shield.`),
  slam: card('slam', 'Shield Slam', 5, ['strike', 'hinder'], 'enemyFirst', `Damage equal to your Block + Shield (at least ${R.slamMin}) to the nearest enemy; Delay it 1s per ${R.slamDelayPer} damage dealt.`),
  gate: card('gate', 'Hold the Gate', 6, ['guard', 'hinder'], 'none', `Every ally +${R.gateShield} Shield. For ${R.gateSecs}s, every enemy whose blow lands on a character's Shield is Delayed ${R.gateDelay}s.`, true),
  // ---- Cutthroat: Ambush and quick cards ----
  backstab: card('backstab', 'Backstab', 2.5, ['strike'], 'enemy', `${R.backstab} dmg; ×2 against an enemy that is Stunned, Exposed or hasn't acted yet. Sneaking: ×${R.backstabSneakCrit} instead.`),
  cheap: card('cheap', 'Cheap Shot', 3, ['hinder', 'strike'], 'enemy', `${R.cheap} dmg and Stun. Sneaking: it's Exposed too.`),
  envenom: card('envenom', 'Envenom', 2, ['venom', 'strike'], 'enemy', `${R.envenom} dmg and Poison ${R.envenomPoison} for ${R.envenomTurns} turns. Sneaking: for ${R.envenomSneakTurns} turns.`),
  signal: card('signal', 'Hand Signal', 1, ['hasten', 'hex'], 'ally', `Hurry a character ${R.signalHurry}s, and their next hit Exposes its target. Not Sneaking: Hurry ${R.signalLoudHurry}s.`),
  smoke: card('smoke', 'Smoke Bomb', 3, ['guard', 'hasten'], 'none', `Every ally: 50% Dodge, and fleeing always works, for ${R.smokeSecs}s. Sneaking: your next Flee is a Sneak Past.`),
  dance: card('dance', 'Blade Dance', 1, ['hasten'], 'none', `For ${R.danceSecs}s every card you play takes 1s, and Backstab always crits. Sneaking: ${R.danceSneakSecs}s.`, true),
  // ---- Lampbearer: light as a resource ----
  flare: card('flare', 'Flare', 4, ['strike', 'light'], 'none', `${R.flare} dmg to every enemy; +${R.flareLight} light to everyone here.`),
  mend: card('mend', 'Mend', 4, ['mend'], 'ally', `Heal a character ${R.mend} and cure Poison and Bleed. Bright: heal ${R.mendBright}.`),
  vigil: card('vigil', 'Vigil', 4, ['light'], 'ally', `A character +${R.vigilLight} light. If you're the only character in the fight, every enemy action until your next turn sets off a free Flare.`),
  kindle: card('kindle', 'Kindle', 5, ['strike', 'light'], 'enemy', `Spend up to ${R.kindleLight} of your light: ${R.kindleBase} dmg +1 per 2 light spent (at most ${R.kindleMax}); Blind it if you spent the full ${R.kindleLight}.`),
  sanctuary: card('sanctuary', 'Sanctuary', 5, ['mend', 'light'], 'none', `Every ally: Regen ${R.sanctuaryRegen} every ${R.pulse}s for ${R.sanctuarySecs}s. Bright: for ${R.sanctuaryBrightSecs}s.`),
  dawn: card('dawn', 'Dawn', 6, ['mend', 'light', 'hex'], 'none', `Every ally heals ${R.dawnHeal}; every character's light goes to full. Every enemy is Blinded.`, true),
  // ---- Sorceress: Hex, blood and familiars; each "Anima:" clause spends 1 Anima, if she has any (M16) ----
  hex: card('hex', 'Hex', 3.5, ['hex', 'strike'], 'enemy', `${R.hex} dmg and Hexed for ${R.hexedTurns} turns: Hex deals +100% to it per Hexed stack. Anima: two stacks.`),
  wither: card('wither', 'Wither', 3, ['hex'], 'none', `Every enemy is Weak for ${R.witherTurns} turns (−50% damage per stack). Anima: Hexed too.`),
  pact: card('pact', 'Blood Pact', 6, ['strike'], 'none', `Every ally loses ${R.pactCost} HP (never below 1). ${R.pact} dmg to every enemy. Anima: it costs nobody any HP.`),
  familiar: card('familiar', 'Bound Familiar', 5, ['conjure'], 'none', `Summon an Imp for this fight (its bite adds Hexed). At most ${R.familiarMax}; with more, heal your Imps instead. Anima: two at once.`),
  bargain: card('bargain', 'Mad Bargain', 1, ['hasten'], 'none', `Lose ${R.bargainHp} HP (never below 1): +1 Anima, and your next card takes 1s.`),
  ages: card('ages', 'Curse of Ages', 4, ['hex', 'hinder'], 'none', `Every enemy gains ${R.agesStacks} Hexed stacks, then is Delayed ${R.agesDelayPer}s per Hexed stack it carries. Anima: spends all of it, +1 Hexed stack per Anima first.`, true),
  // ---- Undertaker: Corpses, executions, and a following of the dead that decays (M16) ----
  spade: card('spade', 'Spade', 5, ['strike'], 'enemy', `${R.spade} dmg, +${R.spadePerRites} for every enemy your Last Rites has killed this run.`),
  rites: card('rites', 'Last Rites', 5, ['strike'], 'enemy', `Kill an enemy below ${R.ritesBelow * 100}% HP outright; otherwise (or a Boss) ${R.rites} dmg.`),
  raise: card('raise', 'Raise', 5, ['conjure'], 'none', 'Use up a Corpse: it rises at full HP and follows you for good. With no Corpse, a Rat claws up and follows you.'),
  explode: card('explode', 'Corpse Explosion', 4, ['strike', 'conjure'], 'none', `Use up a Corpse: ${R.explode} dmg to every enemy. With no Corpse, your most decayed undead here bursts instead: ${R.explode} +${R.explodePerDecay} per decay. With neither, ${R.explodeBare}.`),
  embalm: card('embalm', 'Embalm', 2, ['mend', 'conjure'], 'none', `Every undead of yours here heals ${R.embalmHeal} and sheds one decay. With none, +${R.embalmBare} Shield.`),
  graves: card('graves', 'Open the Graves', 6, ['conjure'], 'none', 'Every Corpse here rises and follows you for good (at least one Ghoul claws up).', true),
  // ---- Bellwright: Clang as a resource (M16): Clang, Peal, Reverberate and Ring In build it; Knell and Ring Out spend it ----
  clang: card('clang', 'Clang', 6, ['strike', 'hinder', 'hasten'], 'enemyFirst', `${R.clang} dmg to the nearest enemy; Delay it ${R.clangDelay}s. You gain a Clang stack (your cards take ${R.clangHaste}s less per stack; one fades every ${R.clangTurns} turns).`),
  knell: card('knell', 'Knell', 8, ['strike'], 'none', `${R.knell} dmg to every enemy, −${R.knellPerAlly} for each other character standing in the fight (at least ${R.knellMin}), +${R.knellPerClang} per Clang stack. Spends every Clang.`),
  peal: card('peal', 'Peal', 4, ['hasten'], 'none', `Hurry every other ally ${R.pealHurry}s, +${R.pealPerClang}s per Clang stack. With no other character here: +${R.pealAloneClang} Clang.`),
  ringout: card('ringout', 'Ring Out', 4, ['hinder'], 'none', `Delay every enemy ${R.ringOutDelay}s, +${R.ringOutPerClang}s per Clang stack. Spends every Clang.`),
  echo: card('echo', 'Echo', 3, ['hasten'], 'none', `Your last card (never a Burn) happens again at half power; at full power with ${R.echoFullAt}+ Clang. With nothing to echo, ${R.echoBare} dmg to the nearest enemy.`),
  reverberate: card('reverberate', 'Reverberate', 3, ['hinder', 'hasten'], 'none', "Every enemy is Stunned; every other ally's next action comes now. +1 Clang per enemy.", true),
  // ---- Zealot: darkness as fuel ----
  scourge: card('scourge', 'Scourge', 3.5, ['strike'], 'enemy', `${R.scourge} dmg.`),
  absolution: card('absolution', 'Absolution', 5, ['strike', 'light'], 'none', `${R.absolutionBase} dmg plus the light you lack below ${R.absolutionFloor}, split across enemies; you regain that much light.`),
  sins: card('sins', 'Take Their Sins', 3, ['light'], 'ally', `Give a character up to ${R.sinsLight} of your light (on yourself: snuff ${R.sinsSelf} of it).`),
  martyrdom: card('martyrdom', 'Martyrdom', 1, ['hasten', 'light'], 'none', `Snuff ${R.martyrdomLight} of your light; your next card takes 1s.`),
  penance: card('penance', 'Penance', 2, ['guard', 'light'], 'none', `Snuff ${R.penanceLight} of your light, then gain Shield equal to a third of the light you lack.`),
  rapture: card('rapture', 'Rapture', 5, ['strike', 'light'], 'enemy', `Every other character gains up to ${R.raptureLight} light, taken from yours; deal ${R.rapture} + half the light you lack to one enemy.`, true),
  // ---- Alchemist: brews and poisons ----
  acid: card('acid', 'Acid Flask', 4, ['venom', 'strike'], 'enemy', `${R.acid} dmg and a stack of Acid (−${R.acidBonus} Block each; one fades every ${R.acidTurns} of its turns); two stacks if it's Poisoned.`),
  fumes: card('fumes', 'Fumes', 5, ['venom'], 'none', `Poison ${R.fumesPoison} for ${R.fumesTurns} turns on every enemy.`),
  contagion: card('contagion', 'Contagion', 3, ['venom'], 'enemy', `Every Poison on an enemy spreads: each other enemy gets a copy. With none on it, Poison ${R.contagionPoison} for ${R.contagionTurns} turns on it.`),
  elixir: card('elixir', 'Elixir', 2, ['mend'], 'ally', "A character's next item has double effect."),
  catalyst: card('catalyst', 'Catalyst', 4, ['venom'], 'none', `Every enemy gets Poison ${R.catalystPoison} for ${R.catalystTurns} turns; then every Poison and Bleed on every enemy ticks once now.`),
  opus: card('opus', 'Opus Magnum', 4, ['mend', 'venom'], 'none', `Fill up to ${R.opusItems} empty pack slots with random consumables; your items take 1s for the rest of the fight.`, true),
  // ---- Level-up cards (user, 2026-10-17): a Character learns one a level; each swaps in for a class card ----
  aegis: card('aegis', 'Aegis Toss', 4, ['strike'], 'enemy', `Hurl your shield: damage equal to your Shield (at least ${R.aegisMin}) to an enemy, then it ricochets back down the line, each enemy behind it taking half what the one before took. Costs half your Shield.`),
  linked: card('linked', 'Linked Shields', 3, ['guard'], 'ally', `You and another character share one Shield pool for the rest of the fight (both Shields added together), +${R.linkedShield}. On yourself: +${R.linkedShield} Shield.`),
  mirror: card('mirror', 'Mirror Guard', 2, ['guard', 'hex'], 'none', `+${R.mirrorShield} Shield. The next debuff an enemy lays on any ally this fight is turned back on that enemy.`),
  banner: card('banner', 'War Banner', 4, ['guard'], 'none', `Plant a banner: for the rest of the fight every ally gains +${R.bannerShield} Shield at the start of each of their turns.`),
  phalanx: card('phalanx', 'Phalanx', 5, ['guard'], 'none', 'For the rest of the fight, whenever an ally gains Shield, every other ally gains half as much.', true),
  marked: card('marked', 'Marked for Death', 1, ['hex'], 'enemy', `Mark an enemy: the next ${R.markedHits} hits on it, from any ally, crit (×2).`),
  flurry: card('flurry', 'Flurry', 2.5, ['strike'], 'enemy', `${R.flurryHits} hits of ${R.flurry} on an enemy; each crits if it's Stunned or Exposed.`),
  coup: card('coup', 'Coup de Grâce', 2.5, ['strike', 'hasten'], 'enemy', `${R.coup} dmg. If it kills, it Chains: you act again at once.`),
  misdirect: card('misdirect', 'Misdirect', 1.5, ['hinder'], 'enemy', `Misdirected: the enemy's next attack hits another enemy (alone, itself). Sneaking: its next ${R.misdirectSneak}.`),
  cuts: card('cuts', 'Thousand Cuts', 1, ['strike'], 'none', `For the rest of the fight, after every card you play a random enemy takes ${R.cutsStart} dmg, and 1 more each time after.`, true),
  hymn: card('hymn', 'Radiant Hymn', 4, ['light'], 'none', `Every character +${R.hymnLight} light, which can overfill to ${R.hymnCap} this fight. Radiant characters (above 100 light) deal +${R.radiantMult * 100}%.`),
  lightwell: card('lightwell', 'Lightwell', 4, ['light', 'mend'], 'none', `A Lightwell for the rest of the fight: every character who plays a card here gains +${R.wellLight} light and heals ${R.wellHeal}.`),
  halo: card('halo', 'Halo', 4, ['mend'], 'ally', `A character wears a Halo for ${R.haloSecs}s: each time they're hit, every ally heals ${R.haloHeal}.`),
  march: card('march', "Lightbringer's March", 3, ['hasten', 'light'], 'none', `Hurry every ally 1s per ${R.marchPer} of your light.`),
  eternal: card('eternal', 'Eternal Lamp', 12, ['light'], 'none', `For the rest of the run your light can't fall below ${R.eternalFloor}, and everything you do is stronger: +${R.eternalBonus} to each hit you deal, and to all the healing and light you give.`, true),
  puppet: card('puppet', 'Puppet Strings', 4, ['hex', 'hinder'], 'enemy', `Charmed: the enemy's next action is an attack on its own side (alone, on itself). Anima: its next ${R.puppetAnima}.`),
  surge: card('surge', 'Anima Surge', 1, ['hex', 'hasten'], 'none', `Spend all your Anima: your next card is +${R.surgePer * 100}% stronger per Anima spent. With none, +${R.surgeBare * 100}%.`),
  witching: card('witching', 'Witching Hour', 3, ['hex'], 'none', `For ${R.witchingSecs}s, every debuff any ally lays on an enemy also adds a Hexed stack.`, true),
  bloodmoon: card('bloodmoon', 'Blood Moon', 4, ['mend'], 'none', `Lose ${R.bloodMoonHp} HP (never below 1). Lifesteal for ${R.bloodMoonSecs}s: every ally heals half the damage they deal. Anima: it costs no HP.`),
  wander: card('wander', 'Wandering Curse', 3, ['hex', 'strike'], 'enemy', `${R.wander} dmg and Hexed. When it dies, its Hexed stacks leap to another enemy. Anima: to ${R.wanderAnima} others.`),
  danse: card('danse', 'Danse Macabre', 3, ['hasten', 'conjure'], 'none', 'Every summon on your side acts now. With none, a Rat claws up and follows you.'),
  plague: card('plague', 'Plague Bearers', 3, ['venom', 'conjure', 'mend'], 'none', `Every summon here heals ${R.plagueHeal}, and for the rest of the fight every summon's attack Poisons ${R.plaguePoison} for ${R.plagueTurns} turns. With none here, the nearest enemy is Poisoned ${R.plaguePoison} for ${R.plagueTurns} turns too.`),
  preserve: card('preserve', 'Preserve', 2, ['conjure'], 'none', `Your strongest follower not yet Preserved is Preserved: it never decays, and the first blow that would destroy it leaves it at 1 HP. With none, +${R.preserveBare} Shield.`),
  claim: card('claim', 'Claim the Grave', 1, ['conjure', 'hex'], 'enemy', `Claim an enemy: when it dies, it rises at once at ${R.claimHp * 100}% HP and follows you (no Corpse needed).`),
  lord: card('lord', 'Lord of the Dead', 4, ['conjure'], 'none', `For the rest of the run your following holds ${R.lordCap} instead of 4, and every undead of yours sheds all its decay now.`, true),
  bellguard: card('bellguard', 'Bellguard', 4, ['guard'], 'none', `+${R.bellguardPer} Shield per Clang (at least ${R.bellguardMin}), and your Clang doesn't fade for the rest of the fight.`),
  resonant: card('resonant', 'Resonant Strike', 4, ['strike', 'hinder'], 'enemyFirst', `${R.resonant} dmg to the nearest enemy, and it's Ringing: the next time it's Delayed, it's Stunned too.`),
  discord: card('discord', 'Discord', 3, ['hinder', 'hasten'], 'ally', `The next enemy to act and a character trade places on the timeline, if the enemy would act first. +${R.discordClang} Clang.`),
  metronome: card('metronome', 'Metronome', 3, ['hasten'], 'none', `Cadence for ${R.metronomeSecs}s: every card any character here plays, yours included, takes exactly ${R.metronomeTime}s.`),
  tollthee: card('tollthee', 'Toll for Thee', 4, ['strike'], 'enemy', `Send not for me: for the rest of the fight, at the start of each of this enemy's turns it takes ${R.tollthee} + ${R.tolltheePer} per Clang you hold then.`, true),
  eclipse: card('eclipse', 'Eclipse', 2, ['light'], 'none', "Your light falls to 0. For the rest of the fight your Fervour adds to every ally's damage.", true),
  brand: card('brand', 'Brand', 4, ['strike', 'hex'], 'enemy', `${R.brand} dmg and Branded for the fight: it takes +1 from every source per ${R.brandPer} light you lack.`),
  bloodforblood: card('bloodforblood', 'Blood for Blood', 3, ['mend'], 'ally', `Lose ${R.bloodHp} HP (never below 1): another character heals ${R.bloodHeal}. With nobody else here, +${R.bloodBare} Shield instead (no HP lost).`),
  purge: card('purge', 'Purging Fire', 4, ['strike', 'light'], 'none', `Snuff ${R.purgeLight} of your light: ${R.purge} dmg to every enemy.`),
  litany: card('litany', 'Litany', 4, ['strike'], 'enemy', `${R.litany} dmg, again once for every ${R.litanyPer} light you lack (at most ${R.litanyMax} hits).`),
  mutagen: card('mutagen', 'Mutagen', 3, ['mend', 'venom'], 'ally', `A character is Mutated for ${R.mutagenSecs}s: +${R.mutagenMult * 100}% damage and Regen ${R.mutagenRegen}; then Weak for ${R.mutagenWeak} turns.`),
  bottomless: card('bottomless', 'Bottomless Flask', 2, ['mend'], 'none', "Your next item isn't used up. With an empty pack, a Bandage into it instead."),
  corrosive: card('corrosive', 'Corrosive Cloud', 4, ['venom'], 'none', `Every enemy gets ${R.corrosive} Acid stack (2 if Poisoned), and again at the start of each of its turns for the rest of the fight.`, true),
  flash: card('flash', 'Flash Powder', 3, ['hex', 'strike'], 'none', `${R.flash} dmg to every enemy, and every enemy is Blinded.`),
  distill: card('distill', 'Distillation', 4, ['venom'], 'enemy', `Every Poison on an enemy deals all it has left at once, ×${R.distillMult}. With none on it, Poison ${R.distillPoison} for ${R.distillTurns} turns.`),
  // ---- Gear types: Commons are underwhelming, Uncommons match the nearest class card ----
  stab1: card('stab1', 'Stab', 2.5, ['strike'], 'enemy', `${R.stab1} dmg.`),
  stab2: card('stab2', 'Stab', 2.5, ['strike'], 'enemy', `${R.stab2} dmg.`),
  thump1: card('thump1', 'Thump', 5, ['strike', 'hinder'], 'enemyFirst', `${R.thump1} dmg to the nearest enemy; Delay it ${R.thump1Delay}s.`),
  thump2: card('thump2', 'Thump', 5, ['strike', 'hinder'], 'enemyFirst', `${R.thump2} dmg to the nearest enemy; Delay it ${R.thump2Delay}s.`),
  soothe1: card('soothe1', 'Soothe', 4, ['mend'], 'ally', `Heal a character ${R.soothe1}.`),
  soothe2: card('soothe2', 'Soothe', 4, ['mend'], 'ally', `Heal a character ${R.soothe2}.`),
  sidestep1: card('sidestep1', 'Sidestep', 2, ['guard'], 'none', `${R.sidestep1 * 100}% Dodge until your next turn.`),
  sidestep2: card('sidestep2', 'Sidestep', 2, ['guard'], 'none', `${R.sidestep2 * 100}% Dodge for ${R.sidestep2Secs}s.`),
  braceup1: card('braceup1', 'Brace Up', 3, ['guard'], 'none', `+${R.braceup1} Shield.`),
  braceup2: card('braceup2', 'Brace Up', 3, ['guard'], 'none', `+${R.braceup2} Shield.`),
  wick1: card('wick1', 'Trim the Wick', 2, ['light'], 'none', `+${R.wick1} light.`),
  wick2: card('wick2', 'Trim the Wick', 3, ['light'], 'ally', `A character +${R.wick2} light.`),
  mutter1: card('mutter1', 'Mutter', 5, ['conjure'], 'none', `Summon a Rat for this fight. At most ${R.summonMax}; with more, heal them instead.`),
  mutter2: card('mutter2', 'Mutter', 6, ['conjure'], 'none', `Summon a Shade for this fight. At most ${R.summonMax}; with more, heal them instead.`),
  evillook1: card('evillook1', 'Evil Look', 2, ['hex'], 'enemy', `Exposed: its next hit taken does +${R.evillook1 * 100}%.`),
  evillook2: card('evillook2', 'Evil Look', 4, ['hex', 'strike'], 'enemy', `${R.evillook2Dmg} dmg and Exposed: its next hit taken does +${R.evillook2 * 100}%.`),
  // ---- Rare Gear ----
  mercy: card('mercy', 'Mercy Stroke', 2, ['strike'], 'enemy', `${R.mercy} dmg; a non-Boss enemy below ${R.mercyBelow * 100}% HP dies outright.`),
  whispercut: card('whispercut', 'Whisper Cut', 1, ['venom', 'strike', 'hasten'], 'enemy', `${R.whispercut} dmg and Bleed ${R.whispercutBleed} every ${R.pulse}s for ${R.whispercutSecs}s; your next card takes ${R.whispercutCut}s less.`),
  shatter: card('shatter', 'Shatter', 5, ['strike', 'hinder'], 'enemy', `${R.shatter} dmg, −${R.shatterSunder} Block on it for the fight, and Delay it ${R.shatterDelay}s.`),
  earthblow: card('earthblow', 'Earthblow', 7, ['strike', 'hinder'], 'none', `${R.earthblow} dmg to the two nearest enemies; both are Slowed (+${R.earthblowSlow}s on each action) for ${R.earthblowSecs}s.`),
  doublehex: card('doublehex', 'Double Hex', 1.5, ['hex'], 'enemy', 'Copy the last debuff you placed in this fight onto an enemy (with none: Exposed).'),
  bloom: card('bloom', 'Verdant Bloom', 5, ['mend'], 'none', `Every ally: Regen ${R.bloomRegen} every ${R.pulse}s for ${R.bloomSecs}s.`),
  glass: card('glass', 'Turn the Glass', 1, ['hasten'], 'none', 'The last card you played in this fight goes back into your hand (with none: discard your leftmost card and draw).'),
  scaleward: card('scaleward', 'Scale Ward', 3, ['guard', 'strike'], 'none', `+${R.scaleWard} Shield; until your next turn, whatever hits you takes ${R.scaleWardSpikes}.`),
  fade: card('fade', 'Fade', 1, ['guard', 'hasten'], 'none', `The next attack aimed at you misses; your next card takes ${R.fadeCut}s less.`),
  runeward: card('runeward', 'Rune Ward', 2, ['guard'], 'none', `Every ally +${R.runeWard} Shield.`),
  bulwark: card('bulwark', 'Bulwark', 4, ['guard', 'hinder'], 'none', `+${R.bulwark} Shield; step to the front of the line; Delay the nearest enemy ${R.bulwarkDelay}s.`),
  liestill: card('liestill', 'Lie Still', 2, ['mend'], 'none', `Heal yourself ${R.lieStillHeal}; snuff ${R.lieStillLight} of your light; step to the back of the line.`),
  slipaway: card('slipaway', 'Slip Away', 1, ['hasten'], 'none', 'Flee for certain, losing no light, down any tunnel (at the exit: escape).'),
  blink: card('blink', 'Blink', 1, ['guard'], 'none', 'Step to the back of the line; the next attack aimed at you misses.'),
  veil: card('veil', 'Veil', 1, ['guard'], 'ally', "A character's next incoming attack misses."),
  luckybreak: card('luckybreak', 'Lucky Break', 1, ['hasten'], 'none', 'Discard your hand and draw a new one.'),
  feverdream: card('feverdream', 'Fever Dream', 1, ['hasten', 'conjure'], 'none', `Snuff ${R.feverLight} of your light; your Conjure cards take half their time for the rest of this fight.`),
  bloodrush: card('bloodrush', 'Blood Rush', 1, ['hasten'], 'none', `Lose ${R.bloodRushHp} HP; Haste: your cards take ${R.bloodRushHaste}s less for ${R.bloodRushSecs}s.`),
  ashes: card('ashes', 'Ashes', 2, ['hex', 'light'], 'none', `Spend up to ${R.ashesLight} light: every enemy is Weak for 1 turn (2 turns if you spent the full ${R.ashesLight}).`),
  // ---- Legendary ----
  promise: card('promise', 'Promise', 1, ['strike'], 'none', `The strongest foe here that isn't a Boss dies as faint laughter echoes. With only a Boss left, ${R.promiseBoss} dmg to it.`, true),
  quake: card('quake', 'Quake', 6, ['strike', 'hinder'], 'none', `${R.quake} dmg to every enemy; every enemy is Stunned.`),
  unmake: card('unmake', 'Unmake', 3, ['hex'], 'none', 'Every monster in this fight simply ceases to be: no loot, no Corpses.', true),
  redeem: card('redeem', 'Redeem', 4, ['mend'], 'ally', 'A character: full HP, but their light goes out.', true),
  bastion: card('bastion', 'Bastion', 4, ['guard'], 'none', `Shield equal to ${R.bastionPerBlock} × your Block.`),
  forgive: card('forgive', 'Forgive', 5, ['mend'], 'none', `A downed or dead character here lives again at full HP. With nobody down, heal the most hurt character ${R.forgiveHeal}.`, true),
  howl: card('howl', 'Howl', 4, ['conjure'], 'none', 'A Wolf joins you for the rest of the run (at most 4; with more, heal them instead).'),
  waystep: card('waystep', 'Waystep', 1, ['hasten'], 'room', 'Leave the fight for any room on your map.'),
  oil: card('oil', "Elder's Oil", 1, ['light'], 'none', "Your light to full. (The Elder's blessing, for this run.)", true),
  fumble: card('fumble', 'Fumble', 3, [], 'none', 'Nothing: an empty Gear slot.'),
  // ---- Found cards (user, 2026-10-16): from events, for the rest of the run ----
  riposte: card('riposte', 'Riposte', 2, ['guard', 'strike', 'hinder'], 'none', `The next attack aimed at you misses, and its attacker takes ${R.riposte} dmg and is Delayed ${R.riposteDelay}s.`),
  parry: card('parry', 'Parry', 5, ['guard'], 'none', 'The next attack aimed at you misses.'),
  ember: card('ember', 'Living Ember', 3, ['strike', 'light'], 'none', `${R.ember} dmg to every enemy; every character +${R.emberLight} light.`),
  shard: card('shard', 'Mirror Shard', 2, ['hasten'], 'none', `Your last card (never a Burn) happens again, at full power. With nothing to repeat, ${R.shardBare} dmg to the nearest enemy.`),
  oathstrike: card('oathstrike', 'Oathbound Strike', 2, ['strike'], 'enemy', `${R.oathstrike} dmg.`),
  snakeeyes: card('snakeeyes', 'Snake Eyes', 3, [], 'none', "Nothing: a losing throw at the Gambler's Table.", true),
  unmaking: card('unmaking', 'Word of Unmaking', 3, ['hex'], 'enemy', `An enemy dies outright; a Tier ${R.unmakingTier}+ one (Bone Giant and worse) loses half its HP instead.`, true),
  halting: card('halting', 'Halting Word', 2, ['hinder'], 'enemy', 'Stun an enemy.'),
  borrowed: card('borrowed', 'Borrowed Moment', 1, ['hasten'], 'none', 'Your next card takes 1s.', true),
};

/** Found cards: what card events add to a deck for the rest of the run (user, 2026-10-16). */
export const FOUND_CARDS: readonly CardId[] = ['riposte', 'parry', 'ember', 'shard', 'oathstrike', 'snakeeyes', 'unmaking', 'halting', 'borrowed'];

/** What the Weapon Rack and the Gambler's Table deal from: every found card but the duel's prize and the dud. */
export const FOUND_POOL: readonly CardId[] = ['parry', 'ember', 'shard', 'oathstrike', 'unmaking', 'halting', 'borrowed'];

/** A card picture's main motif: its first school's icon, a portal for a summoning card, or (for the two cards with no school) its own. */
export type CardMotif =
  | 'sword' | 'shield' | 'heal' | 'hourglass' | 'wing' | 'venom' | 'eye' | 'sun' | 'grave' | 'portal'
  | 'crack' | 'spikes' | 'gate' | 'dagger' | 'hammer' | 'stun' | 'hand' | 'smoke' | 'flame' | 'lamp' | 'leaf' | 'wilt' | 'blood'
  | 'swirl' | 'spade' | 'skull' | 'burst' | 'bell' | 'waves' | 'whip' | 'flask' | 'dodge' | 'target' | 'veil' | 'door' | 'cards' | 'void';
/** The small badge for a card's second school, or the creature a summoning card's portal brings. */
export type CardMark =
  | 'hourglass' | 'front' | 'back' | 'swirl' | 'shield' | 'spikes' | 'sword' | 'venom' | 'wing' | 'sun' | 'heal' | 'eye' | 'star'
  | 'bone' | 'skull' | 'blood' | 'cards' | 'crack' | 'flask' | 'flame'
  | 'imp' | 'rat' | 'shade' | 'wolf' | 'ghoul';

/** Each school's icon: big in the middle when it's a card's first school, small in the badge when it's the second. */
export const SCHOOL_ART: Record<School, { motif: CardMotif; mark: CardMark }> = {
  strike: { motif: 'sword', mark: 'sword' },
  guard: { motif: 'shield', mark: 'shield' },
  hinder: { motif: 'hourglass', mark: 'hourglass' },
  hasten: { motif: 'wing', mark: 'wing' },
  venom: { motif: 'venom', mark: 'venom' },
  mend: { motif: 'heal', mark: 'heal' },
  conjure: { motif: 'grave', mark: 'bone' },
  hex: { motif: 'eye', mark: 'eye' },
  light: { motif: 'sun', mark: 'sun' },
};

/** Summoning cards (user, 2026-10-18): a portal, with the creature it brings small in the badge. */
export const SUMMON_ART: Partial<Record<CardId, CardMark>> = { familiar: 'imp', mutter1: 'rat', mutter2: 'shade', howl: 'wolf', raise: 'ghoul', graves: 'ghoul' };

/**
 * Card pictures (user, 2026-10-17): the big motif is the card's main effect, which is its first school (a sword for
 * damage, a shield for Shield, a heart for healing…), and the badge its second school, so every card reads at a glance.
 * A summoning card shows a portal instead, with its creature in the badge.
 * The background is the first school's tint. A card's schools list its effects, main one first.
 */
export const CARD_ART: Record<CardId, { motif: CardMotif; mark?: CardMark }> = Object.fromEntries(
  (Object.keys(CARDS) as CardId[]).map((id) => {
    const summon = SUMMON_ART[id];
    if (summon) return [id, { motif: 'portal', mark: summon }];
    const [first, second] = CARDS[id].schools;
    const motif: CardMotif = first ? SCHOOL_ART[first].motif : id === 'snakeeyes' ? 'void' : 'hand';
    return [id, second ? { motif, mark: SCHOOL_ART[second].mark } : { motif }];
  }),
) as Record<CardId, { motif: CardMotif; mark?: CardMark }>;

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function isCardId(id: unknown): id is CardId {
  return typeof id === 'string' && id in CARDS;
}

/** Each class's six cards: five that reshuffle and one Burn (last). */
export const CLASS_CARDS: Record<ClassId, CardId[]> = {
  warden: ['bash', 'cover', 'thornwall', 'rally', 'slam', 'gate'],
  cutthroat: ['backstab', 'cheap', 'envenom', 'signal', 'smoke', 'dance'],
  lampbearer: ['flare', 'mend', 'vigil', 'kindle', 'sanctuary', 'dawn'],
  sorceress: ['hex', 'wither', 'pact', 'familiar', 'bargain', 'ages'],
  undertaker: ['spade', 'rites', 'raise', 'explode', 'embalm', 'graves'],
  bellwright: ['clang', 'knell', 'peal', 'ringout', 'echo', 'reverberate'],
  zealot: ['scourge', 'absolution', 'sins', 'martyrdom', 'penance', 'rapture'],
  alchemist: ['acid', 'fumes', 'contagion', 'elixir', 'catalyst', 'opus'],
};

/**
 * Level-up cards (user, 2026-10-17): five per class. Each time a Character gains XP (up to LEVEL_RULES.maxLevel) they
 * are offered three they don't know yet, learn one, and can swap it into their deck for one of their class cards.
 */
export const LEVELUP_CARDS: Record<ClassId, CardId[]> = {
  warden: ['aegis', 'linked', 'mirror', 'banner', 'phalanx'],
  cutthroat: ['marked', 'flurry', 'coup', 'misdirect', 'cuts'],
  lampbearer: ['hymn', 'lightwell', 'halo', 'march', 'eternal'],
  sorceress: ['puppet', 'surge', 'witching', 'bloodmoon', 'wander'],
  undertaker: ['danse', 'plague', 'preserve', 'claim', 'lord'],
  bellwright: ['bellguard', 'resonant', 'discord', 'metronome', 'tollthee'],
  zealot: ['eclipse', 'brand', 'bloodforblood', 'purge', 'litany'],
  alchemist: ['mutagen', 'bottomless', 'corrosive', 'flash', 'distill'],
};

/** Levels and the deck (user, 2026-10-17). */
export const LEVEL_RULES = {
  /** The highest level a Character can reach: each XP is a level, and each level a learned card. */
  maxLevel: 3,
  /** Class cards in a deck: always exactly this many. */
  deckSize: 6,
  /** Burn cards a deck may hold among its class cards. */
  maxBurns: 2,
  /** Level-up cards offered at once. */
  offer: 3,
};

/** Why these class cards can't be a Character's deck (given the cards they've learned), or null. */
export function deckError(cls: ClassId, deck: readonly CardId[], learned: readonly CardId[]): string | null {
  if (deck.length !== LEVEL_RULES.deckSize) return `A deck holds exactly ${LEVEL_RULES.deckSize} class cards.`;
  if (new Set(deck).size !== deck.length) return 'One of each card at most.';
  const known = [...CLASS_CARDS[cls], ...learned];
  for (const c of deck) if (!known.includes(c)) return `${CARDS[c]?.name ?? 'That card'} isn't one of theirs.`;
  if (deck.filter((c) => CARDS[c].burn).length > LEVEL_RULES.maxBurns) return `At most ${LEVEL_RULES.maxBurns} Burn cards in a deck.`;
  return null;
}

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
