import { CARD_RULES, CARDS, MIN_CARD_TIME, type CardId } from '../content/cards';
import { ENEMIES, type EnemyId } from '../content/enemies';
import { LIGHT_MAX, lightStage } from '../content/constants';
import { ITEMS } from '../content/items';
import { BOSS_TIER, LEGEND_RULES } from '../content/legends';
import {
  addClang, addPoison, afterBlock, applyMonsterDamage, at, combatOrder, damageMult, eternalBonus, flare, flee, followingOf, fumes, gainLight, gainShield,
  heal, heroBlock, heroHits, isConscious, leaveEncounter, makeRoom, monsterScale, monsterTakes, monstersIn, onDelayed, risenAll, risenName,
  risenSt, risenTakes, shieldPool, spendLight, stepToEnd, takeShield, type CombatEvent, type Encounter, type Monster, type Risen, type Slain, type Statuses,
} from './combat';
import { cycle, returnLast } from './deck';
import { buffLength, debuffCopies, debuffTurns, healBy, lightBy, markWitchwood, ward } from './gear';
import { forgive, unmakeFight, waystep, wolvesOf, summonWolf } from './legends';
import { giveItem, hasSpace, wornStat } from './loot';
import { brewRoll } from './skills';
import { extractHero, type Hero, type World } from './world';

/**
 * Card effects (M15). `playCard` resolves one card on its player's turn; every card does something whatever the board
 * looks like (the conditional ones fall back on something weaker). Numbers live in CARD_RULES.
 */

/** Debuffs Double Hex can copy: the last one each hero placed in this fight. */
export type DebuffKind = 'hexed' | 'weak' | 'acid' | 'poison' | 'bleed' | 'stun' | 'exposed' | 'slow' | 'blind';

export interface CardCtx {
  world: World;
  enc: Encounter;
  h: Hero;
  card: CardId;
  target?: string;
  room?: number;
  events: CombatEvent[];
  /** 1, or less for Echo. */
  power: number;
  /** The card played before this one in this fight (Turn the Glass). */
  prev: CardId | null;
  /** Seconds this hero's own next action comes sooner (Hand Signal or Peal on themself). */
  selfHurry: number;
  /** Coup de Grâce killed: the hero acts again at once. */
  chain?: boolean;
  /** Discord on yourself: the monster you trade places with on the timeline (after the card's time is known). */
  discord?: string;
}

const R = CARD_RULES;

// ---------------------------------------------------------------------------
// Timing

/** Tempo from what the hero wears (the Hourglass Staff). */
function wornTempo(h: Hero): number {
  let t = 0;
  for (const id of [h.weapon, h.armor, h.amulet, h.ring]) if (id) t += ITEMS[id].tempo ?? 0;
  return t;
}

/** Cards this hero has played in this fight so far. */
function playedIn(enc: Encounter, h: Hero): number {
  return enc.played?.[h.id] ?? 0;
}

/**
 * Seconds until this hero's next action if they play `card` now: its time, then Tempo, Clang, Haste, the next-card
 * effects (Mad Bargain, Fade…), first-card effects and passives. Never below MIN_CARD_TIME. `consume`: the next-card
 * effects are used up (when it's actually played).
 */
export function cardTime(world: World, enc: Encounter | null, h: Hero, card: CardId, consume = false): number {
  const def = CARDS[card];
  const st = h.st;
  let t = def.time;
  if ((st.dance ?? 0) > world.time) t = 1;
  if (def.schools.includes('conjure') && st.conjureHalf) t /= 2;
  if (def.schools.includes('venom')) t -= wornStat(h, 'venomCut');
  t += wornTempo(h);
  t -= (st.clang?.stacks ?? 0) * R.clangHaste;
  if (st.haste && st.haste.until > world.time) t -= st.haste.amount;
  if (st.slow && st.slow.until > world.time) t += st.slow.amount;
  if (st.quick) {
    if (st.quick.set !== undefined) t = Math.min(t, st.quick.set);
    t -= st.quick.cut;
    if (consume) delete st.quick;
  }
  if (enc && playedIn(enc, h) === 0) t -= wornStat(h, 'firstCardCut');
  // Metronome's Cadence: every card takes exactly this long.
  if ((st.cadence ?? 0) > world.time) t = R.metronomeTime;
  return Math.max(MIN_CARD_TIME, Math.round(t * 10) / 10);
}

/** How long a basic action takes: Brace, Flee, Revive, or using an item (Opus Magnum makes items quick). */
export function actionTime(h: Hero, action: 'brace' | 'flee' | 'revive' | 'item'): number {
  if (action === 'brace') return R.braceTime;
  if (action === 'flee') return R.fleeTime;
  if (action === 'revive') return R.reviveTime;
  return h.st.quickItems ? R.opusItemTime : R.itemTime;
}

/**
 * Why playing `card` now would do nothing useful (it can still be played: every card always does something), or null.
 * The fight screen dims such cards and bots skip them.
 */
export function uselessReason(world: World, enc: Encounter, h: Hero, card: CardId): string | null {
  const allies = enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  const hurt = allies.some((a) => a.hp < a.maxHp);
  const others = allies.filter((a) => a !== h);
  switch (card) {
    case 'fumble':
    case 'snakeeyes':
      return 'It does nothing.';

    case 'mend':
      return hurt || allies.some((a) => a.st.poison || a.st.bleed) ? null : 'Nobody is hurt.';
    case 'soothe1':
    case 'soothe2':
    case 'sanctuary':
    case 'bloom':
      return hurt ? null : 'Nobody is hurt.';
    case 'vigil':
      return allies.some((a) => a.light < LIGHT_MAX) || others.length === 0 ? null : 'Every lamp is full.';
    case 'wick2':
      return allies.some((a) => a.light < LIGHT_MAX) ? null : 'Every lamp is full.';
    case 'wick1':
    case 'oil':
      return h.light < LIGHT_MAX ? null : 'Your lamp is full.';
    case 'sins':
      return h.light > 0 && (others.some((a) => a.light < LIGHT_MAX) || h.cls === 'zealot') ? null : 'Nobody needs your light.';
    case 'elixir':
      return allies.some((a) => a.items.some((i) => ITEMS[i].kind === 'consumable')) ? null : 'Nobody has an item to drink.';
    case 'redeem':
      return hurt ? null : 'Nobody needs redeeming.';
    case 'forgive':
      return hurt || Object.values(world.heroes).some((o) => o !== h && !o.extracted && (o.dead ? !o.raised : o.downedAt !== null) && bodyHere(o, enc.room)) ? null : 'Nobody here needs forgiving.';
    case 'bloodforblood':
      return others.length === 0 || others.some((a) => a.hp < a.maxHp) ? null : 'Nobody else is hurt.';
    case 'halo':
      return null;
    case 'bottomless':
      return h.items.some((i) => ITEMS[i].kind === 'consumable') || hasSpace(h) ? null : 'Your pack is full of things that aren\'t items.';
    case 'surge':
      return null;
    default:
      return null;
  }
}

/** The Sorceress's Anima (M16): an "Anima:" clause spends one, if she has any. Returns whether it did. */
function anima(ctx: CardCtx): boolean {
  const { h } = ctx;
  if (h.anima <= 0) return false;
  h.anima--;
  ctx.events.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name} spends Anima. (${h.anima} left)` });
  return true;
}

/** The Bellwright rings out every Clang stack at once (Knell, Ring Out). Returns how many. */
function spendClang(h: Hero): number {
  const n = h.st.clang?.stacks ?? 0;
  delete h.st.clang;
  return n;
}

/** "Your next card takes this much less" (cumulative until a card is played). */
function quicken(h: Hero, cut: number) {
  h.st.quick = { ...(h.st.quick ?? { cut: 0 }), cut: (h.st.quick?.cut ?? 0) + cut };
}

// ---------------------------------------------------------------------------
// Corpses and summons

/** Corpses lying in this fight: every monster slain here, plus a Gravedigger's. */
export function corpses(enc: Encounter): number {
  return enc.slain?.length ?? 0;
}

/** Use up the newest Corpse here (a Zombie won't get back up from it, nor the Lich raise it). */
export function takeCorpse(world: World, enc: Encounter): Slain | null {
  const dead = enc.slain?.pop() ?? null;
  if (!dead) return null;
  if (enc.lastSlain === dead || (dead.id && enc.lastSlain?.id === dead.id)) enc.lastSlain = null;
  if (dead.id) world.risings = world.risings.filter((r) => r.id !== dead.id);
  return dead;
}

/** A unit that fights for `h` in this fight: `summon` ones are gone when it ends. */
function addAlly(ctx: CardCtx, type: EnemyId, r: Partial<Risen> = {}): Risen {
  const { world, enc, h, events } = ctx;
  // The Undertaker's dead stay with him for good, decaying (M16); past his cap the most decayed crumbles first.
  const follows = h.cls === 'undertaker';
  if (follows) {
    const gone = makeRoom(world, h);
    if (gone) events.push({ actor: h.id, kind: 'info', text: `${h.name}'s ${gone} crumbles away to make room.` });
  }
  const scale = r.dmgMult ?? monsterScale(world, type, world.escalation);
  const hp = r.maxHp ?? Math.round(ENEMIES[type].maxHp * scale);
  const unit: Risen = {
    id: `r${world.nextId++}`, type, hp, maxHp: hp, dmgMult: scale, turns: 1, permanent: true, summon: true, by: h.id, ...r,
    ...(follows ? { summon: undefined, decay: 0, age: 0 } : {}),
  };
  (enc.legion ??= []).push(unit);
  return unit;
}

