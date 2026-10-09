import { ABILITIES } from '../content/abilities';
import type { ItemId } from '../content/items';
import type { Rng } from '../rng';
import { BOTS } from './tuning';
import type { Choice, CombatAction } from '../sim/combat';
import type { CombatUnitView, EncounterView, PlayerView } from '../sim/views';


/**
 * Combat brain for bots: a sensible heuristic, deliberately flawed by random blunders
 * ("mediocre" per the plan). Uses only the encounter as the bot's hero sees it.
 */
export function chooseCombatAction(view: PlayerView, rng: Rng): Choice | null {
  const enc = view.encounter;
  if (!enc || enc.yourChoice) return null;
  const me = enc.heroes.find((h) => h.id === view.you.id);
  if (!me || me.downed) return null;

  const options = legalChoices(view, enc);
  if (options.length === 0) return { action: 'brace' };
  if (rng.chance(BOTS.blunder)) return rng.pick(options);

  const allies = enc.heroes.filter((h) => !h.downed);
  const downed = enc.heroes.filter((h) => h.downed);
  const enemies = enc.monsters;
  const ready = (i: 0 | 1 | 2) => (view.you.cooldowns[ABILITIES[view.you.cls][i].id] ?? 0) === 0;
  const weakestEnemy = minBy(enemies, (m) => m.hp);
  const softTarget = enemies.find((m) => m.st.mark || m.st.stun);
  const hurtAlly = minBy(allies.filter((a) => a.hp / a.maxHp < 0.5), (a) => a.hp / a.maxHp);

  const slot = (id: ItemId) => view.you.items.indexOf(id);
  if (downed.length && slot('salts') >= 0) return { action: 'item', item: slot('salts'), target: downed[0].id };
  if (downed.length && rng.chance(0.7)) return { action: 'revive', target: minBy(downed, (d) => d.bleedOut ?? 99)!.id };
  if (me.hp / me.maxHp < 0.35 && slot('bandage') >= 0) return { action: 'item', item: slot('bandage'), target: me.id };
  if (enemies.length >= 3 && slot('firebomb') >= 0 && rng.chance(0.6)) return { action: 'item', item: slot('firebomb') };
  if (view.you.light <= 0 && slot('torch') >= 0) return { action: 'item', item: slot('torch') };
  // Retreat when the fight is clearly being lost and nobody can patch us up.
  const enemyHp = enc.monsters.reduce((sum, m) => sum + m.hp, 0);
  const healer = enc.heroes.some((h) => h.cls === 'lampbearer' && !h.downed && h.id !== me.id);
  if (me.hp / me.maxHp < 0.35 && enemyHp > me.hp && !healer && !downed.length && rng.chance(0.6)) return { action: 'flee' };
  // At the open exit, fleeing means escaping the dungeon.
  const atOpenExit = enc.room === view.exitRoom && view.exitOpen;
  if (atOpenExit && (me.hp / me.maxHp < 0.5 || view.time > view.collapseAt - 90)) return { action: 'flee' };

  switch (view.you.cls) {
    case 'warden': {
      const fragile = allies.find((a) => a.id !== me.id && a.hp / a.maxHp < 0.4);
      if (fragile && ready(1)) return { action: 'a1', target: fragile.id };
      if (ready(0)) return { action: 'a0', target: (enemies.find((m) => m.rank === 'front') ?? weakestEnemy)!.id };
      if (ready(2) && (view.you.stress > 20 || allies.length > 1)) return { action: 'a2' };
      break;
    }
    case 'cutthroat':
      if (softTarget) return { action: 'a0', target: softTarget.id };
      if (ready(1) && enemies.length > 1) return { action: 'a1', target: maxBy(enemies, (m) => m.hp)!.id };
      if (me.hp / me.maxHp < 0.35 && ready(2)) return { action: 'a2' };
      return { action: 'a0', target: weakestEnemy!.id };
    case 'lampbearer':
      if (hurtAlly && ready(0)) return { action: 'a0', target: hurtAlly.id };
      if (enemies.length >= 2 && ready(1)) return { action: 'a1' };
      // Bots only know their own stress, so Vigil is self-care.
      if (ready(2) && view.you.stress > 30) return { action: 'a2', target: me.id };
      if (ready(1)) return { action: 'a1' };
      break;
    case 'hexer':
      if (enemies.length >= 3 && ready(2) && me.hp > 12) return { action: 'a2' };
      if (enemies.length >= 2 && ready(1)) return { action: 'a1', target: maxBy(enemies, (m) => m.maxHp)!.id };
      return { action: 'a0', target: (enemies.find((m) => !m.st.mark) ?? weakestEnemy)!.id };
  }
  // Fallback: any legal attack, else brace.
  const attack = options.find((o) => o.action.startsWith('a'));
  return attack ?? { action: 'brace' };
}

/** Every legal choice with a sensible target, used for blunders and fallbacks. */
function legalChoices(view: PlayerView, enc: EncounterView): Choice[] {
  const out: Choice[] = [];
  const me = view.you;
  const allies = enc.heroes.filter((h) => !h.downed);
  const front = enc.monsters.filter((m) => m.rank === 'front');
  ABILITIES[me.cls].forEach((ab, i) => {
    if ((me.cooldowns[ab.id] ?? 0) > 0) return;
    const action = `a${i}` as CombatAction;
    const pool: CombatUnitView[] | null =
      ab.target === 'enemy' ? enc.monsters
      : ab.target === 'enemyFront' ? (front.length ? front : enc.monsters)
      : ab.target === 'ally' ? allies
      : ab.target === 'otherAlly' ? allies.filter((a) => a.id !== me.id)
      : null;
    if (pool === null) out.push({ action });
    else for (const t of pool) out.push({ action, target: t.id });
  });
  return out;
}

function minBy<T>(arr: T[], f: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestV = Infinity;
  for (const x of arr) {
    const v = f(x);
    if (v < bestV) [best, bestV] = [x, v];
  }
  return best;
}

function maxBy<T>(arr: T[], f: (x: T) => number): T | undefined {
  return minBy(arr, (x) => -f(x));
}
