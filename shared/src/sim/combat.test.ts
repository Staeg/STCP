import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { BLEED_OUT, combatOrder, monstersIn, REVIVE_CHANNEL, spawnGroup } from './combat';
import { Game } from './game';
import { buildView } from './views';
import { speedOf } from './speed';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Heroes at the entrance, a monster group in the next room. */
function arena(classes: ClassId[], enemies: EnemyId[]) {
  const world = createWorld(777, { monsters: false });
  const d = world.dungeon;
  const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  return { world, d, ids, room, monsters };
}

/** Step until this unit has taken its next turn (or the fight is over). */
function untilTurn(world: World, room: number, id: string) {
  const enc = world.encounters[room];
  if (!enc) return;
  const due = enc.next[id];
  for (let i = 0; i < 200 && world.encounters[room] === enc && enc.next[id] === due; i++) step(world, 0.1);
}

function walkIn(world: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
}

describe('encounters', () => {
  it('starts a fight on entering a room with monsters and locks movement', () => {
    const { world, d, ids, room } = arena(['warden'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    expect(h.pos).toEqual({ kind: 'room', room });
    expect(h.encounter).toBe(room);
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    expect(h.path).toEqual([]);
    const view = buildView(world, 'h0');
    expect(view.encounter?.monsters).toHaveLength(1);
    expect(view.encounter?.heroes[0].speed).toBe(6);
    expect(view.encounter?.monsters[0].speed).toBe(5);
  });

  it('each unit acts when its own Speed timer runs out, falling back on the first ability if the hero has not picked', () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['giant']);
    walkIn(world, ids, room);
    monsters[0].hp = 999;
    const enc = world.encounters[room];
    const start = enc.startedAt;
    expect(enc.next.h0).toBeCloseTo(start + 3); // Cutthroat: Speed 3
    expect(enc.next[monsters[0].id]).toBeCloseTo(start + 8); // Bone Giant: Speed 8
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
    run(world, 2.5);
    expect(enc.events).toHaveLength(0); // picked, but it isn't their turn yet
    untilTurn(world, room, 'h0');
    expect(world.time - start).toBeCloseTo(3, 0);
    expect(enc.events.some((e) => e.text.includes('Backstab'))).toBe(true);
    expect(enc.choices.h0).toBeUndefined(); // a pick is used up by the turn
    expect(enc.next.h0).toBeCloseTo(start + 6);

    // Don't pick: when the turn comes the hero uses their first ability that's ready.
    untilTurn(world, room, 'h0');
    expect(enc.events.some((e) => e.text.includes('hesitates, then uses Backstab'))).toBe(true);
    // Two Cutthroat turns before the Giant's first.
    expect(enc.events.some((e) => e.actor === monsters[0].id)).toBe(false);
  });

  it('ties go to heroes before monsters, and to the leftmost hero (equal Speed: join order) before the rightmost', () => {
    // Cutthroat in a weapon and armor: 3 + 0.5 + 0.5 = 4, same as the Sorceress and the Acolyte.
    const { world, ids, room, monsters } = arena(['cutthroat', 'sorceress'], ['acolyte']);
    world.heroes.h0.weapon = 'shortsword';
    world.heroes.h0.armor = 'jerkin';
    monsters[0].hp = 999;
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    expect(enc.next.h0).toBe(enc.next.h1);
    expect(enc.next.h0).toBe(enc.next[monsters[0].id]);
    untilTurn(world, room, monsters[0].id);
    const order = enc.events.filter((e) => e.kind === 'info' && e.text.includes('hesitates')).map((e) => e.actor);
    expect(order).toEqual(['h0', 'h1']); // same Speed, so the Cutthroat (joined first, shown leftmost) goes first
    const firstMonster = enc.events.findIndex((e) => e.actor === monsters[0].id);
    const lastHero = enc.events.map((e) => e.actor).lastIndexOf('h1');
    expect(firstMonster).toBeGreaterThan(lastHero);
    expect(buildView(world, 'h0').encounter!.heroes.map((u) => u.id)).toEqual(['h0', 'h1']);
  });

  it('an undecided hero falls back on the next ability off cooldown, and braces only if none is ready', () => {
    const { world, ids, room, monsters } = arena(['lampbearer'], ['giant']);
    walkIn(world, ids, room);
    monsters[0].hp = 999;
    const enc = world.encounters[room];
    const h = world.heroes.h0;
    h.cooldowns = { mend: 2 };
    untilTurn(world, room, 'h0');
    expect(enc.events.some((e) => e.text.includes('hesitates, then uses Flare'))).toBe(true);
    h.cooldowns = { mend: 2, flare: 2, vigil: 2 };
    untilTurn(world, room, 'h0');
    expect(enc.events.some((e) => e.text.includes('hesitates and braces'))).toBe(true);
  });

  it('an ability picked without a target goes to the leftmost one when the turn comes', () => {
    const { world, ids, room } = arena(['cutthroat'], ['ghoul', 'ghoul', 'ghoul']);
    walkIn(world, ids, room);
    expect(applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1' } })).toBeUndefined();
    expect(world.encounters[room].choices.h0).toEqual({ action: 'a1', target: undefined });
    const leftmost = combatOrder(world, world.encounters[room]).monsters[0];
    untilTurn(world, room, 'h0');
    expect(leftmost.st.stun).toBeTruthy(); // Cheap Shot, not the fallback Backstab
    expect(monstersIn(world, room).filter((m) => m.st.stun)).toHaveLength(1);
  });

  it("shows allies' picks to everyone in the fight as soon as they're made", () => {
    const { world, ids, room, monsters } = arena(['cutthroat', 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
    const seen = buildView(world, 'h1').encounter!.heroes.find((u) => u.id === 'h0')!;
    expect(seen.choice).toBe('Backstab');
    expect(seen.choiceTarget).toBe(monsters[0].id);
    expect(buildView(world, 'h0').encounter!.heroes.find((u) => u.id === 'h1')!.choice).toBeUndefined();
  });

  it("enforces cooldowns in the hero's own turns (Cheap Shot: cooldown 4 = unusable for the next four turns)", () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['giant']);
    walkIn(world, ids, room);
    world.monsters[monsters[0].id].hp = 999;
    const enc = world.encounters[room];
    const cheap = () => applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: monsters[0].id } });
    const brace = () => applyIntent(world, 'h0', { type: 'combat', choice: { action: 'brace' } });
    cheap();
    expect(enc.choices.h0?.action).toBe('a1');
    untilTurn(world, room, 'h0'); // turn 1: Cheap Shot
    for (let turn = 2; turn <= 5; turn++) {
      cheap();
      expect(enc.choices.h0).toBeUndefined();
      brace();
      untilTurn(world, room, 'h0');
    }
    cheap();
    expect(enc.choices.h0?.action).toBe('a1');
  });

  it('cooldowns carry over after a fight and tick down once per Speed of time outside it', () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: monsters[0].id } });
    untilTurn(world, room, 'h0');
    expect(h.cooldowns.cheap).toBe(4);
    delete world.monsters[monsters[0].id];
    step(world, 0.1);
    expect(h.encounter).toBeNull();
    expect(h.cooldowns.cheap).toBe(4);
    run(world, 3.05); // Cutthroat: Speed 3
    expect(h.cooldowns.cheap).toBe(3);
    run(world, 9);
    expect(h.cooldowns.cheap).toBeUndefined();
  });

  it('ends on victory and frees movement', () => {
    const { world, d, ids, room, monsters } = arena(['cutthroat', 'sorceress'], ['crawler']);
    walkIn(world, ids, room);
    for (let i = 0; i < 10 && monstersIn(world, room).length; i++) {
      applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
      applyIntent(world, 'h1', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
      untilTurn(world, room, 'h0');
    }
    expect(monstersIn(world, room)).toHaveLength(0);
    step(world, 0.1);
    expect(world.encounters[room]).toBeUndefined();
    expect(world.heroes.h0.encounter).toBeNull();
    expect(world.heroes.h0.cooldowns).toEqual({});
    // The kill always drops something to vote on, but nobody has to stay for it.
    expect(world.piles[room]?.items.length).toBeGreaterThan(0);
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    expect(world.heroes.h0.path).toEqual([d.entrance]);
  });

  it('downed heroes bleed out unless revived; monsters ignore the downed', () => {
    const { world, ids, room } = arena(['sorceress'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.hp = 1;
    run(world, 12); // Hex by default; the ghoul hits; hero goes down
    expect(h.downedAt).not.toBeNull();
    expect(world.encounters[room]).toBeUndefined(); // no conscious heroes left → fight ends
    run(world, BLEED_OUT);
    expect(h.dead).toBe(true);
    expect(world.phase).toBe('wiped');
  });

  it('an ally can revive in combat (costs their turn) and out of combat (channel); the revived get a fresh timer', () => {
    const { world, ids, room } = arena(['warden', 'lampbearer'], ['ghoul']);
    walkIn(world, ids, room);
    const lamp = world.heroes.h1;
    const enc = world.encounters[room];
    lamp.hp = 0;
    lamp.downedAt = world.time;
    step(world, 0.1);
    expect(enc.next.h1).toBeUndefined(); // the downed don't get turns
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'revive', target: 'h1' } });
    untilTurn(world, room, 'h0');
    expect(lamp.downedAt).toBeNull();
    expect(lamp.hp).toBeGreaterThan(0);
    expect(enc.events.some((e) => e.kind === 'heal' && e.target === 'h1')).toBe(true);
    step(world, 0.1);
    expect(enc.next.h1! - world.time).toBeCloseTo(speedOf(lamp, world.time) - 0.1, 0); // slower now: going that low is a Major Injury

    // Kill the ghoul, then down the lampbearer outside combat and channel a revive.
    for (const m of monstersIn(world, room)) delete world.monsters[m.id];
    run(world, 4);
    expect(world.heroes.h0.encounter).toBeNull();
    lamp.hp = 0;
    lamp.downedAt = world.time;
    applyIntent(world, 'h0', { type: 'revive', target: 'h1' });
    run(world, REVIVE_CHANNEL - 0.5);
    expect(lamp.downedAt).not.toBeNull();
    run(world, 0.7);
    expect(lamp.downedAt).toBeNull();
  });

  it("Vengeance sends each attack on the Warden back at full strength, for the Warden's next 2 turns", () => {
    const { world, ids, room, monsters } = arena(['warden'], ['ghoul']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    walkIn(world, ids, room);
    monsters[0].hp = 999;
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1' } });
    untilTurn(world, room, 'h0');
    expect(h.st.vengeance).toBe(2);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'brace' } });
    untilTurn(world, room, monsters[0].id);
    const back = enc.events.find((e) => e.text.startsWith('Vengeance!'))!;
    const hit = enc.events.find((e) => e.actor === monsters[0].id && e.kind === 'damage' && e.target === 'h0')!;
    expect(back.target).toBe(monsters[0].id);
    expect(back.amount).toBeGreaterThan(hit.amount!); // returned before armor and Stalwart
    untilTurn(world, room, 'h0');
    untilTurn(world, room, 'h0');
    expect(h.st.vengeance).toBeUndefined();
  });

  it('fleeing heads back toward the previous room and leaves the fight', () => {
    const { world, d, ids, room } = arena(['cutthroat'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    for (let i = 0; i < 10 && h.encounter !== null; i++) {
      applyIntent(world, 'h0', { type: 'combat', choice: { action: 'flee' } });
      untilTurn(world, room, 'h0');
    }
    expect(h.encounter).toBeNull();
    expect(world.encounters[room]).toBeUndefined();
    expect(monstersIn(world, room).length).toBeGreaterThan(0);
    run(world, 3.2);
    expect(h.pos).toEqual({ kind: 'room', room: d.entrance });
  });

  it('a hero arriving mid-fight joins with a full Speed timer', () => {
    const { world, d, room } = arena(['warden'], ['giant']);
    walkIn(world, ['h0'], room);
    run(world, 1.5);
    const late = addHero(world, { id: 'late', name: 'Late', cls: 'sorceress' });
    expect(late.pos).toEqual({ kind: 'room', room: d.entrance });
    applyIntent(world, 'late', { type: 'goto', room });
    for (let i = 0; i < 60 && late.encounter === null; i++) step(world, 0.1);
    const enc = world.encounters[room];
    expect(enc.heroes).toContain('late');
    expect(enc.next.late - world.time).toBeCloseTo(4, 0);
  });
});