/** Summon one more of a kind (at most CARD_RULES.summonMax each); with that many already, heal them to full instead. */
function summon(ctx: CardCtx, type: EnemyId, verb: string) {
  const { enc, h, events } = ctx;
  const mine = (enc.legion ?? []).filter((r) => r.by === h.id && r.type === type && r.hp > 0);
  const name = ENEMIES[type].name;
  if (mine.length >= R.summonMax) {
    for (const r of mine) r.hp = r.maxHp;
    events.push({ actor: h.id, kind: 'heal', text: `${h.name}'s ${name}s are made whole again.` });
    return;
  }
  const unit = addAlly(ctx, type);
  events.push({ actor: h.id, kind: 'status', target: unit.id, text: `${h.name} ${verb} a ${name}.` });
}

// ---------------------------------------------------------------------------
// Small effects

/** Push an enemy's next action back (hammers make it longer). Returns the seconds added. */
export function delay(ctx: CardCtx, m: Monster, secs: number): number {
  const { world, enc, h, events } = ctx;
  if (!world.monsters[m.id] || enc.next[m.id] === undefined) return 0;
  const total = Math.round((secs * ctx.power + wornStat(h, 'delayBonus')) * 10) / 10;
  if (total <= 0) return 0;
  enc.next[m.id] = at(enc.next[m.id] + total);
  events.push({ actor: h.id, kind: 'status', target: m.id, text: `${ENEMIES[m.type].name} is Delayed ${total}s.` });
  onDelayed(m, events, h.id);
  return total;
}

/** An ally's next action comes `secs` sooner (never before now). The player's own is applied after their card. */
export function hurry(ctx: CardCtx, a: Hero | Risen, secs: number) {
  const { world, enc, h } = ctx;
  const s = secs * ctx.power;
  if (a === h) {
    ctx.selfHurry += s;
    return;
  }
  if (enc.next[a.id] !== undefined) enc.next[a.id] = at(Math.max(world.time, enc.next[a.id] - s));
}

/** Shield for an ally (Guard cards get a Chain Hauberk's bonus; a Warding Staff adds its own). */
function shieldOf(ctx: CardCtx, t: { st: Statuses }, n: number) {
  const guard = CARDS[ctx.card].schools.includes('guard') ? wornStat(ctx.h, 'guardShield') : 0;
  const add = Math.max(0, Math.round(n * ctx.power)) + guard;
  gainShield(ctx.world, ctx.enc, t.st, add);
  return add + ward(ctx.h, t);
}

/** Note the debuff this hero just placed (Double Hex copies it). */
function placed(ctx: CardCtx, kind: DebuffKind, m: Monster) {
  (ctx.enc.lastDebuff ??= {})[ctx.h.id] = kind;
  markWitchwood(ctx.h, m.st);
}

/** Lay a debuff of this kind on an enemy (as its card would: stacks, turns and a Twinned Staff's second copy). */
export function debuff(ctx: CardCtx, m: Monster, kind: DebuffKind, turns = 2, amount = 0) {
  const { world, h } = ctx;
  if (!world.monsters[m.id]) return;
  const st = m.st;
  const copies = debuffCopies(h);
  const t = debuffTurns(h, turns);
  switch (kind) {
    case 'hexed':
      for (let i = 0; i < copies; i++) (st.hexed ??= []).push(t);
      break;
    case 'weak':
      st.weak = { stacks: (st.weak?.stacks ?? 0) + copies, turns: t };
      break;
    case 'acid':
      st.acid = { stacks: (st.acid?.stacks ?? 0) + copies, turns: t };
      break;
    case 'poison': {
      const dmg = Math.max(1, Math.round((amount || 1) * damageMult(h, world) * ctx.power));
      for (let i = 0; i < copies; i++) addPoison(st, dmg, t + wornStat(h, 'poisonTurns'));
      break;
    }
    case 'bleed': {
      const dmg = Math.max(1, Math.round((amount || 1) * damageMult(h, world) * ctx.power));
      for (let i = 0; i < copies; i++) (st.bleed ??= []).push({ dmg, until: world.time + t, next: world.time + R.pulse });
      break;
    }
    case 'stun':
      st.stun = true;
      break;
    case 'exposed':
      st.exposed = Math.max(st.exposed ?? 0, amount || R.exposed);
      break;
    case 'slow':
      st.slow = { amount: amount || 1, until: world.time + t };
      break;
    case 'blind':
      st.blind = true;
      break;
  }
  // Witching Hour: every debuff Hexes too.
  if (kind !== 'hexed' && (ctx.enc.witching ?? 0) > world.time) (st.hexed ??= []).push(t);
  placed(ctx, kind, m);
}

/** A hit from a card: Strike cards add a Kris's bonus against the Poisoned, Hinder cards an Iron Maul's. A crit is ×2 (or `critMult`). */
function strike(ctx: CardCtx, m: Monster | null | undefined, base: number, opts: { crit?: boolean; critMult?: number; name?: string } = {}): boolean {
  const { world, enc, h, events } = ctx;
  if (!m || !world.monsters[m.id]) return false;
  const schools = CARDS[ctx.card].schools;
  let n = base * ctx.power + eternalBonus(h);
  if (schools.includes('strike') && m.st.poison?.length) n += wornStat(h, 'poisonedBonus');
  if (schools.includes('hinder')) n += wornStat(h, 'hinderDmg');
  if (opts.crit) n *= opts.critMult ?? 2;
  return heroHits(world, enc, h, m, Math.max(1, Math.round(n)), events, opts.name ?? CARDS[ctx.card].name, !!opts.crit);
}

function allyText(ctx: CardCtx, t: Hero) {
  return t === ctx.h ? 'themself' : t.name;
}

// ---------------------------------------------------------------------------
// Playing a card

/**
 * Resolve `card` for `h`. Targets the player picked are honoured while they still make sense; otherwise a sensible one
 * is chosen (the frontmost enemy, the most hurt ally). Returns the CardCtx (for the self-Hurry it added).
 */
export function playCard(world: World, enc: Encounter, h: Hero, card: CardId, target: string | undefined, room: number | undefined, events: CombatEvent[], power = 1, prev: CardId | null = null): CardCtx {
  const ctx: CardCtx = { world, enc, h, card, target, room, events, power, prev, selfHurry: 0 };
  resolve(ctx);
  // A hit set up by a Hand Signal Exposes what it lands on (handled in heroHits); nothing to do here.
  return ctx;
}

