import { describe, expect, it } from 'vitest';
import { EXIT_OPENS_AT } from './content/constants';
import { CR_RULES, ENEMIES } from './content/enemies';
import { CLASSES } from './content/classes';
import { Rng } from './rng';
import { Stash } from './stash';
import { emptyKit, heroCr, KIT_RULES, kitCr, kitError, rollCr, type Kit, type Loadout } from './village';
import { Game } from './sim/game';
import { addHero, createWorld, step } from './sim/world';
import { canTake } from './sim/loot';
import { bleedOut, damageMult, spawnGroup } from './sim/combat';
import { speedOf } from './sim/speed';
import { LobbyManager, type Socket } from './lobby';
import type { ServerMsg } from './protocol';

const loadout = (kit: Partial<Kit>): Loadout => ({
  charId: 'c1', charName: 'Ilse', owner: 'Ann', talent: null, injuries: [], affliction: null, kit: { ...emptyKit(), ...kit },
});
const quiet = () => createWorld(5, { monsters: false, loot: false, escalates: false, events: false });
const full = { effigy: 5, gem: 5, tome: 5, relic: 5 };

describe('the kit and Challenge Rating', () => {
  it('Gear adds 0.1 CR per level, an Effigy Rite +1 and a Gem Rite −0.5; consumables are free', () => {
    expect(kitCr({ gear: { weapon: 'shortsword', armor: 'cuirass', ring: 'catseye' }, consumables: ['bandage', 'torch'], rites: [] })).toBe(0.7);
    expect(kitCr({ gear: {}, consumables: [], rites: ['effigy', 'gem'] })).toBe(0.5);
    expect(heroCr('ironOath', { gear: { weapon: 'mace' }, consumables: [], rites: [] })).toBe(1.2);
  });

  it('a fractional CR is the chance of the next one up', () => {
    const rng = new Rng(7);
    const rolls = Array.from({ length: 4000 }, () => rollCr(2.7, rng));
    expect(new Set(rolls)).toEqual(new Set([2, 3]));
    expect(rolls.filter((r) => r === 3).length / rolls.length).toBeCloseTo(0.7, 1);
    expect(rollCr(-0.5, rng)).toBe(0);
    expect(rollCr(3, rng)).toBe(3);
  });

  it('checks the kit against the Stash: slots, at most 2 consumables, 5 Resources per Rite', () => {
    const stash = ['bandage', 'bandage', 'torch', 'mace', 'locket'] as const;
    expect(kitError({ gear: { weapon: 'mace', amulet: 'locket' }, consumables: ['bandage', 'bandage'], rites: ['relic'] }, stash, full)).toBeNull();
    expect(kitError({ gear: { armor: 'mace' }, consumables: [], rites: [] }, stash, full)).toMatch(/isn't worn there/);
    expect(kitError({ gear: { weapon: 'runeblade' }, consumables: [], rites: [] }, stash, full)).toMatch(/no Runed Blade/);
    expect(kitError({ gear: {}, consumables: ['bandage', 'bandage', 'torch'], rites: [] }, stash, full)).toMatch(/At most 2/);
    expect(kitError({ gear: {}, consumables: ['torch', 'torch'], rites: [] }, stash, full)).toMatch(/no more Torch/);
    expect(kitError({ gear: {}, consumables: [], rites: ['tome'] }, stash, { ...full, tome: 4 })).toMatch(/needs 5 Tomes/);
  });
});

describe('the Village Stash', () => {
  it('keeps what was carried out (Resources counted, not sold), and the kit leaves it when a run starts', () => {
    const stash = new Stash(null);
    stash.storeLoot('Ann', ['bandage', 'mace', 'effigy', 'effigy', 'effigy', 'effigy', 'effigy', 'gem']);
    let v = stash.village('Ann');
    expect(v.items).toEqual(['bandage', 'mace']);
    expect(v.resources).toEqual({ effigy: 5, gem: 1, tome: 0, relic: 0 });
    expect(stash.setKit('Ann', { gear: { weapon: 'mace' }, consumables: ['bandage'], rites: ['effigy'] })).toBeNull();
    expect(stash.setKit('Ann', { gear: {}, consumables: [], rites: ['gem'] })).toMatch(/needs 5 Gems/);
    const kit = stash.takeKit('Ann');
    expect(kit).toEqual({ gear: { weapon: 'mace' }, consumables: ['bandage'], rites: ['effigy'] });
    v = stash.village('Ann');
    expect(v.items).toEqual([]);
    expect(v.resources.effigy).toBe(0);
    expect(v.kit).toEqual(emptyKit());
  });
});

describe('heroes with a kit', () => {
  it('wear the Gear and carry the consumables they brought', () => {
    const world = quiet();
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden', loadout: loadout({ gear: { weapon: 'mace', amulet: 'locket' }, consumables: ['bandage', 'torch'] }) });
    expect(h.weapon).toBe('mace');
    expect(h.amulet).toBe('locket');
    expect(h.items).toEqual(['bandage', 'torch']);
    expect(h.hp).toBe(h.maxHp);
    expect(h.maxHp).toBe(CLASSES.warden.maxHp + 8);
  });

  it('Effigy: +20% damage and HP, 1s faster. Tome: −20%, and their gold goes home if they die', () => {
    const world = quiet();
    const plain = addHero(world, { id: 'p', name: 'P', cls: 'warden' });
    const eff = addHero(world, { id: 'e', name: 'E', cls: 'warden', loadout: loadout({ rites: ['effigy'] }) });
    const tome = addHero(world, { id: 't', name: 'T', cls: 'warden', loadout: loadout({ rites: ['tome'] }) });
    expect(eff.maxHp).toBe(Math.round(plain.maxHp * KIT_RULES.effigyMult));
    expect(damageMult(eff) / damageMult(plain)).toBeCloseTo(KIT_RULES.effigyMult);
    expect(speedOf(eff, 0)).toBe(speedOf(plain, 0) + KIT_RULES.effigySpeed);
    expect(tome.maxHp).toBe(Math.round(plain.maxHp * KIT_RULES.tomeMult));
    expect(damageMult(tome) / damageMult(plain)).toBeCloseTo(KIT_RULES.tomeMult);
    tome.gold = 40;
    tome.downedAt = 0;
    bleedOut(world, tome);
    expect(tome.legacy).toBe(40);
    expect(world.piles[world.dungeon.entrance]?.corpseGold?.t).toBeUndefined();
  });

  it('Gem: can’t bring, pick up or use consumables', () => {
    expect(kitError({ gear: {}, consumables: ['bandage'], rites: ['gem'] }, ['bandage'], full)).toMatch(/Gem Rite forbids/);
    const world = quiet();
    const h = addHero(world, { id: 'g', name: 'G', cls: 'warden', loadout: loadout({ consumables: ['bandage'], rites: ['gem'] }) });
    expect(h.items).toEqual([]);
    expect(canTake(h, 'torch')).toBe(false);
    expect(canTake(h, 'mace')).toBe(true);
  });

  it('CR has no cap: above 4, every monster gets +10% HP and damage per CR', () => {
    const at = (cr: number) => spawnGroup(createWorld(5, { monsters: false, loot: false, escalates: false, events: false, cr }), 0, ['ghoul'], 0)[0];
    expect(at(4).maxHp).toBe(ENEMIES.ghoul.maxHp);
    expect(at(6).dmgMult).toBeCloseTo(1 + 2 * CR_RULES.hpDmgPerCrAbove);
    expect(at(6).maxHp).toBe(Math.round(ENEMIES.ghoul.maxHp * (1 + 2 * CR_RULES.hpDmgPerCrAbove)));
  });

  it('a Relic Rite starts the whole party’s run at Escalation 5, with the clock that far along', () => {
    const game = new Game(11, [
      { id: 'a', name: 'A', cls: 'warden', isBot: false, loadout: loadout({ rites: ['relic'] }) },
      { id: 'b', name: 'B', cls: 'witch', isBot: true },
    ], { monsters: false });
    expect(game.world.time).toBe(EXIT_OPENS_AT);
    game.tick(0.1);
    expect(game.world.escalation).toBe(5);
    expect(game.world.chronicle.some((c) => c.text.startsWith('Escalation 5'))).toBe(true);
    // Secret rooms due by then are open.
    expect(game.world.dungeon.secrets.every((s) => s.open)).toBe(true);
  });

  it('the Game rolls the combined CR', () => {
    const crs = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const g = new Game(seed, [{ id: 'a', name: 'A', cls: 'warden', isBot: false, loadout: { ...loadout({ gear: { weapon: 'runeblade', armor: 'cuirass' } }), talent: 'ironOath' } }], { monsters: false });
      crs.add(g.world.cr);
    }
    expect(crs).toEqual(new Set([1, 2])); // 1.6
  });
});

