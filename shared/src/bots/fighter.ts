import type { ItemId } from '../content/items';
import type { Rng } from '../rng';
import { BOTS } from './tuning';
import { CARDS } from '../content/cards';
import type { Choice } from '../sim/combat';
import type { CardView, EncounterView, PlayerView } from '../sim/views';
import { cardValue, type BotFight } from './cards';

/**
 * Combat brain for bots: a sensible heuristic, deliberately flawed by random blunders ("mediocre" per the plan).
 * Uses only the encounter as the bot's hero sees it. Since M15 it weighs each card in hand by what it would do for
 * the time it takes, and never plays one the fight screen marks as useless unless it has nothing else.
 */
export function chooseCombatAction(view: PlayerView, rng: Rng): Choice | null {
  const enc = view.encounter;
  if (!enc || enc.yourChoice) return null;
  const me = enc.heroes.find((h) => h.id === view.you.id);
  if (!me || me.downed) return null;

  const allies = enc.heroes.filter((h) => !h.downed);
  const downed = enc.heroes.filter((h) => h.downed);
  const enemies = enc.monsters;
  const slot = (id: ItemId) => view.you.items.indexOf(id);
  if (downed.length && slot('salts') >= 0) return { action: 'item', item: slot('salts'), target: downed[0].id };
  if (downed.length && enc.reviveTargets.length && rng.chance(0.7)) return { action: 'revive', target: minBy(downed, (d) => d.dying ?? 99)!.id };
  if (me.hp / me.maxHp <= 1 - BOTS.consumeAt && slot('bandage') >= 0) return { action: 'item', item: slot('bandage'), target: me.id };
  if (enemies.length > BOTS.firebombAbove && slot('firebomb') >= 0) return { action: 'item', item: slot('firebomb') };
  if (view.you.light <= 0 && slot('torch') >= 0) return { action: 'item', item: slot('torch') };
  // Retreat when the fight is clearly being lost and nobody can patch us up.
  const enemyHp = enemies.reduce((sum, m) => sum + m.hp, 0);
  const healer = enc.heroes.some((h) => h.cls === 'lampbearer' && !h.downed && h.id !== me.id);
  // At the exit, fleeing means escaping the dungeon: do it when hurt, out of time, or losing the fight.
  const atOpenExit = enc.room === view.exitRoom;
  const ourHp = allies.reduce((sum, h) => sum + h.hp, 0);
  const leave = (atOpenExit && (me.hp / me.maxHp < BOTS.exitFleeAt || enemyHp > ourHp || view.time > view.collapseAt - 90))
    || (me.hp / me.maxHp < BOTS.fleeAt && enemyHp > me.hp && !healer && !downed.length && rng.chance(0.6));
  if (leave) {
    // A sure way out in hand beats a coin toss.
    const out = enc.yourHand.find((c) => c.card === 'slipaway' || c.card === 'waystep');
    if (out) return { action: 'card', card: out.card, ...(out.card === 'waystep' ? { room: view.exitRoom } : {}) };
    return { action: 'flee' };
  }
  if (!enc.yourHand.length) return { action: 'brace' };

  const fight: BotFight = { view, enc, me, allies, enemies, losing: enemyHp > ourHp, rng };
  const useful = enc.yourHand.filter((c) => !c.weak);
  const pool = useful.length ? useful : enc.yourHand;
  if (rng.chance(BOTS.blunder)) {
    // A blunder: some other card in hand, but never one that would do nothing at all.
    const c = rng.pick(pool);
    return aim(fight, c);
  }
  let best: { c: CardView; v: number } | null = null;
  for (const c of pool) {
    const v = cardValue(fight, c.card) / Math.max(1, c.time);
    if (!best || v > best.v) best = { c, v };
  }
  return aim(fight, best!.c);
}

/** The card, aimed as the bot would: its value function's pick, else the sensible default. */
function aim(f: BotFight, c: CardView): Choice {
  const def = CARDS[c.card];
  if (def.target === 'room') return { action: 'card', card: c.card, room: f.view.exitRoom };
  if (def.target === 'enemy') return { action: 'card', card: c.card, target: enemyFor(f, c.card) ?? c.targets[0] };
  if (def.target === 'ally') return { action: 'card', card: c.card, target: allyFor(f, c.card) ?? c.targets[0] };
  return { action: 'card', card: c.card };
}

/** Who a bot hits: Backstab what's open, Cheap Shot the hardest hitter, finishers the most hurt, else Queen, Lich, weakest. */
function enemyFor(f: BotFight, card: Choice['card']): string | undefined {
  const { enemies } = f;
  const soft = enemies.find((m) => m.st.stun || m.st.exposed || !m.st.acted);
  if (card === 'backstab' && soft) return soft.id;
  if (card === 'cheap') return maxBy(enemies, (m) => m.maxHp)?.id;
  if (card === 'rites' || card === 'mercy') return minBy(enemies, (m) => m.hp / m.maxHp)?.id;
  if (card === 'hex') return (maxBy(enemies.filter((m) => m.st.hexed?.length), (m) => m.st.hexed!.length) ?? priority(f))?.id;
  if (card === 'acid' || card === 'envenom') return maxBy(enemies, (m) => m.hp)?.id;
  return priority(f)?.id;
}

/** The Forsaken Queen heals and hastens the rest, the Lich sears everyone every turn: kill them first, else the weakest. */
function priority(f: BotFight) {
  return f.enemies.find((m) => m.enemy === 'queen') ?? f.enemies.find((m) => m.enemy === 'lich') ?? minBy(f.enemies, (m) => m.hp);
}

/** Who a bot helps: the most stressed for stress cards, whoever carries items for Elixir, else the most hurt. */
function allyFor(f: BotFight, card: Choice['card']): string | undefined {
  const { allies, me } = f;
  if (card === 'sins') return maxBy(allies.filter((a) => a.id !== me.id), (a) => a.stress ?? 0)?.id ?? me.id;
  if (card === 'vigil' || card === 'shrug2') return maxBy(allies, (a) => a.stress ?? 0)?.id;
  if (card === 'elixir') return me.id;
  if (card === 'signal') return maxBy(allies.filter((a) => a.id !== me.id), (a) => a.nextIn ?? 0)?.id ?? me.id;
  return minBy(allies, (a) => a.hp / a.maxHp)?.id;
}

export function minBy<T>(arr: T[], f: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestV = Infinity;
  for (const x of arr) {
    const v = f(x);
    if (v < bestV) [best, bestV] = [x, v];
  }
  return best;
}

export function maxBy<T>(arr: T[], f: (x: T) => number): T | undefined {
  return minBy(arr, (x) => -f(x));
}

export type { EncounterView };
