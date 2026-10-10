import { COLLAPSE_AT } from '../content/constants';
import { BOTS } from './tuning';
import { speedOf } from '../sim/speed';
import { Rng } from '../rng';
import type { PlayerView, RoomView } from '../sim/views';
import type { Intent } from '../sim/world';
import { botUseItem, botVote } from './looter';
import { botEvent } from './eventer';

/**
 * Exploration brain for bots. It only ever sees its own fog-filtered PlayerView,
 * so bots play by the same information rules as humans.
 */
export interface BotMemory {
  rng: Rng;
  /** 0.2–0.8. Greedier bots explore longer before heading to the rendezvous. */
  greed: number;
  /** Game time at which the bot starts heading for the exit. */
  returnAt: number;
  /** Bots pause briefly in each room, as a human would. */
  thinkUntil: number;
  /** Combat: which turn we're deciding for, and when we'll commit. */
  combatKey: string;
  decideAt: number;
  /** At the open exit: when this bot gives up waiting and leaves. */
  leaveAt: number | null;
  /** Rooms whose event this bot has already made up its mind about. */
  decided: number[];
  /** Room of the altar/vault this bot is working on. */
  channelling: number | null;
  /** While escorting a villager home: the return time to restore afterwards. */
  escortReturnAt: number | null;
  /** Remaining rooms of the route being walked. */
  route: number[];
  /** A bell this bot is answering: the room, and when it gives up. */
  answering: { room: number; until: number } | null;
  /** A call for help this bot is answering (the room), and calls it has already made up its mind about (by caller). */
  call?: number | null;
  judgedCalls?: string[];
  /** When this bot said it was ready to leave (E). */
  readySince?: number;
}

/** `start`: the clock when the run began (later for a Relic Rite run); the return time shrinks with the run. */
export function createBotMemory(seed: number, start = 0): BotMemory {
  const rng = new Rng(seed);
  const greed = rng.float(0.2, 0.8);
  // Greedier bots head home later (and are often late, by design).
  const returnAt = start + (BOTS.returnStart + ((greed - 0.2) / 0.6) * BOTS.returnSpan) * ((COLLAPSE_AT - start) / COLLAPSE_AT);
  return { rng, greed, returnAt, thinkUntil: 0, combatKey: '', decideAt: 0, leaveAt: null, decided: [], channelling: null, escortReturnAt: null, route: [], answering: null };
}