describe('Speed', () => {
  it('comes from class and worn gear (cursed jewelry quickens), and sets how long a tunnel takes', () => {
    const world = createWorld(777, { monsters: false, loot: false, escalates: false });
    const d = world.dungeon;
    const h = addHero(world, { id: 'h', name: 'H', cls: 'lampbearer' });
    h.weapon = 'mace';
    h.armor = 'cuirass';
    h.amulet = 'coin';
    h.items = ['bandage', 'gem'];
    expect(buildView(world, 'h').you.maxHp).toBe(45);
    expect(speedOf({ ...h, ring: 'quickblood' }, 0)).toBe(5);
    const next = neighbours(d, d.entrance)[0];
    // The timer running when the gear went on is the old 5s one; the next one (from 5s) carries the weight.
    run(world, 5.2);
    applyIntent(world, 'h', { type: 'goto', room: next });
    step(world, 0.1);
    expect(h.pos.kind === 'corridor' && h.pos.dur).toBe(6); // 5 + 0.5 + 0.5; blessed amulets and pack items weigh nothing
    run(world, 5.5);
    expect(h.pos.kind).toBe('corridor');
    run(world, 0.3);
    expect(h.pos).toEqual({ kind: 'room', room: next });
  });

  it('heroes who take the same tunnel the same way arrive together, at the slower one\'s pace', () => {
    const world = createWorld(777, { monsters: false, loot: false, escalates: false });
    const d = world.dungeon;
    const fast = addHero(world, { id: 'f', name: 'F', cls: 'cutthroat' });
    const slow = addHero(world, { id: 's', name: 'S', cls: 'warden' });
    const next = neighbours(d, d.entrance)[0];
    applyIntent(world, 'f', { type: 'goto', room: next });
    applyIntent(world, 's', { type: 'goto', room: next });
    run(world, 4);
    expect(fast.pos.kind).toBe('corridor'); // waiting for the Warden
    run(world, 2.1);
    expect(fast.pos).toEqual({ kind: 'room', room: next });
    expect(slow.pos).toEqual({ kind: 'room', room: next });

    // Going separate ways, nobody waits.
    const [a, b] = neighbours(d, next).filter((r) => r !== d.entrance).concat(d.entrance);
    applyIntent(world, 'f', { type: 'goto', room: a });
    applyIntent(world, 's', { type: 'goto', room: b });
    run(world, 3.2);
    expect(fast.pos).toEqual({ kind: 'room', room: a });
    expect(slow.pos.kind).toBe('corridor');
  });
});

describe('full bot games with monsters', () => {
  it('play out without errors, with fights, downs and survivors', { timeout: 30000 }, () => {
    let fights = 0;
    let survivors = 0;
    let deaths = 0;
    let total = 0;
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const game = new Game(seed, [
        { id: 'a', name: 'A', cls: 'warden', isBot: true },
        { id: 'b', name: 'B', cls: 'cutthroat', isBot: true },
        { id: 'c', name: 'C', cls: 'lampbearer', isBot: true },
        { id: 'd', name: 'D', cls: 'sorceress', isBot: true },
      ]);
      for (let t = 0; t < COLLAPSE_AT + 1 && game.world.phase === 'running'; t += 0.1) game.tick(0.1);
      fights += game.world.stats.slain;
      for (const h of Object.values(game.world.heroes)) {
        total++;
        if (h.dead) deaths++;
        else survivors++;
      }
    }
    expect(fights).toBeGreaterThan(20); // monsters were actually killed
    expect(survivors).toBeGreaterThan(0);
    // Not asserting balance here — that's M8. Just log it.
    console.log(`bot games: ${fights} monsters slain, ${deaths}/${total} heroes died`);
  });
});
