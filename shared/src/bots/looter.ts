import { LIGHT_DIM } from '../content/constants';
import { gearGain, isGear } from '../content/items';
import { BOT_DEFER_AFTER, LEAVE } from '../sim/loot';
import type { PlayerView } from '../sim/views';
import type { Intent } from '../sim/world';

/**
 * Loot votes for bots. A bot first backs whoever its heuristic likes, then after a couple of
 * seconds defers to the humans' majority. In an all-bot room every bot converges on the
 * lowest-id bot's choice, so votes can never deadlock.
 * Returns an intent, null to wait, or undefined if there's no vote to deal with.
 */
export function botVote(view: PlayerView): Intent | null | undefined {
  const vote = view.loot?.vote;
  const me = view.you;
  if (!vote || !vote.voters.includes(me.id)) return undefined;
  const current = vote.votes[me.id];
  const isBot = (id: string) => (id === me.id ? me.isBot : view.allies.find((a) => a.id === id)?.isBot ?? false);

  let choice = preferredRecipient(view);
  if (view.time - vote.startedAt >= BOT_DEFER_AFTER) {
    const humanVotes = vote.voters.filter((v) => !isBot(v)).map((v) => vote.votes[v]).filter((v): v is string => !!v);
    if (humanVotes.length) {
      choice = majority(humanVotes);
    } else if (vote.voters.every(isBot)) {
      const leader = [...vote.voters].sort()[0];
      if (leader !== me.id && vote.votes[leader]) choice = vote.votes[leader];
    }
  }
  return choice !== current ? { type: 'vote', choice } : null;
}

function preferredRecipient(view: PlayerView): string {
  const vote = view.loot!.vote!;
  const me = view.you;
  const cands = vote.candidates;
  if (cands.length === 0) return LEAVE;
  const meCand = cands.find((c) => c.id === me.id);
  const hpFrac = (id: string) => {
    if (id === me.id) return me.hp / me.maxHp;
    const a = view.allies.find((x) => x.id === id);
    return a ? a.hp / a.maxHp : 1;
  };
  if (isGear(vote.item)) {
    // Whoever it's the biggest upgrade for (ties: me). Nobody gains → leave it, so swaps can't ping-pong.
    const best = cands
      .map((c) => ({ id: c.id, gain: gearGain(vote.item, c.wearing ?? null) }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain || Number(b.id === me.id) - Number(a.id === me.id))[0];
    return best ? best.id : LEAVE;
  }
  switch (vote.item) {
    case 'bandage':
      return [...cands].sort((a, b) => hpFrac(a.id) - hpFrac(b.id))[0].id;
    case 'torch':
      return meCand && me.light < 60 ? me.id : cands[0].id;
    case 'locket':
      return [...cands].sort((a, b) => hpFrac(a.id) - hpFrac(b.id))[0].id;
    default:
      // Mediocre and a bit selfish: keep it if there's room, else hand it to whoever has the most space.
      return meCand ? me.id : [...cands].sort((a, b) => b.free - a.free)[0].id;
  }
}

function majority(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Use a consumable out of combat when it obviously helps. */
export function botUseItem(view: PlayerView): Intent | null {
  const me = view.you;
  if (me.cls === 'lampbearer' && view.time >= me.fieldMendAt && me.pos.kind === 'room') {
    const here = me.pos.room;
    const hurt = [
      { id: me.id, frac: me.hp / me.maxHp },
      ...view.allies
        .filter((a) => a.live && !a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here && a.affliction !== 'paranoid')
        .map((a) => ({ id: a.id, frac: a.hp / a.maxHp })),
    ].sort((a, b) => a.frac - b.frac)[0];
    if (hurt && hurt.frac < 0.75) return { type: 'fieldMend', target: hurt.id };
  }
  const idx = (pred: (id: string) => boolean) => me.items.findIndex(pred);
  const hp = me.hp / me.maxHp;
  let i = idx((x) => x === 'bandage');
  if (i >= 0 && (hp < 0.5 || me.st.bleed)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'torch');
  if (i >= 0 && me.light < LIGHT_DIM + 5) return { type: 'useItem', index: i };
  i = idx((x) => x === 'tonic');
  if (i >= 0 && me.stress > 50) return { type: 'useItem', index: i };
  i = idx((x) => x === 'salts');
  const downed = view.allies.find((a) => a.live && a.downed && !a.dead);
  if (i >= 0 && downed) return { type: 'useItem', index: i, target: downed.id };
  return null;
}