function resolve(ctx: CardCtx) {
  const { world, enc, h, events } = ctx;
  const rng = world.rng;
  const p = (n: number) => Math.max(1, Math.round(n * ctx.power));
  const enemies = () => monstersIn(world, enc.room);
  const front = () => combatOrder(world, enc).monsters[0] ?? null;
  const allies = () => enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  const others = () => allies().filter((a) => a !== h);
  /** The summoned and risen on the heroes' side: "every ally" cards reach them too (they have no light or items). */
  const risen = () => risenAll(enc);
  const risenSt_ = (r: Risen) => ({ st: risenSt(world, r) });
  /** The picked enemy if it's still here, else the frontmost. */
  const foe = (): Monster | null => {
    const m = ctx.target ? world.monsters[ctx.target] : undefined;
    return m && m.room === enc.room ? m : front();
  };
  /** The picked ally if they're still standing here, else the most hurt one (you, if alone). */
  const friend = (): Hero => {
    const t = ctx.target ? world.heroes[ctx.target] : undefined;
    if (t && isConscious(t) && t.encounter === enc.room) return t;
    return allies().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? h;
  };
  /** The picked ally if they're still standing here, else the one with the least light (you, if alone). */
  const friendLight = (): Hero => {
    const t = ctx.target ? world.heroes[ctx.target] : undefined;
    if (t && isConscious(t) && t.encounter === enc.room) return t;
    return [...others()].sort((a, b) => a.light - b.light)[0] ?? h;
  };
  /** This hero's own undead following, standing in this fight (the Undertaker's). */
  const mineHere = () => (enc.legion ?? []).filter((r) => r.by === h.id && r.hp > 0 && r.decay !== undefined);
  const name = (m: Monster) => ENEMIES[m.type].name;
  const tell = (text: string, kind: CombatEvent['kind'] = 'status', target?: string, amount?: number) =>
    events.push({ actor: h.id, kind, text, target, amount });

  switch (ctx.card) {
    // ---- Warden ----
    case 'bash': {
      const m = front();
      if (strike(ctx, m, R.bash + Math.floor(shieldPool(world, h) * R.bashPerShield)) && m) delay(ctx, m, R.bashDelay);
      return;
    }
    case 'cover': {
      const t = friend();
      const got = shieldOf(ctx, t, R.coverShield);
      stepToEnd(world, h, 'front');
      tell(`${h.name} covers ${allyText(ctx, t)}. (+${got} Shield)`, 'status', t.id);
      return;
    }
    case 'thornwall': {
      const got = shieldOf(ctx, h, R.thornwallShield);
      h.st.thornwall = true;
      tell(`${h.name} raises a wall of thorns. (+${got} Shield; what it stops comes back)`, 'status', h.id);
      return;
    }
    case 'rally': {
      let got = 0;
      for (const a of allies()) got = shieldOf(ctx, a, R.rallyShield);
      for (const r of risen()) shieldOf(ctx, risenSt_(r), R.rallyShield);
      tell(`${h.name} rallies the party! (+${got} Shield)`);
      return;
    }
    case 'slam': {
      const m = front();
      if (!m) return;
      const base = Math.max(R.slamMin, heroBlock(h) + shieldPool(world, h));
      const before = m.hp;
      strike(ctx, m, base);
      const dealt = Math.max(0, before - Math.max(0, world.monsters[m.id]?.hp ?? 0));
      const secs = Math.floor(dealt / R.slamDelayPer);
      if (secs > 0) delay(ctx, m, secs / ctx.power);
      return;
    }
    case 'gate': {
      const until = world.time + buffLength(h, R.gateSecs);
      let got = 0;
      for (const a of allies()) {
        got = shieldOf(ctx, a, R.gateShield);
        a.st.gate = until;
      }
      for (const r of risen()) shieldOf(ctx, risenSt_(r), R.gateShield);
      tell(`${h.name} holds the gate! (every ally +${got} Shield; ${R.gateSecs}s: blows on a Shield are thrown back ${R.gateDelay}s)`);
      return;
    }
    // ---- Cutthroat ----
    case 'backstab': {
      const m = foe();
      if (!m) return;
      const crit = !!(m.st.stun || m.st.exposed || !m.st.acted || (h.st.dance ?? 0) > world.time);
      strike(ctx, m, R.backstab, { crit, critMult: h.sneaking ? R.backstabSneakCrit : 2 });
      return;
    }
    case 'cheap': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.cheap);
      if (world.monsters[m.id]) {
        debuff(ctx, m, 'stun');
        if (h.sneaking) debuff(ctx, m, 'exposed');
        tell(`${name(m)} is stunned${h.sneaking ? ' and Exposed' : ''}.`, 'status', m.id);
      }
      return;
    }
    case 'envenom': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.envenom);
      debuff(ctx, m, 'poison', h.sneaking ? R.envenomSneakTurns : R.envenomTurns, R.envenomPoison);
      if (world.monsters[m.id]) tell(`${name(m)} is poisoned.`, 'status', m.id);
      return;
    }
    case 'signal': {
      const t = friend();
      // Out in the open (not Sneaking), the signal is bolder.
      const secs = h.sneaking ? R.signalHurry : R.signalLoudHurry;
      hurry(ctx, t, secs);
      t.st.expose = true;
      tell(`${h.name} signals ${allyText(ctx, t)}: now! (${secs}s sooner; their next hit Exposes)`, 'status', t.id);
      return;
    }
    case 'smoke': {
      const until = world.time + buffLength(h, R.smokeSecs);
      for (const a of allies()) {
        a.st.dodge = until;
        a.st.fleeSure = until;
        ward(h, a);
      }
      for (const r of risen()) {
        const t = risenSt_(r);
        t.st.dodge = until;
        ward(h, t);
      }
      // Sneaking: in the smoke they can vanish altogether.
      if (h.sneaking) h.st.sneakPast = true;
      tell(`${h.name} hurls a smoke bomb! (${Math.round(until - world.time)}s${h.sneaking ? '; their next Flee is a Sneak Past' : ''})`);
      return;
    }
    case 'dance': {
      const secs = h.sneaking ? R.danceSneakSecs : R.danceSecs;
      h.st.dance = world.time + buffLength(h, secs);
      tell(`${h.name} starts the blade dance! (${secs}s: every card 1s, Backstab always crits)`, 'status', h.id);
      return;
    }
    // ---- Lampbearer ----
    case 'flare':
      flare(world, enc, h, events, false, p(R.flare) + eternalBonus(h));
      return;
    case 'mend': {
      const t = friend();
      // Bright (light above 75): the Lampbearer's lamp makes it stronger.
      const healed = heal(t, healBy(h, p(lightStage(h.light) === 'bright' ? R.mendBright : R.mend)));
      delete t.st.poison;
      delete t.st.bleed;
      ward(h, t);
      tell(`${h.name} mends ${allyText(ctx, t)} (+${healed}).`, 'heal', t.id, healed);
      return;
    }
    case 'vigil': {
      const t = friendLight();
      const got = Math.round(gainLight(t, lightBy(h, t, R.vigilLight * ctx.power)));
      ward(h, t);
      tell(`${h.name} keeps vigil over ${allyText(ctx, t)}. (+${got} light)`, 'light', t.id, got);
      if (others().length === 0) {
        h.st.vigil = h.id;
        h.st.vigilMore = buffLength(h, 1) - 1;
        tell(`${h.name} stands alone, lamp raised. Any move against them will meet the light.`, 'status', h.id);
      }
      return;
    }
    case 'kindle': {
      const m = foe();
      const spent = spendLight(h, Math.min(R.kindleLight, Math.floor(h.light)));
      if (!m) return;
      strike(ctx, m, Math.min(R.kindleMax, R.kindleBase + Math.floor(spent / 2)));
      if (spent >= R.kindleLight && world.monsters[m.id]) {
        debuff(ctx, m, 'blind');
        tell(`${name(m)} is blinded by the light.`, 'status', m.id);
      }
      return;
    }
    case 'sanctuary':
    case 'bloom': {
      const secs = buffLength(h, ctx.card === 'bloom' ? R.bloomSecs : lightStage(h.light) === 'bright' ? R.sanctuaryBrightSecs : R.sanctuarySecs);
      const amount = p(ctx.card === 'bloom' ? R.bloomRegen : R.sanctuaryRegen);
      for (const a of [...allies(), ...risen().map(risenSt_)]) {
        a.st.regen = { amount: Math.max(amount, a.st.regen?.amount ?? 0), until: world.time + secs, next: world.time + R.pulse };
        ward(h, a);
      }
      tell(`${h.name} ${ctx.card === 'bloom' ? 'calls up a green bloom' : 'hallows the ground'}. (Regen ${amount} every ${R.pulse}s for ${secs}s)`);
      return;
    }
    case 'dawn':
      for (const a of allies()) {
        a.light = Math.max(a.light, LIGHT_MAX);
        heal(a, healBy(h, p(R.dawnHeal)));
        ward(h, a);
      }
      for (const r of risen()) {
        heal(r, healBy(h, p(R.dawnHeal)));
        ward(h, risenSt_(r));
      }
      for (const m of enemies()) debuff(ctx, m, 'blind');
      tell(`${h.name} brings the dawn! Every ally is healed and lit; every foe is blinded.`);
      return;
    // ---- Sorceress ----
    case 'hex': {
      const m = foe();
      if (!m) return;
      const stacks = m.st.hexed?.length ?? 0;
      strike(ctx, m, R.hex * (1 + R.hexedBonus * stacks));
      debuff(ctx, m, 'hexed', R.hexedTurns);
      if (world.monsters[m.id] && anima(ctx)) debuff(ctx, m, 'hexed', R.hexedTurns);
      if (world.monsters[m.id]) tell(`${name(m)} is Hexed (×${m.st.hexed?.length ?? 0}).`, 'status', m.id);
      return;
    }
    case 'wither': {
      const hexed = anima(ctx);
      for (const m of enemies()) {
        debuff(ctx, m, 'weak', R.witherTurns);
        if (hexed) debuff(ctx, m, 'hexed', R.hexedTurns);
      }
      tell(`${h.name} withers every foe. (−50% damage per stack${hexed ? '; Hexed too' : ''})`);
      return;
    }
    case 'pact': {
      // Anima: the pact is sealed with something other than blood.
      if (anima(ctx)) {
        tell(`${h.name} seals the pact with Anima instead of blood.`);
        for (const m of enemies()) strike(ctx, m, R.pact);
        return;
      }
      for (const a of allies()) {
        const cost = Math.min(a.hp - 1, afterBlock(a, R.pactCost));
        if (cost > 0) {
          a.hp -= cost;
          tell(a === h ? `${h.name} spills their own blood.` : `The pact takes its due from ${a.name}.`, 'damage', a.id, cost);
        }
      }
      // The summoned and risen pay in blood too.
      for (const r of risen()) {
        const cost = Math.min(r.hp - 1, risenTakes(world, r, R.pactCost));
        if (cost <= 0) continue;
        r.hp -= cost;
        tell(`The pact takes its due from the ${risenName(world, r)}.`, 'damage', r.id, cost);
      }
      for (const m of enemies()) strike(ctx, m, R.pact);
      return;
    }
    case 'familiar':
      summon(ctx, 'imp', 'binds');
      if (anima(ctx)) summon(ctx, 'imp', 'binds');
      return;
    case 'bargain': {
      const cost = Math.min(h.hp - 1, afterBlock(h, R.bargainHp));
      if (cost > 0) h.hp -= cost;
      h.anima++;
      h.st.quick = { set: 1, cut: h.st.quick?.cut ?? 0 };
      tell(`${h.name} strikes a mad bargain in blood. (−${Math.max(0, cost)} HP; +1 Anima; next card 1s)`, 'damage', h.id, Math.max(0, cost));
      return;
    }
    case 'ages': {
      // Anima: every bit of it goes into the curse.
      const spent = h.anima > 0 ? h.anima : 0;
      if (spent) {
        h.anima = 0;
        tell(`${h.name} pours all their Anima into the curse. (${spent})`, 'status', h.id);
      }
      for (const m of enemies()) {
        for (let i = 0; i < R.agesStacks + spent; i++) (m.st.hexed ??= []).push(debuffTurns(h, R.hexedTurns));
        placed(ctx, 'hexed', m);
        delay(ctx, m, R.agesDelayPer * (m.st.hexed?.length ?? 0));
      }
      tell(`${h.name} lays the curse of ages on every foe.`);
      return;
    }
    // ---- Undertaker ----
    case 'spade':
      strike(ctx, foe(), R.spade + h.spadeBonus);
      return;
    case 'rites': {
      const m = foe();
      if (!m) return;
      if (ENEMIES[m.type].tier < BOSS_TIER && m.hp < m.maxHp * R.ritesBelow) {
        tell(`${h.name} reads the Last Rites over the ${name(m)}.`, 'damage', m.id, m.hp);
        applyKill(ctx, m);
        h.spadeBonus += R.spadePerRites;
        tell(`${h.name}'s spade grows heavier. (Spade +${h.spadeBonus})`, 'status', h.id);
      } else strike(ctx, m, R.rites);
      return;
    }
    case 'raise': {
      const dead = takeCorpse(world, enc);
      if (!dead) {
        summon(ctx, 'rat', 'calls up');
        return;
      }
      const unit = addAlly(ctx, dead.type, { maxHp: dead.maxHp, hp: dead.maxHp, dmgMult: dead.dmgMult });
      tell(`${h.name} raises the fallen ${ENEMIES[dead.type].name}. It turns on its kin${unit.decay !== undefined ? ', and follows them now' : ''}.`, 'status', unit.id);
      return;
    }
    case 'explode': {
      const dead = takeCorpse(world, enc);
      if (dead) {
        tell(`${h.name} bursts the fallen ${ENEMIES[dead.type].name}!`);
        for (const m of enemies()) strike(ctx, m, R.explode);
        return;
      }
      // No Corpse: the most rotten of their own following goes up instead.
      const rotten = mineHere().sort((a, b) => (b.decay ?? 0) - (a.decay ?? 0))[0];
      if (rotten) {
        const dmg = R.explode + R.explodePerDecay * (rotten.decay ?? 0);
        rotten.hp = 0;
        delete enc.next[rotten.id];
        tell(`${h.name} bursts their own ${risenName(world, rotten)}!`, 'death', rotten.id);
        for (const m of enemies()) strike(ctx, m, dmg);
        return;
      }
      tell(`${h.name} stirs the grave dust into a choking cloud.`);
      for (const m of enemies()) strike(ctx, m, R.explodeBare);
      return;
    }
    case 'embalm': {
      const mine = mineHere();
      if (!mine.length) {
        const got = shieldOf(ctx, h, R.embalmBare);
        tell(`${h.name} has nobody to embalm, and braces instead. (+${got} Shield)`, 'status', h.id);
        return;
      }
      for (const r of mine) {
        heal(r, healBy(h, p(R.embalmHeal)));
        r.decay = Math.max(0, (r.decay ?? 0) - 1);
      }
      tell(`${h.name} embalms their dead. (+${healBy(h, p(R.embalmHeal))} HP each, one decay less)`, 'heal');
      return;
    }
    case 'graves': {
      let n = 0;
      for (let dead = takeCorpse(world, enc); dead; dead = takeCorpse(world, enc)) {
        addAlly(ctx, dead.type, { maxHp: dead.maxHp, hp: dead.maxHp, dmgMult: dead.dmgMult });
        n++;
      }
      if (!n) addAlly(ctx, 'ghoul');
      tell(`${h.name} opens the graves: ${n > 1 ? `${n} of the dead rise` : n ? 'the dead rise' : 'a Ghoul claws its way up'} to fight for them!`);
      return;
    }
    // ---- Bellwright ----
    case 'clang': {
      const m = front();
      if (strike(ctx, m, R.clang) && m) delay(ctx, m, R.clangDelay * debuffCopies(h));
      addClang(h, 1);
      return;
    }
    case 'knell': {
      const clang = spendClang(h);
      const dmg = Math.max(R.knellMin, R.knell - R.knellPerAlly * others().length) + R.knellPerClang * clang;
      tell(`${h.name} tolls the knell.${clang ? ` (all ${clang} Clang rung out: +${R.knellPerClang * clang} dmg)` : ''}`);
      for (const m of enemies()) strike(ctx, m, dmg);
      return;
    }
    case 'peal': {
      const rest = others();
      const secs = R.pealHurry + R.pealPerClang * (h.st.clang?.stacks ?? 0);
      for (const a of rest) {
        hurry(ctx, a, secs);
        ward(h, a);
      }
      for (const r of risen()) {
        hurry(ctx, r, secs);
        ward(h, risenSt_(r));
      }
      if (!rest.length) addClang(h, R.pealAloneClang);
      tell(rest.length ? `${h.name} rings a bright peal! (allies act ${secs}s sooner)` : `${h.name} rings a bright peal for themself. (+${R.pealAloneClang} Clang)`);
      return;
    }
    case 'ringout': {
      const clang = spendClang(h);
      const secs = R.ringOutDelay + R.ringOutPerClang * clang;
      tell(`${h.name} rings out over the din!${clang ? ` (all ${clang} Clang rung out)` : ''}`);
      for (const m of enemies()) delay(ctx, m, secs);
      return;
    }
    case 'echo': {
      const last = h.lastCard;
      if (!last) {
        tell(`${h.name}'s bell answers with a dull ring.`);
        strike(ctx, front(), R.echoBare);
        return;
      }
      tell(`${h.name}'s ${CARDS[last].name} echoes!`);
      const mult = (h.st.clang?.stacks ?? 0) >= R.echoFullAt ? 1 : R.echoMult;
      const inner = { ...ctx, card: last, power: ctx.power * mult, target: undefined, selfHurry: 0 };
      resolve(inner);
      ctx.selfHurry += inner.selfHurry;
      return;
    }
    case 'reverberate': {
      const foes = enemies();
      for (const m of foes) debuff(ctx, m, 'stun');
      for (const a of [...others(), ...risen()]) if (enc.next[a.id] !== undefined) enc.next[a.id] = at(world.time);
      if (foes.length) addClang(h, foes.length);
      tell(`${h.name}'s bell reverberates through the stone! Every foe reels; every ally moves now. (+${foes.length} Clang)`);
      return;
    }
    // ---- Zealot ----
    case 'scourge':
      strike(ctx, foe(), R.scourge);
      return;
    case 'absolution': {
      // Darkness is the fuel: the light lacking below the floor turns into damage, and comes back as it's spent.
      const dark = Math.max(0, Math.round(R.absolutionFloor - h.light));
      const targets = enemies();
      const each = Math.ceil((R.absolutionBase + dark) / Math.max(1, targets.length));
      tell(`${h.name} pours out the dark!${dark ? ` (+${dark} damage)` : ''}`);
      for (const m of targets) strike(ctx, m, each);
      const back = dark;
      if (back > 0) {
        gainLight(h, back);
        tell(`${h.name} is absolved. (+${back} light)`, 'light', h.id, back);
      }
      return;
    }
    case 'sins': {
      const t = friendLight();
      if (t === h) {
        const lost = Math.round(spendLight(h, p(R.sinsSelf)));
        tell(`${h.name} dwells on their own sins, and their lamp dims. (−${lost} light)`, 'light', h.id, -lost);
        return;
      }
      const given = Math.round(spendLight(h, Math.min(LIGHT_MAX - t.light, p(R.sinsLight))));
      const got = Math.round(gainLight(t, lightBy(h, t, given)));
      ward(h, t);
      tell(`${h.name} takes ${t.name}'s darkness upon themself. (${t.name} +${got} light, ${h.name} −${given})`, 'light', t.id, got);
      return;
    }
    case 'martyrdom': {
      const lost = Math.round(spendLight(h, p(R.martyrdomLight)));
      h.st.quick = { set: 1, cut: h.st.quick?.cut ?? 0 };
      tell(`${h.name} snuffs their own light for the cause. (−${lost} light; next card 1s)`, 'light', h.id, -lost);
      return;
    }
    case 'penance': {
      const lost = Math.round(spendLight(h, p(R.penanceLight)));
      const got = shieldOf(ctx, h, Math.floor((LIGHT_MAX - h.light) / R.penanceDiv) / ctx.power);
      tell(`${h.name} does penance. (−${lost} light, +${got} Shield)`, 'status', h.id);
      return;
    }
    case 'rapture': {
      let moved = 0;
      for (const a of others()) {
        const given = spendLight(h, Math.min(LIGHT_MAX - a.light, R.raptureLight));
        gainLight(a, lightBy(h, a, given));
        moved += given;
      }
      if (moved) tell(`${h.name} pours their light into the others and takes the dark. (−${Math.round(moved)} light)`, 'light', h.id, -Math.round(moved));
      strike(ctx, foe(), R.rapture + Math.floor((LIGHT_MAX - h.light) / 2));
      return;
    }
    // ---- Alchemist ----
    case 'acid': {
      const m = foe();
      if (!m) return;
      const poisoned = !!m.st.poison?.length;
      strike(ctx, m, R.acid);
      debuff(ctx, m, 'acid', R.acidTurns);
      if (poisoned && world.monsters[m.id]) debuff(ctx, m, 'acid', R.acidTurns);
      if (world.monsters[m.id]) tell(`${name(m)} is burned by acid.${(m.st.acid?.stacks ?? 0) > 1 ? ` (×${m.st.acid!.stacks})` : ''}`, 'status', m.id);
      return;
    }
    case 'fumes':
      fumes(world, enc, h, events, false, (m) => debuff(ctx, m, 'poison', R.fumesTurns, R.fumesPoison));
      return;
    case 'contagion': {
      const m = foe();
      if (!m) return;
      const poisons = m.st.poison ?? [];
      if (!poisons.length) {
        debuff(ctx, m, 'poison', R.contagionTurns, R.contagionPoison);
        tell(`${h.name} seeds a contagion in the ${name(m)}.`, 'status', m.id);
        return;
      }
      // Each Poison on it is copied, damage and time left alike, onto every other enemy.
      const rest = enemies().filter((o) => o !== m);
      for (const o of rest) for (const pz of poisons) addPoison(o.st, pz.dmg, pz.rounds);
      if (rest.length) placed(ctx, 'poison', rest[0]);
      tell(`The ${name(m)}'s poisons spread to every foe! (${poisons.length} each)`);
      return;
    }
    case 'elixir': {
      const t = friend();
      t.elixir = true;
      ward(h, t);
      tell(`${h.name} hands ${allyText(ctx, t)} an elixir. (next item ×2)`, 'status', t.id);
      return;
    }
    case 'catalyst':
      catalyst(ctx);
      return;
    case 'opus': {
      let made = 0;
      while (made < R.opusItems && hasSpace(h) && !h.rites.includes('gem')) {
        giveItem(h, brewRoll(world));
        made++;
      }
      h.st.quickItems = true;
      tell(`${h.name} completes the Opus Magnum! (${made} brew${made === 1 ? '' : 's'}; items take 1s this fight)`, 'status', h.id);
      return;
    }
    // ---- Gear types ----
    case 'stab1':
    case 'stab2':
      strike(ctx, foe(), ctx.card === 'stab1' ? R.stab1 : R.stab2);
      return;
    case 'thump1':
    case 'thump2': {
      const m = front();
      const two = ctx.card === 'thump2';
      if (strike(ctx, m, two ? R.thump2 : R.thump1) && m) delay(ctx, m, two ? R.thump2Delay : R.thump1Delay);
      return;
    }
    case 'soothe1':
    case 'soothe2': {
      const t = friend();
      const healed = heal(t, healBy(h, p(ctx.card === 'soothe1' ? R.soothe1 : R.soothe2)));
      ward(h, t);
      tell(`${h.name} soothes ${allyText(ctx, t)} (+${healed}).`, 'heal', t.id, healed);
      return;
    }
    case 'sidestep1':
      h.st.sidestep = Math.max(h.st.sidestep ?? 0, R.sidestep1);
      tell(`${h.name} watches for the blow. (${R.sidestep1 * 100}% Dodge until their next turn)`, 'status', h.id);
      return;
    case 'sidestep2':
      h.st.dodge = Math.max(h.st.dodge ?? 0, world.time + buffLength(h, R.sidestep2Secs));
      tell(`${h.name} is light on their feet. (${R.sidestep2 * 100}% Dodge for ${R.sidestep2Secs}s)`, 'status', h.id);
      return;
    case 'braceup1':
    case 'braceup2': {
      const got = shieldOf(ctx, h, ctx.card === 'braceup1' ? R.braceup1 : R.braceup2);
      tell(`${h.name} braces behind their armour. (+${got} Shield)`, 'status', h.id);
      return;
    }
    case 'wick1': {
      const got = Math.round(gainLight(h, p(R.wick1)));
      tell(`${h.name} trims their wick. (+${got} light)`, 'light', h.id, got);
      return;
    }
    case 'wick2': {
      const t = friendLight();
      const got = Math.round(gainLight(t, lightBy(h, t, p(R.wick2))));
      ward(h, t);
      tell(`${h.name} trims ${t === h ? 'their own' : `${t.name}'s`} wick. (+${got} light)`, 'light', t.id, got);
      return;
    }
    case 'mutter1':
      summon(ctx, 'rat', 'mutters up');
      return;
    case 'mutter2':
      summon(ctx, 'shade', 'mutters up');
      return;
    case 'evillook1':
    case 'evillook2': {
      const m = foe();
      if (!m) return;
      const two = ctx.card === 'evillook2';
      if (two) strike(ctx, m, R.evillook2Dmg);
      debuff(ctx, m, 'exposed', 0, two ? R.evillook2 : R.evillook1);
      if (world.monsters[m.id]) tell(`${name(m)} is Exposed.`, 'status', m.id);
      return;
    }
    // ---- Rare Gear ----
    case 'mercy': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.mercy);
      if (world.monsters[m.id] && ENEMIES[m.type].tier < BOSS_TIER && m.hp < m.maxHp * R.mercyBelow) {
        tell(`${h.name} grants the ${name(m)} mercy.`, 'damage', m.id, m.hp);
        applyKill(ctx, m);
      }
      return;
    }
    case 'whispercut': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.whispercut);
      debuff(ctx, m, 'bleed', R.whispercutSecs, R.whispercutBleed);
      quicken(h, R.whispercutCut);
      if (world.monsters[m.id]) tell(`${name(m)} bleeds.`, 'status', m.id);
      return;
    }
    case 'shatter': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.shatter);
      if (world.monsters[m.id]) {
        m.st.sunder = (m.st.sunder ?? 0) + R.shatterSunder;
        delay(ctx, m, R.shatterDelay);
      }
      return;
    }
    case 'earthblow':
      for (const m of combatOrder(world, enc).monsters.slice(0, 2)) {
        strike(ctx, m, R.earthblow);
        debuff(ctx, m, 'slow', R.earthblowSecs, R.earthblowSlow);
      }
      tell(`${h.name}'s blow shakes the floor. (Slowed ${R.earthblowSlow}s for ${R.earthblowSecs}s)`);
      return;
    case 'doublehex': {
      const m = foe();
      if (!m) return;
      const kind = enc.lastDebuff?.[h.id] ?? 'exposed';
      const amount = kind === 'poison' ? R.envenomPoison : kind === 'bleed' ? R.whispercutBleed : kind === 'slow' ? R.earthblowSlow : 0;
      const turns = kind === 'bleed' ? R.whispercutSecs : kind === 'slow' ? R.earthblowSecs : 2;
      debuff(ctx, m, kind, turns, amount);
      tell(`${h.name} doubles the curse onto the ${name(m)}. (${kind})`, 'status', m.id);
      return;
    }
    case 'glass': {
      const back = ctx.prev ? returnLast(h) : null;
      if (back) tell(`${h.name} turns the glass: ${CARDS[back].name} is back in hand.`, 'status', h.id);
      else {
        cycle(h, rng, 1);
        tell(`${h.name} turns the glass and draws again.`, 'status', h.id);
      }
      return;
    }
    case 'scaleward': {
      const got = shieldOf(ctx, h, R.scaleWard);
      h.st.spikes = p(R.scaleWardSpikes);
      tell(`${h.name} raises their scales. (+${got} Shield; attackers take ${h.st.spikes})`, 'status', h.id);
      return;
    }
    case 'fade':
      h.st.evade = (h.st.evade ?? 0) + 1;
      quicken(h, R.fadeCut);
      tell(`${h.name} fades into the shadows.`, 'status', h.id);
      return;
    case 'runeward': {
      let got = 0;
      for (const a of allies()) got = shieldOf(ctx, a, R.runeWard);
      for (const r of risen()) shieldOf(ctx, risenSt_(r), R.runeWard);
      tell(`${h.name}'s runes flare. (every ally +${got} Shield)`);
      return;
    }
    case 'bulwark': {
      const got = shieldOf(ctx, h, R.bulwark);
      stepToEnd(world, h, 'front');
      tell(`${h.name} plants their bulwark. (+${got} Shield)`, 'status', h.id);
      const m = front();
      if (m) delay(ctx, m, R.bulwarkDelay);
      return;
    }
    case 'liestill': {
      const healed = heal(h, healBy(h, p(R.lieStillHeal)));
      const lost = Math.round(spendLight(h, R.lieStillLight));
      stepToEnd(world, h, 'back');
      tell(`${h.name} lies still in the dark among the dead. (+${healed} HP, −${lost} light)`, 'heal', h.id, healed);
      return;
    }
    case 'slipaway':
      if (enc.room === world.dungeon.exit) {
        leaveEncounter(world, enc, h);
        extractHero(world, h);
        tell(`${h.name} slips out through the exit!`, 'flee', h.id);
        return;
      }
      flee(world, enc, h, true);
      tell(`${h.name} slips away like a ghost.`, 'flee', h.id);
      return;
    case 'blink':
      stepToEnd(world, h, 'back');
      h.st.evade = (h.st.evade ?? 0) + 1;
      tell(`${h.name} blinks to the back of the line.`, 'status', h.id);
      return;
    case 'veil': {
      const t = friend();
      t.st.evade = (t.st.evade ?? 0) + 1;
      ward(h, t);
      tell(`${h.name} draws a veil over ${allyText(ctx, t)}.`, 'status', t.id);
      return;
    }
    case 'luckybreak':
      cycle(h, rng);
      tell(`${h.name} gets a lucky break: a whole new hand.`, 'status', h.id);
      return;
    case 'feverdream': {
      const lost = Math.round(spendLight(h, R.feverLight));
      h.st.conjureHalf = true;
      tell(`${h.name} sinks into a fever dream. (−${lost} light; Conjure cards take half the time)`, 'light', h.id, -lost);
      return;
    }
    case 'bloodrush': {
      const cost = Math.min(h.hp - 1, R.bloodRushHp);
      if (cost > 0) h.hp -= cost;
      h.st.haste = { amount: R.bloodRushHaste, until: world.time + buffLength(h, R.bloodRushSecs) };
      tell(`${h.name}'s blood races. (−${cost} HP; cards ${R.bloodRushHaste}s quicker for ${R.bloodRushSecs}s)`, 'status', h.id);
      return;
    }
    case 'ashes': {
      const spent = spendLight(h, Math.min(R.ashesLight, Math.floor(h.light)));
      for (const m of enemies()) debuff(ctx, m, 'weak', spent >= R.ashesLight ? 2 : 1);
      tell(`${h.name} scatters ashes. Every foe is Weakened.`);
      return;
    }
    // ---- Legendary ----
    case 'promise': {
      const foes = enemies().filter((m) => ENEMIES[m.type].tier < BOSS_TIER);
      if (!foes.length) {
        strike(ctx, front(), R.promiseBoss);
        return;
      }
      const top = Math.max(...foes.map((m) => ENEMIES[m.type].tier));
      const m = rng.pick(foes.filter((x) => ENEMIES[x.type].tier === top));
      tell(`${h.name} keeps a promise.`, 'info', m.id);
      const before = events.length;
      applyKill(ctx, m);
      const death = events.slice(before).find((e) => e.kind === 'death' && e.target === m.id);
      if (death) death.text = `The ${name(m)} dies as faint laughter echoes.`;
      return;
    }
    case 'quake':
      tell(`${h.name} brings the earth itself down on every foe!`, 'info');
      for (const m of enemies()) {
        strike(ctx, m, R.quake);
        if (world.monsters[m.id]) {
          debuff(ctx, m, 'stun');
          tell(`${name(m)} is stunned.`, 'status', m.id);
        }
      }
      return;
    case 'unmake':
      tell(`${h.name} unmakes every foe here. They are simply gone.`);
      unmakeFight(world, h, enc);
      return;
    case 'redeem': {
      const t = friend();
      const healed = t.maxHp - t.hp;
      t.hp = t.maxHp;
      t.light = 0;
      tell(`${t === h ? `${h.name} finds` : `${h.name} grants ${t.name}`} redemption: whole again, and in the dark.`, 'heal', t.id, healed);
      return;
    }
    case 'bastion': {
      const got = shieldOf(ctx, h, Math.max(1, heroBlock(h)) * R.bastionPerBlock);
      tell(`${h.name} sets their feet like a wall. (+${got} Shield)`, 'status', h.id);
      return;
    }
    case 'forgive': {
      const fallen = Object.values(world.heroes).find((o) => o !== h && !o.extracted && (o.dead ? !o.raised : o.downedAt !== null) && bodyHere(o, enc.room));
      if (fallen) {
        forgive(world, h, fallen, (text, kind, who, amount) => tell(text, kind, who, amount));
        return;
      }
      const t = friend();
      const healed = heal(t, healBy(h, p(R.forgiveHeal)));
      tell(`${h.name} forgives ${allyText(ctx, t)} their wounds. (+${healed})`, 'heal', t.id, healed);
      return;
    }
    case 'howl': {
      if (wolvesOf(world, h) >= LEGEND_RULES.maxWolves) {
        for (const r of (enc.legion ?? []).filter((x) => x.by === h.id && x.type === 'wolf' && x.hp > 0)) r.hp = r.maxHp;
        tell(`${h.name} howls, and the pack's wounds close.`, 'heal');
        return;
      }
      (enc.legion ??= []).push({ ...summonWolf(world), id: `r${world.nextId++}`, by: h.id });
      tell(`${h.name} howls, and a wolf answers. (${wolvesOf(world, h)}/${LEGEND_RULES.maxWolves})`);
      return;
    }
    case 'waystep': {
      const room = ctx.room !== undefined && world.dungeon.rooms[ctx.room] && h.seen.includes(ctx.room) && ctx.room !== enc.room ? ctx.room : world.dungeon.exit;
      if (room === enc.room) {
        tell(`${h.name} reaches for another place, but is already there.`, 'info');
        return;
      }
      waystep(world, h, room, enc, events);
      return;
    }
    case 'oil': {
      const got = Math.round(gainLight(h, LIGHT_MAX));
      tell(`${h.name} pours the Elder's oil into their lamp. (+${got} light)`, 'light', h.id, got);
      return;
    }
    case 'fumble':
      tell(`${h.name} fumbles with an empty hand.`, 'info');
      return;
    // ---- Found cards (user, 2026-10-16) ----
    case 'riposte':
      h.st.evade = (h.st.evade ?? 0) + 1;
      h.st.riposte = (h.st.riposte ?? 0) + 1;
      tell(`${h.name} takes a duellist's guard.`, 'status', h.id);
      return;
    case 'parry':
      h.st.evade = (h.st.evade ?? 0) + 1;
      tell(`${h.name} readies a parry.`, 'status', h.id);
      return;
    case 'ember': {
      for (const m of enemies()) strike(ctx, m, R.ember);
      let got = 0;
      for (const a of allies()) got = Math.round(gainLight(a, p(R.emberLight)));
      tell(`${h.name}'s living ember flares! (every ally +${got} light)`, 'light', h.id, got);
      return;
    }
    case 'shard': {
      const last = h.lastCard;
      if (!last) {
        tell(`${h.name}'s shard shows only their own face.`);
        strike(ctx, front(), R.shardBare);
        return;
      }
      tell(`${h.name}'s ${CARDS[last].name} flashes again in the shard!`);
      const inner = { ...ctx, card: last, target: undefined, selfHurry: 0 };
      resolve(inner);
      ctx.selfHurry += inner.selfHurry;
      return;
    }
    case 'oathstrike':
      strike(ctx, foe(), R.oathstrike);
      return;
    case 'snakeeyes':
      tell(`${h.name} throws snake eyes. Nothing happens.`, 'info');
      return;
    case 'unmaking': {
      const m = foe();
      if (!m) return;
      if (ENEMIES[m.type].tier >= R.unmakingTier) {
        const cut = Math.ceil(m.hp / 2);
        m.hp -= cut;
        tell(`${h.name} speaks a Word of Unmaking. ${name(m)} comes half undone. (−${cut} HP)`, 'damage', m.id, cut);
        return;
      }
      tell(`${h.name} speaks a Word of Unmaking.`, 'info', m.id);
      applyKill(ctx, m);
      return;
    }
    case 'halting': {
      const m = foe();
      if (!m) return;
      debuff(ctx, m, 'stun');
      tell(`${h.name} speaks a Halting Word. ${name(m)} is stunned.`, 'status', m.id);
      return;
    }
    case 'borrowed':
      h.st.quick = { set: 1, cut: h.st.quick?.cut ?? 0 };
      tell(`${h.name} borrows a moment. (next card 1s)`, 'status', h.id);
      return;
    default:
      levelUpCard(ctx);
  }
}