export function botThink(view: PlayerView, mem: BotMemory): Intent | null {
  const you = view.you;
  // A class skill is waiting on the timer: don't walk off and cancel it.
  if (view.phase !== 'running' || you.pos.kind !== 'room' || you.path.length > 0 || you.queuedSkill) return null;
  const here = you.pos.room;

  // Mid-route through rooms known to be clear: keep walking without stopping to think.
  const next = mem.route[0];
  const roomOf = (id: number) => view.rooms.find((r) => r.id === id);
  const allyDown = view.allies.some((a) => a.live && a.downed && !a.dead);
  if (next !== undefined && !allyDown && !view.loot?.items.length && !(view.event && !mem.decided.includes(here))) {
    const open = view.corridors.some((c) => !c.collapsed && ((c.a === here && c.b === next) || (c.b === here && c.a === next)));
    if (open && !(roomOf(next)?.threat ?? 0)) {
      mem.route.shift();
      return { type: 'goto', room: next };
    }
  }
  mem.route = [];

  if (view.time < mem.thinkUntil) return null;
  mem.thinkUntil = view.time + mem.rng.float(0.4, 1.6);

  // Get a downed ally in this room back up before anything else.
  const downed = view.allies.find((a) => a.live && a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
  if (downed) return { type: 'revive', target: downed.id };
  const vote = botVote(view);
  if (vote !== undefined) return vote;
  const use = botUseItem(view);
  if (use) return use;
  const ev = botEvent(view, mem);
  if (ev) return ev;

  // A call for help: drop everything for it if we can get there in time, else ignore it.
  const callGo = answerCall(view, mem, here);
  if (callGo) return callGo;

  const exit = view.rooms.find((r) => r.kind === 'exit');
  if (mem.escortReturnAt !== null && !view.leading) {
    // Villager delivered (or lost): back to the original plan.
    mem.returnAt = mem.escortReturnAt;
    mem.escortReturnAt = null;
  }
  if (exit && here === exit.id && view.time >= mem.returnAt) {
    if (!view.exitOpen) return null;
    // Wait a while for the others (they might be coming), unless hurt or out of time.
    if (mem.leaveAt === null) mem.leaveAt = view.time + mem.rng.float(8, BOTS.exitWaitMax);
    const hurt = you.hp / you.maxHp < 0.4;
    const late = view.time > view.collapseAt - 60;
    const everyoneHere = view.allies.every((a) => a.dead || a.extracted || (a.live && a.pos.kind === 'room' && a.pos.room === here));
    if (hurt || late || everyoneHere || view.time >= mem.leaveAt) {
      // Say so first (E): whoever is here and ready leaves with us. Nobody follows within a few seconds: go alone.
      if (!you.ready) {
        mem.readySince = view.time;
        return { type: 'ready', on: true };
      }
      if (view.time >= (mem.readySince ?? view.time) + BOTS.readyWait) return { type: 'extract' };
      return null;
    }
    // A Bellwright waiting at the open exit rings to call the stragglers home.
    if (you.cls === 'bellwright' && !(you.cooldowns.toll > 0)) return { type: 'skill', skill: 'toll' };
    return null;
  }
  const costs = viewDistances(view, here);
  // Routes that avoid rooms with known monsters (much more so when hurt).
  const hurt = 1 - you.hp / you.maxHp;
  const plan = planRoutes(view, here, 8 + 40 * hurt);
  const travel = (target: number): Intent | null => {
    const route = routeTo(plan.prev, here, target);
    if (!route || route.length === 0) return null;
    mem.route = route.slice(1);
    return { type: 'goto', room: route[0] };
  };

  // Rescue: an ally we saw go down nearby, while there's still time to reach them.
  const rescue = view.allies
    .filter((a) => a.downed && !a.dead && !a.extracted && a.pos.kind === 'room' && view.time - a.seenAt < 25)
    .map((a) => ({ a, cost: costs.get((a.pos as { room: number }).room) }))
    .filter((x) => x.cost !== undefined && x.cost <= 20 && view.time < view.collapseAt - 90)
    .sort((x, y) => x.cost! - y.cost!)[0];
  if (rescue) {
    const go = travel((rescue.a.pos as { room: number }).room);
    if (go) return go;
  }

  // A bell: an ally wants company there. Answer it if it's close enough, there's time, and we're fit.
  const heard = view.tolls.filter((t) => t.by !== you.id).at(-1);
  if (heard && heard.room !== here && (costs.get(heard.room) ?? Infinity) <= BOTS.tollAnswerCost) {
    mem.answering = { room: heard.room, until: view.time + BOTS.tollAnswerFor };
  }
  if (mem.answering && (mem.answering.room === here || view.time > mem.answering.until)) mem.answering = null;
  if (mem.answering && view.time < view.collapseAt - 90 && you.hp / you.maxHp >= 0.3) {
    const go = travel(mem.answering.room);
    if (go) return go;
  }

  // Badly hurt bots give up and head for the rendezvous early.
  if (exit && (view.time >= mem.returnAt || you.hp / you.maxHp < 0.3)) {
    if (costs.has(exit.id)) return travel(exit.id) ?? { type: 'goto', room: exit.id };
    // Route unknown: push into the unexplored room that looks closest to the exit.
    const frontier = frontierRooms(view, costs);
    if (frontier.length) {
      const best = minBy(frontier, (r) => Math.hypot(r.x - exit.x, r.y - exit.y) + costs.get(r.id)! * 4);
      return { type: 'goto', room: best.id };
    }
    // Walled in by rubble: dig out (here, or walk to the nearest rubble first).
    const rubbleHere = view.corridors.find((c) => c.collapsed && (c.a === here || c.b === here));
    if (rubbleHere) return { type: 'goto', room: rubbleHere.a === here ? rubbleHere.b : rubbleHere.a };
    const rubbleRooms = view.corridors.filter((c) => c.collapsed).flatMap((c) => [c.a, c.b]).filter((r) => costs.has(r));
    if (rubbleRooms.length) return { type: 'goto', room: minBy(rubbleRooms, (r) => costs.get(r)!) };
    return null;
  }

  // Explore: nearest frontier, with noise. Prefer exits other heroes haven't chalked, so bots spread out.
  const chalked = new Set(view.chalk.find((c) => c.room === here)?.marks.filter((m) => m.heroId !== you.id).map((m) => m.corridor));
  const frontier = frontierRooms(view, costs);
  if (frontier.length === 0) {
    if (exit && costs.has(exit.id)) return { type: 'goto', room: exit.id };
    // Nowhere left to go: dig out rather than wait.
    const rubbleHere = view.corridors.find((c) => c.collapsed && (c.a === here || c.b === here));
    if (rubbleHere) return { type: 'goto', room: rubbleHere.a === here ? rubbleHere.b : rubbleHere.a };
    const rubbleRooms = view.corridors.filter((c) => c.collapsed).flatMap((c) => [c.a, c.b]).filter((r) => costs.has(r) && r !== here);
    return rubbleRooms.length ? { type: 'goto', room: minBy(rubbleRooms, (r) => costs.get(r)!) } : null;
  }
  const roomById = new Map(view.rooms.map((r) => [r.id, r]));
  const best = minBy(frontier, (r) => {
    // Threat-weighted route cost: hurt bots steer well clear of known monsters.
    let score = (plan.cost.get(r.id) ?? Infinity) + mem.rng.float(0, 6);
    const firstCorridor = firstStepCorridor(view, here, r.id, costs, roomById);
    if (firstCorridor !== null && chalked.has(firstCorridor)) score += 6;
    return score;
  });
  return travel(best.id) ?? { type: 'goto', room: best.id };
}

/** Head for a call for help we heard, if it's reachable within `BOTS.callReach` seconds when first heard. */
function answerCall(view: PlayerView, mem: BotMemory, here: number): Intent | null {
  const judged = (mem.judgedCalls ??= []);
  const plan = planRoutes(view, here, 0);
  for (const c of view.calls) {
    if (c.by === view.you.id || judged.includes(c.by)) continue;
    judged.push(c.by);
    const route = routeTo(plan.prev, here, c.room);
    // Every tunnel takes one turn of our own Speed (a little more if it's rubble we'd dig through: not counted).
    if (route && route.length * speedOf(view.you, view.time) <= BOTS.callReach) mem.call = c.room;
  }
  if (mem.call === undefined || mem.call === null) return null;
  if (mem.call === here || !view.calls.some((c) => c.room === mem.call)) {
    mem.call = null;
    return null;
  }
  const route = routeTo(plan.prev, here, mem.call);
  if (!route || !route.length) {
    mem.call = null;
    return null;
  }
  mem.route = route.slice(1);
  return { type: 'goto', room: route[0] };
}

/** Dijkstra where entering a room with known monsters costs extra. */
export function planRoutes(view: PlayerView, start: number, threatPenalty: number) {
  const threat = new Map(view.rooms.map((r) => [r.id, r.threat ?? 0]));
  const adj = new Map<number, { to: number; len: number }[]>();
  for (const c of view.corridors) {
    if (c.collapsed) continue;
    (adj.get(c.a) ?? adj.set(c.a, []).get(c.a)!).push({ to: c.b, len: c.length });
    (adj.get(c.b) ?? adj.set(c.b, []).get(c.b)!).push({ to: c.a, len: c.length });
  }
  const cost = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  while (true) {
    let cur = -1;
    let best = Infinity;
    for (const [room, c] of cost) if (!done.has(room) && c < best) [cur, best] = [room, c];
    if (cur === -1) break;
    done.add(cur);
    for (const { to: n, len } of adj.get(cur) ?? []) {
      const nc = best + len + threatPenalty * (threat.get(n) ?? 0);
      if (nc < (cost.get(n) ?? Infinity)) {
        cost.set(n, nc);
        prev.set(n, cur);
      }
    }
  }
  return { cost, prev };
}

/** Rooms to walk through from `from` to `to` (excluding `from`), or null. */
function routeTo(prev: Map<number, number>, from: number, to: number): number[] | null {
  if (to === from) return [];
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let cur = to; cur !== from; cur = prev.get(cur)!) path.unshift(cur);
  return path;
}

