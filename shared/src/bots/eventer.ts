import type { BotMemory } from './explorer';
import { LIGHT_MAX } from '../content/constants';
import { BOTS } from './tuning';
import type { PlayerView } from '../sim/views';
import type { Intent } from '../sim/world';

/**
 * Bots and room events: decide once per room, with mediocre-but-plausible judgement.
 * Returns an intent, or undefined if there's nothing to decide here.
 */
export function botEvent(view: PlayerView, mem: BotMemory): Intent | undefined {
  const ev = view.event;
  const you = view.you;
  if (!ev || ev.blocked || you.pos.kind !== 'room') return undefined;
  const room = you.pos.room;
  // Twin Locks are decided afresh as people come and go.
  if (ev.kind === 'locks') return botLocks(view, mem, room);
  // Already decided here (but keep channelling an altar/vault/Elite Event we chose to work on, or praying).
  if (mem.decided.includes(room) && !(mem.channelling === room && (ev.progress !== undefined || ev.kind === 'liturgy'))) return undefined;
  mem.decided.push(room);
  const rng = mem.rng;
  const timeLeft = mem.returnAt - view.time;
  // Risky events only when healthy.
  const healthy = you.hp / you.maxHp > 0.6;
  const pick = (id: string): Intent | undefined => {
    const c = ev.choices.find((x) => x.id === id);
    return c && !c.disabled ? { type: 'event', choice: id } : undefined;
  };
  /** Start (or keep at) a channel here. */
  const work = (id: string): Intent | undefined => {
    mem.channelling = room;
    return pick(id);
  };
  switch (ev.kind) {
    case 'villager': {
      // Deliver them to the rendezvous, then carry on exploring.
      const go = pick('lead');
      if (go) {
        // Picking up another on the way keeps the plan from before the first.
        if (mem.escortReturnAt === null) mem.escortReturnAt = mem.returnAt;
        mem.returnAt = view.time;
      }
      return go;
    }
    case 'altar':
      // A Sorceress wakes no guardians, so she needs neither the health nor the luck.
      if (timeLeft > 40 && (you.cls === 'sorceress' || (healthy && rng.chance(0.4)))) {
        mem.channelling = room;
        return pick('channel');
      }
      // The greedy sometimes take the gold and let everyone else pay for it.
      return mem.greed > 0.6 && rng.chance(0.3) ? work('desecrate') : undefined;
    case 'vault':
      if (timeLeft > 30 && rng.chance(0.5)) {
        mem.channelling = room;
        return pick('channel');
      }
      // In a hurry: smash it.
      return timeLeft > 10 && healthy && rng.chance(0.3) ? work('smash') : undefined;
    case 'idol':
      if (you.cls === 'cutthroat') return pick('take');
      if (mem.greed <= 0.5) return undefined;
      // Careful ones give up something from the pack rather than risk the way back.
      return (timeLeft > 30 && rng.chance(0.4) ? work('swap') : undefined) ?? pick('take');
    case 'stranger':
      if (you.cls === 'lampbearer' || (healthy && rng.chance(0.35))) return pick('help');
      return mem.greed > 0.6 && rng.chance(0.3) ? pick('search') : undefined;
    case 'well':
      if (you.cls === 'zealot') return you.hp < you.maxHp ? pick('drink') : undefined;
      if (you.light < 50 || rng.chance(0.3)) return pick('drink');
      return rng.chance(0.3) ? pick('wish') : undefined;
    case 'chest':
      if (you.cls === 'undertaker') return pick('open');
      // With time to spare, unbind it; otherwise open it if the lamp can spare it.
      if (timeLeft > 60 && rng.chance(0.4)) return work('unbind');
      return healthy && you.light > 40 && rng.chance(0.6) ? pick('open') : undefined;
    case 'crawlspace':
      if (view.time >= mem.returnAt && you.hp > 20 && you.items.includes('torch')) return pick('crawl');
      // Early and healthy, the greedy crawl after hidden loot.
      return timeLeft > 120 && healthy && mem.greed > 0.6 && rng.chance(0.3) ? pick('crawl-secret') : undefined;
    case 'quicksilver':
      if (you.cls === 'alchemist' || (healthy && rng.chance(0.5))) return pick('quaff');
      return rng.chance(0.4) ? pick('bottle') : undefined;
    case 'satchel':
      // Greedy bots take the money; it's heavy, so mostly early, while there's time to carry it. Late, a handful.
      if (mem.greed > 0.45 && timeLeft > 60) return pick('haul');
      return mem.greed > 0.3 ? pick('pocket') : undefined;
    case 'hourglass':
      // Better with company: wait for nobody, but always turn it when someone else is here. Alone, sometimes smash it.
      if (view.allies.some((a) => a.live && a.pos.kind === 'room' && a.pos.room === room)) return pick('turn');
      return rng.chance(0.6) ? pick(rng.chance(0.5) ? 'shatter' : 'turn') : undefined;
    case 'clockwork':
      if (timeLeft > 120 && rng.chance(0.5)) return work('wind');
      return timeLeft > 60 && rng.chance(0.3) ? work('overwind') : undefined;
    case 'coffin': {
      // Only with someone standing by to get them up again.
      const company = view.allies.some((a) => a.live && !a.downed && a.pos.kind === 'room' && a.pos.room === room);
      if (company && you.light <= 40 && rng.chance(0.6)) return pick('lie');
      return you.light > 40 && rng.chance(0.3) ? pick('lining') : undefined;
    }
    case 'anvil': {
      const forge = ev.choices.find((c) => c.id.startsWith('forge-') && !c.disabled);
      if (forge && timeLeft > 30 && rng.chance(0.7)) return work(forge.id);
      return timeLeft > 15 && rng.chance(0.5) ? work('temper') : undefined;
    }
    case 'loom':
      return pick('weave') ?? (rng.chance(0.15) ? work('unravel') : undefined);
    case 'scrying':
      if (rng.chance(0.5)) return pick('gaze');
      return rng.chance(0.4) ? pick('deep') : undefined;
    case 'crowned':
      // Only the greediest, early on and in good shape, dare wake him; the merely greedy pry at the throne.
      if (mem.greed > 0.7 && timeLeft > 150 && healthy && rng.chance(0.3)) return pick('rouse');
      return mem.greed > 0.5 && healthy && rng.chance(0.2) ? pick('pry') : undefined;
    // ---- Card events (user, 2026-10-16) ----
    case 'rack': {
      // Searched: take the first card offered.
      const offered = ev.choices.find((c) => c.id.startsWith('pick-') && !c.disabled);
      if (offered) {
        mem.channelling = null;
        return pick(offered.id);
      }
      if (mem.channelling === room) return work('rummage');
      return timeLeft > 40 && rng.chance(0.5) ? work('rummage') : pick('grab');
    }
    case 'duelist':
      return healthy && mem.greed > 0.5 && rng.chance(0.4) ? pick('duel') : pick('bow');
    case 'hearth':
      if (you.hp < you.maxHp * 0.8 || you.light < 50) return work('warm');
      return rng.chance(0.4) ? pick('ember') : undefined;
    case 'mirror': {
      if (you.hp > you.maxHp * 0.6 && rng.chance(0.4)) return pick('shard');
      const copy = ev.choices.find((c) => c.id.startsWith('copy-') && !c.disabled);
      return copy && rng.chance(0.5) ? work(copy.id) : undefined;
    }
    case 'oathstone':
      // Bots flee now and then, so never the Oath of Blood.
      return rng.chance(0.25) ? pick('grace') : undefined;
    case 'gambler':
      return rng.chance(0.3) ? pick('bet') : undefined;
    case 'lectern':
      return rng.chance(0.4) ? pick('skim') : undefined;
    case 'returns': {
      const restore = ev.choices.find((c) => c.id.startsWith('restore-') && !c.disabled);
      if (restore) return work(restore.id);
      return rng.chance(0.4) ? work('moment') : undefined;
    }
    // ---- Elite Events (only their own class gets choices; the rest see it veiled) ----

    case 'wanderers':
    case 'uprising':
    case 'zenith':
    case 'alacrity':
      return timeLeft > 20 ? work(ev.choices[0]?.id ?? '') : undefined;
    case 'cant':
      // A map is worth most early.
      return timeLeft > 60 ? work('read') : undefined;
    case 'sacrament':
      // Everyone pays for the Sorceress's speed: only sometimes, and only with time to use it.
      return timeLeft > 90 && (mem.sacrament ??= rng.chance(0.5)) ? work('partake') : undefined;
    case 'barrage':
      // Draws every monster near: only when healthy, and only sometimes.
      return timeLeft > 60 && healthy && (mem.barrage ??= rng.chance(0.5)) ? work('ring') : undefined;
    case 'liturgy': {
      // Pray for a while, as long as somebody (you included) still needs it.
      mem.prayUntil ??= view.time + BOTS.liturgyPray;
      const needed = you.light < LIGHT_MAX - 15 || you.hp < you.maxHp || view.allies.some((a) => !a.dead && !a.extracted && a.hp < a.maxHp);
      return view.time < mem.prayUntil && timeLeft > 20 && needed ? work('pray') : undefined;
    }
  }
  return undefined;
}