/**
 * Level-up cards (user, 2026-10-17): what a Character learns as they level, five a class. Numbers in CARD_RULES; the
 * fight-long effects they leave are kept on the Encounter and the units' statuses (see combat.ts).
 */
function levelUpCard(ctx: CardCtx) {
  const { world, enc, h, events } = ctx;
  const p = (n: number) => Math.max(1, Math.round(n * ctx.power));
  const enemies = () => monstersIn(world, enc.room);
  const front = () => combatOrder(world, enc).monsters[0] ?? null;
  const allies = () => enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  const others = () => allies().filter((a) => a !== h);
  const risen = () => risenAll(enc);
  const foe = (): Monster | null => {
    const m = ctx.target ? world.monsters[ctx.target] : undefined;
    return m && m.room === enc.room ? m : front();
  };
  /** The picked character if they're still standing here, else `fallback`. */
  const picked = (fallback: () => Hero | undefined): Hero | undefined => {
    const t = ctx.target ? world.heroes[ctx.target] : undefined;
    return t && isConscious(t) && t.encounter === enc.room ? t : fallback();
  };
  const name = (m: Monster) => ENEMIES[m.type].name;
  const tell = (text: string, kind: CombatEvent['kind'] = 'status', target?: string, amount?: number) =>
    events.push({ actor: h.id, kind, text, target, amount });
  const secs = (n: number) => world.time + buffLength(h, n);

  switch (ctx.card) {
    // ---- Warden ----
    case 'aegis': {
      const m = foe();
      if (!m) return;
      const pool = shieldPool(world, h);
      let dmg = Math.max(R.aegisMin, pool) * ctx.power;
      takeShield(world, h, Math.floor(pool * R.aegisCost));
      // It ricochets back down the line from the one it hit, half as hard each time.
      const line = combatOrder(world, enc).monsters;
      tell(`${h.name} hurls their shield!`, 'info', m.id);
      for (const o of line.slice(line.indexOf(m))) {
        if (dmg < 1) break;
        strike(ctx, o, dmg / ctx.power - eternalBonus(h) / ctx.power);
        dmg = Math.floor(dmg * R.aegisBounce);
      }
      return;
    }
    case 'linked': {
      const t = picked(() => undefined);
      if (!t || t === h) {
        const got = shieldOf(ctx, h, R.linkedShield);
        tell(`${h.name} sets their shield. (+${got} Shield)`, 'status', h.id);
        return;
      }
      // Undo any old links first: a Shield is shared with one other at a time.
      for (const x of [h, t]) {
        const old = x.st.link ? world.heroes[x.st.link] : undefined;
        if (old && old.st.link === x.id) delete old.st.link;
      }
      h.st.link = t.id;
      t.st.link = h.id;
      const got = shieldOf(ctx, h, R.linkedShield);
      tell(`${h.name} links shields with ${t.name}: one wall between them. (+${got} Shield, ${shieldPool(world, h)} together)`, 'status', t.id);
      return;
    }
    case 'mirror': {
      const got = shieldOf(ctx, h, R.mirrorShield);
      enc.mirror = (enc.mirror ?? 0) + 1;
      tell(`${h.name} raises a mirror-bright guard. (+${got} Shield; the next debuff from an enemy turns back)`, 'status', h.id);
      return;
    }
    case 'banner':
      (enc.banners ??= []).push(h.id);
      tell(`${h.name} plants a war banner! (every ally +${R.bannerShield} Shield at the start of each of their turns)`);
      return;
    case 'phalanx':
      enc.phalanx = true;
      tell(`${h.name} locks the line into a phalanx. (Shield anyone gains spills half to every other ally)`);
      return;
    // ---- Cutthroat ----
    case 'marked': {
      const m = foe();
      if (!m) return;
      m.st.marked = (m.st.marked ?? 0) + R.markedHits;
      placed(ctx, 'exposed', m);
      tell(`${h.name} marks the ${name(m)} for death. (next ${m.st.marked} hits crit)`, 'status', m.id);
      return;
    }
    case 'flurry': {
      for (let i = 0; i < R.flurryHits; i++) {
        const m = foe();
        if (!m) return;
        strike(ctx, m, R.flurry, { crit: !!(m.st.stun || m.st.exposed) });
      }
      return;
    }
    case 'coup': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.coup);
      if (!world.monsters[m.id]) {
        ctx.chain = true;
        tell(`${h.name} chains into the next move!`, 'status', h.id);
      }
      return;
    }
    case 'misdirect': {
      const m = foe();
      if (!m) return;
      const n = h.sneaking ? R.misdirectSneak : R.misdirect;
      m.st.misdirect = (m.st.misdirect ?? 0) + n;
      placed(ctx, 'blind', m);
      tell(`${h.name} misdirects the ${name(m)}. (its next ${n > 1 ? `${n} attacks hit` : 'attack hits'} its own)`, 'status', m.id);
      return;
    }
    case 'cuts':
      h.st.cuts = Math.max(h.st.cuts ?? 0, R.cutsStart);
      tell(`${h.name} starts to work with a thousand small cuts.`, 'status', h.id);
      return;
    // ---- Lampbearer ----
    case 'hymn': {
      let got = 0;
      for (const a of allies()) {
        a.st.overfill = true;
        got = Math.round(gainLight(a, lightBy(h, a, p(R.hymnLight))));
      }
      tell(`${h.name} sings a radiant hymn! (every character +${got} light, overfilling to ${R.hymnCap})`, 'light', h.id, got);
      return;
    }
    case 'lightwell':
      (enc.wells ??= []).push(h.id);
      tell(`${h.name} opens a Lightwell. (every card played here: +${R.wellLight} light, +${R.wellHeal} HP)`);
      return;
    case 'halo': {
      const t = picked(() => allies().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]) ?? h;
      t.st.halo = { until: secs(R.haloSecs), by: h.id };
      ward(h, t);
      tell(`A halo settles over ${t === h ? h.name : t.name}. (${R.haloSecs}s: every blow on them heals every ally ${R.haloHeal})`, 'status', t.id);
      return;
    }
    case 'march': {
      const n = Math.floor(h.light / R.marchPer);
      for (const a of [...allies(), ...risen()]) hurry(ctx, a, n);
      tell(`${h.name} leads the march by lamplight. (every ally ${n}s sooner)`);
      return;
    }
    case 'eternal':
      h.eternal = true;
      if (h.light < R.eternalFloor) h.light = R.eternalFloor;
      tell(`${h.name}'s lamp becomes eternal. (light never below ${R.eternalFloor}; +${R.eternalBonus} to every hit, heal and light, for the run)`, 'light', h.id);
      return;
    // ---- Sorceress ----
    case 'puppet': {
      const m = foe();
      if (!m) return;
      const n = anima(ctx) ? R.puppetAnima : R.puppet;
      m.st.charm = (m.st.charm ?? 0) + n;
      placed(ctx, 'hexed', m);
      tell(`${h.name} pulls the ${name(m)}'s strings. (its next ${n > 1 ? `${n} actions are` : 'action is'} against its own)`, 'status', m.id);
      return;
    }
    case 'surge': {
      const spent = h.anima;
      h.anima = 0;
      h.st.surge = 1 + (spent ? R.surgePer * spent : R.surgeBare);
      tell(`${h.name} gathers ${spent ? `all ${spent} Anima` : 'what power she has'} into her next spell. (×${h.st.surge})`, 'status', h.id);
      return;
    }
    case 'witching':
      enc.witching = secs(R.witchingSecs);
      tell(`The witching hour falls. (${R.witchingSecs}s: every debuff Hexes too)`);
      return;
    case 'bloodmoon': {
      if (anima(ctx)) tell(`${h.name} raises the blood moon on Anima alone.`);
      else {
        const cost = Math.min(h.hp - 1, afterBlock(h, R.bloodMoonHp));
        if (cost > 0) {
          h.hp -= cost;
          tell(`${h.name} bleeds to raise the blood moon.`, 'damage', h.id, cost);
        }
      }
      const until = secs(R.bloodMoonSecs);
      for (const a of allies()) a.st.lifesteal = until;
      for (const r of risen()) risenSt(world, r).lifesteal = until;
      tell(`A blood moon rises. (${R.bloodMoonSecs}s: every ally heals half the damage they deal)`);
      return;
    }
    case 'wander': {
      const m = foe();
      if (!m) return;
      const n = anima(ctx) ? R.wanderAnima : 1;
      m.st.wander = Math.max(m.st.wander ?? 0, n);
      strike(ctx, m, R.wander);
      debuff(ctx, m, 'hexed', R.hexedTurns);
      if (world.monsters[m.id]) tell(`${name(m)} carries a wandering curse. (Hexed ×${m.st.hexed?.length ?? 0})`, 'status', m.id);
      return;
    }
    // ---- Undertaker ----
    case 'danse': {
      const all = risen().filter((r) => enc.next[r.id] !== undefined);
      if (!all.length) {
        addAlly(ctx, 'rat');
        tell(`${h.name} calls the dance, and a Rat answers.`);
        return;
      }
      for (const r of all) enc.next[r.id] = at(world.time);
      tell(`${h.name} calls the danse macabre! Every summon moves now.`);
      return;
    }
    case 'plague': {
      enc.plague = true;
      const all = risen();
      for (const r of all) heal(r, healBy(h, p(R.plagueHeal)));
      if (!all.length) {
        const m = front();
        if (m) debuff(ctx, m, 'poison', R.plagueTurns, R.plaguePoison);
      }
      tell(`${h.name} spreads the plague among the dead. (every summon's attack Poisons)`);
      return;
    }
    case 'preserve': {
      const r = followingOf(world, h).filter((x) => !x.preserved).sort((a, b) => b.maxHp - a.maxHp)[0];
      if (!r) {
        const got = shieldOf(ctx, h, R.preserveBare);
        tell(`${h.name} has nothing to preserve, and braces. (+${got} Shield)`, 'status', h.id);
        return;
      }
      r.preserved = true;
      r.decay = 0;
      tell(`${h.name} preserves their ${risenName(world, r)}. It will not rot.`, 'status', r.id);
      return;
    }
    case 'claim': {
      const m = foe();
      if (!m) return;
      m.st.claimed = h.id;
      placed(ctx, 'hexed', m);
      tell(`${h.name} claims the ${name(m)}'s grave before it's dug.`, 'status', m.id);
      return;
    }
    case 'lord': {
      h.followCap = R.lordCap;
      for (const r of followingOf(world, h)) r.decay = 0;
      tell(`${h.name} is Lord of the Dead. (following ${R.lordCap}; all decay shed)`, 'status', h.id);
      return;
    }
    // ---- Bellwright ----
    case 'bellguard': {
      const got = shieldOf(ctx, h, Math.max(R.bellguardMin, R.bellguardPer * (h.st.clang?.stacks ?? 0)));
      h.st.clangHold = true;
      tell(`${h.name} stands under the bell. (+${got} Shield; Clang holds this fight)`, 'status', h.id);
      return;
    }
    case 'resonant': {
      const m = front();
      if (!m) return;
      strike(ctx, m, R.resonant);
      if (world.monsters[m.id]) {
        m.st.ringing = true;
        placed(ctx, 'stun', m);
        tell(`${name(m)} is Ringing.`, 'status', m.id);
      }
      return;
    }
    case 'discord': {
      addClang(h, R.discordClang);
      const next = enemies().filter((m) => enc.next[m.id] !== undefined).sort((a, b) => enc.next[a.id] - enc.next[b.id])[0];
      const t = picked(() => h) ?? h;
      if (!next) return;
      if (t === h) {
        ctx.discord = next.id;
        tell(`${h.name} strikes a discord: they and the ${name(next)} trade places in time.`, 'status', next.id);
        return;
      }
      if (enc.next[t.id] !== undefined && enc.next[t.id] > enc.next[next.id]) {
        const theirs = enc.next[next.id];
        enc.next[next.id] = enc.next[t.id];
        enc.next[t.id] = theirs;
        tell(`${h.name} strikes a discord: ${t.name} and the ${name(next)} trade places in time.`, 'status', t.id);
      } else tell(`${h.name} strikes a discord, but ${t.name} is ahead already.`, 'info', t.id);
      return;
    }
    case 'metronome': {
      const until = secs(R.metronomeSecs);
      for (const a of allies()) a.st.cadence = until;
      tell(`${h.name} sets a steady cadence. (${R.metronomeSecs}s: every card takes ${R.metronomeTime}s)`);
      return;
    }
    case 'tollthee': {
      const m = foe();
      if (!m) return;
      (m.st.knelled ??= []).push(h.id);
      placed(ctx, 'stun', m);
      tell(`Send not for me: the bell tolls for the ${name(m)}.`, 'status', m.id);
      return;
    }
    // ---- Zealot ----
    case 'eclipse': {
      const lost = Math.round(spendLight(h, h.light));
      (enc.eclipse ??= []).push(h.id);
      tell(`${h.name} eclipses their own light. Their fervour burns in everyone. (−${lost} light)`, 'light', h.id, -lost);
      return;
    }
    case 'brand': {
      const m = foe();
      if (!m) return;
      strike(ctx, m, R.brand);
      if (world.monsters[m.id]) {
        m.st.brand = h.id;
        placed(ctx, 'exposed', m);
        tell(`${name(m)} is Branded.`, 'status', m.id);
      }
      return;
    }
    case 'bloodforblood': {
      const t = picked(() => undefined);
      const other = t && t !== h ? t : others().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (!other) {
        const got = shieldOf(ctx, h, R.bloodBare);
        tell(`${h.name} has nobody to bleed for, and steels themself. (+${got} Shield)`, 'status', h.id);
        return;
      }
      const cost = Math.min(h.hp - 1, afterBlock(h, R.bloodHp));
      if (cost > 0) h.hp -= cost;
      const healed = heal(other, healBy(h, p(R.bloodHeal)));
      ward(h, other);
      tell(`${h.name} gives blood for blood. (−${Math.max(0, cost)} HP; ${other.name} +${healed})`, 'heal', other.id, healed);
      return;
    }
    case 'purge': {
      const lost = Math.round(spendLight(h, R.purgeLight));
      tell(`${h.name} burns their own light in a purging fire. (−${lost} light)`, 'light', h.id, -lost);
      for (const m of enemies()) strike(ctx, m, R.purge);
      return;
    }
    case 'litany': {
      const hits = Math.min(R.litanyMax, 1 + Math.floor(Math.max(0, LIGHT_MAX - h.light) / R.litanyPer));
      for (let i = 0; i < hits; i++) {
        const m = foe();
        if (!m) return;
        strike(ctx, m, R.litany);
      }
      return;
    }
    // ---- Alchemist ----
    case 'mutagen': {
      const t = picked(() => h) ?? h;
      const until = secs(R.mutagenSecs);
      t.st.mutated = until;
      t.st.regen = { amount: Math.max(R.mutagenRegen, t.st.regen?.amount ?? 0), until: Math.max(until, t.st.regen?.until ?? 0), next: world.time + R.pulse };
      ward(h, t);
      tell(`${t === h ? h.name : t.name} drinks the mutagen. (+${R.mutagenMult * 100}% damage, Regen ${R.mutagenRegen} for ${R.mutagenSecs}s; then Weak)`, 'status', t.id);
      return;
    }
    case 'bottomless':
      if (h.items.some((i) => ITEMS[i].kind === 'consumable')) {
        h.bottomless = true;
        tell(`${h.name} uncorks a bottomless flask. (their next item isn't used up)`, 'status', h.id);
      } else if (hasSpace(h)) {
        giveItem(h, 'bandage');
        tell(`${h.name} finds a Bandage at the bottom of the flask.`, 'status', h.id);
      } else tell(`${h.name}'s flask comes up empty.`, 'info');
      return;
    case 'corrosive':
      enc.corrosive = (enc.corrosive ?? 0) + 1;
      for (const m of enemies()) {
        debuff(ctx, m, 'acid', R.acidTurns);
        if (m.st.poison?.length) debuff(ctx, m, 'acid', R.acidTurns);
      }
      tell(`${h.name} looses a corrosive cloud. It hangs in the air.`);
      return;
    case 'flash':
      for (const m of enemies()) {
        strike(ctx, m, R.flash);
        debuff(ctx, m, 'blind');
      }
      tell(`${h.name} sets off flash powder! Every foe is Blinded.`);
      return;
    case 'distill': {
      const m = foe();
      if (!m) return;
      const left = (m.st.poison ?? []).reduce((s, pz) => s + pz.dmg * pz.rounds, 0);
      if (!left) {
        debuff(ctx, m, 'poison', R.distillTurns, R.distillPoison);
        tell(`${h.name} poisons the ${name(m)} to distil later.`, 'status', m.id);
        return;
      }
      delete m.st.poison;
      tickOn(world, m, Math.round(left * R.distillMult * ctx.power), events, 'distilled poison');
      return;
    }
  }
}

