import { describe, expect, it } from 'vitest';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { onHeroInRoom, spawnGroup } from '../sim/combat';
import { Game } from '../sim/game';
import { buildView } from '../sim/views';
import { applyIntent, step } from '../sim/world';
import { planRoutes } from './explorer';

function quietGame(bots: { id: string; cls: 'warden' | 'cutthroat' | 'lampbearer' | 'sorceress'; isBot: boolean }[]) {
  return new Game(5150, bots.map((b) => ({ ...b, name: b.id })), { monsters: false, loot: false, escalates: false, events: false });
}

describe('bot routing', () => {
  it('planRoutes avoids a known monster room when a detour exists', () => {
    // Find a seed/room layout with a loop: two different 2-hop routes between rooms.
    const game = quietGame([{ id: 'me', cls: 'warden', isBot: false }]);
    const w = game.world;
    const d = w.dungeon;
    // Reveal everything to the hero for this test.
    const me = w.heroes.me;
    me.explored = d.rooms.map((r) => r.id);
    me.seen = d.rooms.map((r) => r.id);
    // Find a cycle a-b-c-d-a (grid squares exist where loops were added).
    let found: { a: number; b: number; c: number; x: number } | null = null;
    for (const a of d.rooms) {
      for (const b of neighbours(d, a.id)) {
        for (const c of neighbours(d, b)) {
          if (c === a.id) continue;
          const x = neighbours(d, a.id).find((n) => n !== b && neighbours(d, n).includes(c));
          if (x !== undefined) found = { a: a.id, b, c, x };
        }
      }
    }
    if (!found) return; // layout without loops: nothing to test
    me.knownThreat[found.b] = 2;
    const view = buildView(w, 'me');
    const plan = planRoutes(view, found.a, 40);
    // Walk prev pointers back from c: the route should go through x, not b.
    let cur = found.c;
    const via: number[] = [];
    while (cur !== found.a && plan.prev.has(cur)) {
      cur = plan.prev.get(cur)!;
      via.push(cur);
    }
    expect(via).not.toContain(found.b);
  });
});

describe('bot rescue', () => {
  it('a bot that sees an ally go down next door goes and revives them', () => {
    const game = quietGame([
      { id: 'bot', cls: 'warden', isBot: true },
      { id: 'me', cls: 'sorceress', isBot: false },
    ]);
    const w = game.world;
    const d = w.dungeon;
    const next = neighbours(d, d.entrance)[0];
    // Keep the bot home by giving it nothing else to do: stand it still for a moment.
    applyIntent(w, 'me', { type: 'goto', room: next });
    const len = corridorBetween(d, d.entrance, next)!.length;
    for (let t = 0; t < len + 0.5; t += 0.1) step(w, 0.1);
    // Bring the bot back to the entrance in case it wandered, then down the human next door.
    w.heroes.bot.pos = { kind: 'room', room: d.entrance };
    w.heroes.bot.path = [];
    game.bots.get('bot')!.route = [];
    const me = w.heroes.me;
    me.hp = 0;
    me.downedAt = w.time;
    step(w, 0.1); // the bot sees it happen
    for (let t = 0; t < 25 && me.downedAt !== null; t += 0.1) game.tick(0.1);
    expect(me.downedAt).toBeNull();
    expect(me.dead).toBe(false);
  });
});

describe('bot retreat', () => {
  it('a badly hurt bot facing a strong group sometimes flees', () => {
    let fled = 0;
    for (let seed = 0; seed < 20; seed++) {
      const game = new Game(900 + seed, [{ id: 'bot', name: 'B', cls: 'sorceress', isBot: true }], {
        monsters: false, loot: false, escalates: false, events: false,
      });
      const w = game.world;
      const room = neighbours(w.dungeon, w.dungeon.entrance)[0];
      spawnGroup(w, room, ['brute'], 3);
      const h = w.heroes.bot;
      h.pos = { kind: 'room', room };
      h.prevRoom = w.dungeon.entrance;
      h.hp = 9;
      onHeroInRoom(w, h, room);
      for (let t = 0; t < 15; t += 0.1) {
        game.tick(0.1);
        if (h.encounter === null && !(h.pos.kind === 'room' && h.pos.room === room)) {
          fled++;
          break;
        }
      }
    }
    expect(fled).toBeGreaterThan(3);
  });
});