describe('the lobby and the Stash', () => {
  it('takes the kit in at the start and brings everything carried out home', () => {
    const stash = new Stash(null);
    stash.storeLoot('Ann', ['mace', 'bandage', 'relic', 'relic', 'relic', 'relic', 'relic']);
    expect(stash.setKit('Ann', { gear: { weapon: 'mace' }, consumables: ['bandage'], rites: ['relic'] })).toBeNull();
    const mgr = new LobbyManager(stash);
    const sent: ServerMsg[] = [];
    const ws: Socket = { OPEN: 1, readyState: 1, send: (d) => sent.push(JSON.parse(d)), close: () => {} };
    const say = (msg: Parameters<LobbyManager['handle']>[3]) => mgr.handle(ws, 'tokenAAAA', 'Ann', msg);
    say({ t: 'create' });
    say({ t: 'pickClass', cls: 'warden' });
    const lobbyView = [...sent].reverse().find((m) => m.t === 'lobby');
    expect(lobbyView?.t === 'lobby' && lobbyView.lobby?.relic).toBe(true);
    expect(lobbyView?.t === 'lobby' && lobbyView.lobby?.cr).toBe(0.2);
    say({ t: 'ready', ready: true });
    say({ t: 'start' });
    expect(stash.village('Ann').items).toEqual([]);
    const lobby = (mgr as unknown as { lobbies: Map<string, { game: Game }> }).lobbies.values().next().value!;
    const w = lobby.game.world;
    expect(w.startTime).toBe(EXIT_OPENS_AT);
    const you = Object.values(w.heroes).find((h) => !h.isBot)!;
    expect(you.weapon).toBe('mace');
    you.items.push('gem', 'tome');
    for (const h of Object.values(w.heroes)) {
      h.extracted = true;
      h.extractedAt = w.time;
    }
    step(w, 0.1);
    mgr.tick();
    const v = stash.village('Ann');
    expect(v.items.sort()).toEqual(['bandage', 'mace']);
    expect(v.resources).toEqual({ effigy: 0, gem: 1, tome: 1, relic: 0 });
    expect(v.report.some((l) => l.startsWith('Into the Village Stash'))).toBe(true);
  });
});