/** Claim the Grave: the claimed monster, slain, rises at once for its Undertaker at part of its HP. */
export function claimRise(world: World, enc: Encounter, h: Hero, dead: Slain, events: CombatEvent[]) {
  const ctx: CardCtx = { world, enc, h, card: 'claim', events, power: 1, prev: null, selfHurry: 0 };
  if (dead.id) world.risings = world.risings.filter((r) => r.id !== dead.id);
  const hp = Math.max(1, Math.round(dead.maxHp * R.claimHp));
  const unit = addAlly(ctx, dead.type, { maxHp: dead.maxHp, hp, dmgMult: dead.dmgMult });
  enc.next[unit.id] = at(world.time + 0.5);
  events.push({ actor: h.id, kind: 'status', target: unit.id, text: `The ${ENEMIES[dead.type].name} rises at once for ${h.name}: its grave was claimed.` });
}

/** Is `o`'s body (downed or dead) lying in `room`? */
function bodyHere(o: Hero, room: number): boolean {
  return o.pos.kind === 'room' && o.pos.room === room;
}

/** Kill a monster outright (Last Rites, Mercy Stroke, Promise). */
function applyKill(ctx: CardCtx, m: Monster) {
  if (ctx.world.monsters[m.id]) applyMonsterDamage(ctx.world, m, m.hp, ctx.events);
}

/** One Poison or Bleed tick of `dmg` on a monster (its Block and Acid count). */
export function tickOn(world: World, m: Monster, dmg: number, events: CombatEvent[], what: string) {
  const taken = monsterTakes(world, m, dmg);
  events.push({ actor: m.id, kind: 'damage', target: m.id, amount: taken, text: `${ENEMIES[m.type].name} takes ${taken} ${what} damage.` });
  applyMonsterDamage(world, m, taken, events);
}

/** Catalyst: a little Poison on everything, then every Poison and Bleed ticks once at once. */
function catalyst(ctx: CardCtx) {
  const { world, enc, h, events } = ctx;
  events.push({ actor: h.id, kind: 'status', text: `${h.name} hurls a catalyst! Every poison burns at once.` });
  for (const m of monstersIn(world, enc.room)) {
    debuff(ctx, m, 'poison', R.catalystTurns, R.catalystPoison);
    const ticks = [...(m.st.poison ?? []).map((x) => x.dmg), ...(m.st.bleed ?? []).map((x) => x.dmg)];
    for (const dmg of ticks) {
      if (!world.monsters[m.id]) break;
      tickOn(world, m, dmg, events, 'catalysed');
    }
  }
}