function frontierRooms(view: PlayerView, costs: Map<number, number>): RoomView[] {
  return view.rooms.filter((r) => r.knowledge !== 'explored' && r.kind !== 'exit' && costs.has(r.id));
}

/** Dijkstra over the corridors in a view. */
export function viewDistances(view: PlayerView, start: number): Map<number, number> {
  const adj = new Map<number, { to: number; len: number }[]>();
  for (const c of view.corridors) {
    if (c.collapsed) continue;
    (adj.get(c.a) ?? adj.set(c.a, []).get(c.a)!).push({ to: c.b, len: c.length });
    (adj.get(c.b) ?? adj.set(c.b, []).get(c.b)!).push({ to: c.a, len: c.length });
  }
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>();
  while (true) {
    let cur = -1;
    let best = Infinity;
    for (const [room, cost] of dist) if (!done.has(room) && cost < best) [cur, best] = [room, cost];
    if (cur === -1) return dist;
    done.add(cur);
    for (const e of adj.get(cur) ?? []) {
      if (best + e.len < (dist.get(e.to) ?? Infinity)) dist.set(e.to, best + e.len);
    }
  }
}

/** The corridor out of `from` on a shortest path toward `to`. */
function firstStepCorridor(
  view: PlayerView, from: number, to: number, costs: Map<number, number>, rooms: Map<number, RoomView>,
): number | null {
  // Walk back from `to` along decreasing cost until we reach a neighbour of `from`.
  let cur = to;
  for (let guard = 0; guard < 64; guard++) {
    const room = rooms.get(cur);
    if (!room) return null;
    let stepped = false;
    for (const cid of room.corridors) {
      const c = view.corridors.find((x) => x.id === cid);
      if (!c) continue;
      const prev = c.a === cur ? c.b : c.a;
      if (Math.abs((costs.get(prev) ?? Infinity) + c.length - costs.get(cur)!) < 1e-6) {
        if (prev === from) return c.id;
        cur = prev;
        stepped = true;
        break;
      }
    }
    if (!stepped) return null;
  }
  return null;
}

function minBy<T>(arr: T[], f: (x: T) => number): T {
  let best = arr[0];
  let bestV = f(best);
  for (let i = 1; i < arr.length; i++) {
    const v = f(arr[i]);
    if (v < bestV) [best, bestV] = [arr[i], v];
  }
  return best;
}