/**
 * Twin Locks: join anyone waiting on a wheel; with company in the room, sometimes take one and wait a while for them
 * to read it and take the other.
 */
function botLocks(view: PlayerView, mem: BotMemory, room: number): Intent | undefined {
  const ev = view.event!;
  const w = ev.worker;
  const turn: Intent = { type: 'event', choice: 'wheel' };
  if (w?.you) {
    // Holding a wheel: keep at it while it turns, or while there's still hope someone takes the other.
    if (w.secondsLeft !== null || view.time < (mem.locksUntil ?? 0)) return turn;
    mem.channelling = null;
    return undefined;
  }
  const c = ev.choices.find((x) => x.id === 'wheel');
  if (!c || c.disabled || mem.returnAt - view.time < 20) return undefined;
  if (w) {
    // Someone is waiting (or we're already on the other wheel).
    mem.channelling = room;
    return turn;
  }
  const company = view.allies.some((a) => a.live && !a.downed && a.pos.kind === 'room' && a.pos.room === room);
  if (mem.decided.includes(room)) return undefined;
  if (!company) {
    // Alone: now and then, force a wheel for the gold.
    mem.decided.push(room);
    const force = ev.choices.find((x) => x.id === 'force');
    if (!force || force.disabled || mem.returnAt - view.time < 45 || !mem.rng.chance(0.3)) return undefined;
    mem.channelling = room;
    return { type: 'event', choice: 'force' };
  }

  mem.decided.push(room);
  if (!mem.rng.chance(0.5)) return undefined;
  mem.locksUntil = view.time + BOTS.locksWait;
  mem.channelling = room;
  return turn;
}
