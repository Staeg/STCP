import { describe, expect, it } from 'vitest';
import { CARD_ART, CARD_IDS, CARD_RULES as R, CARDS, CLASS_CARDS, MIN_CARD_TIME, TYPE_CARDS } from '../content/cards';
import { MARK_ROWS, MOTIF_ROWS } from '../../../client/src/render/card-art-data';
import { SPRITES } from '../../../client/src/render/sprite-data';
import { ENEMIES } from '../content/enemies';

import { cardSource, gearCard, ISSUED_KIT, ISSUED_WEIGHT, issuedDesc, ITEMS } from '../content/items';
import { combatOrder, monstersIn } from './combat';
import { cardTime, corpses, uselessReason } from './cards';
import { deckList, liveCards } from './deck';
import { Game } from './game';
import { speedParts } from './speed';
import { arena, holdMonsters, play, run, setHand, untilTurn, walkIn } from './testkit';
import { buildView } from './views';



/** A fight with tough monsters that hold still, and the heroes in it. */
function fight(classes: Parameters<typeof arena>[0], enemies: Parameters<typeof arena>[1] = ['ghoul']) {
  const a = arena(classes, enemies);
  for (const m of a.monsters) m.hp = m.maxHp = 999;
  walkIn(a.world, a.ids, a.room);
  const enc = a.world.encounters[a.room];
  holdMonsters(a.world, enc);
  const heroes = a.ids.map((id) => a.world.heroes[id]);
  return { ...a, enc, heroes, h: heroes[0] };
}

describe('the deck', () => {
  it('is the six class cards plus one per Gear slot, with Fumble for an empty one', () => {
    const { h } = fight(['warden']);
    expect(deckList(h)).toEqual([...CLASS_CARDS.warden, 'fumble', 'fumble', 'fumble', 'fumble']);
    h.weapon = 'cudgel';
    h.armor = 'bulwark';
    h.amulet = 'fenrir';
    h.ring = 'thorns';
    expect(deckList(h).slice(6)).toEqual(['thump1', 'bulwark', 'howl', 'evillook2']);
  });

  it('Commons and Uncommons share their kind’s card; Rares and Legendaries bring their own', () => {
    expect(gearCard('dirk')).toBe(TYPE_CARDS.dagger[0]);
    expect(gearCard('stiletto')).toBe(TYPE_CARDS.dagger[1]);
    expect(gearCard('crook')).toBe('soothe1');
    expect(gearCard('wardstaff')).toBe('soothe2');
    expect(gearCard('locket')).toBe('mutter2');
    expect(gearCard('misericorde')).toBe('mercy');
    expect(gearCard('quickblood')).toBe('bloodrush');
    expect(gearCard('silva')).toBe('waystep');
    // Every piece of Gear's text says which card it brings.
    for (const def of Object.values(ITEMS)) if (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'amulet' || def.kind === 'ring') expect(def.desc).toMatch(/Card: /);
  });

  it('each class has five cards that reshuffle and one Burn', () => {
    for (const cards of Object.values(CLASS_CARDS)) {
      expect(cards).toHaveLength(6);
      expect(cards.filter((c) => CARDS[c].burn)).toEqual([cards[5]]);
    }
  });

  it('a real run issues every empty slot something plain, which weighs a little and never goes home', async () => {
    const game = new Game(4, [{ id: 'a', name: 'A', cls: 'cutthroat', isBot: false }, { id: 'b', name: 'B', cls: 'warden', isBot: true }], { monsters: false });
    const a = game.world.heroes.a;
    expect([a.weapon, a.armor, a.amulet, a.ring]).toEqual(Object.values(ISSUED_KIT.cutthroat));
    expect(a.issued).toEqual(ISSUED_KIT.cutthroat);
    expect(game.world.heroes.b.weapon).toBe(ISSUED_KIT.warden.weapon);
    // Each issued piece weighs a little.
    expect(speedParts(a, game.world.time).find((p) => p.label === ITEMS.copperband.name)?.amount).toBe(ISSUED_WEIGHT);
    a.ring = null;
    expect(speedParts(a, game.world.time).find((p) => p.label === ITEMS.copperband.name)).toBeUndefined();
  });

  it("an Issued piece's text gives the Speed it really costs", () => {
    expect(ITEMS.ringmail.speed).toBeGreaterThan(0);
    expect(issuedDesc('ringmail')).toContain(`+${ISSUED_WEIGHT}s Speed.`);
    expect(issuedDesc('ringmail')).not.toContain(`+${ITEMS.ringmail.speed}s Speed.`);
    expect(issuedDesc('ringmail')).toContain('Card: ');
    expect(issuedDesc('copperband')).toContain(`+${ISSUED_WEIGHT}s Speed. Card: `);
  });

  it('a kit can leave slots bare: nothing issued there, and a Fumble in the deck', () => {
    const game = new Game(4, [{ id: 'a', name: 'A', cls: 'zealot', isBot: false, loadout: {
      charId: 'c', charName: 'A', owner: 'A', talents: [], injuries: [],
      kit: { gear: {}, consumables: [], rites: [], bare: ['ring', 'amulet'] },
    } }], { monsters: false });
    const a = game.world.heroes.a;
    expect(a.ring).toBeNull();
    expect(a.amulet).toBeNull();
    expect(deckList(a).filter((c) => c === 'fumble')).toHaveLength(2);
  });
});

describe('every card', () => {
  it('can always be played and always does something, whatever the board', () => {
    for (const card of CARD_IDS) {
      const { world, h, enc } = fight(['warden', 'lampbearer']);
      h.light = 0; // no light to spend
      const seq = enc.seq;
      const before = world.time;
      play(world, h, card, undefined, CARDS[card].target === 'room' ? world.dungeon.exit : undefined);
      const mine = enc.events.filter((e) => e.seq! > seq && e.actor === h.id || e.seq! > seq && e.target === h.id);
      expect(mine.length, card).toBeGreaterThan(0);
      if (h.encounter === enc.room) expect(enc.next[h.id] - world.time, card).toBeGreaterThanOrEqual(MIN_CARD_TIME - 0.15 - (world.time - before));
    }
  });

  it('sets the wait until the next action, from the card (not Speed)', () => {
    const { world, h, enc } = fight(['bellwright']);
    play(world, h, 'echo'); // 2s, though a Bellwright's Speed is 7
    expect(enc.next[h.id] - world.time).toBeCloseTo(CARDS.echo.time, 0);
    expect(buildView(world, h.id).encounter!.heroes[0].speed).toBe(CARDS.echo.time);
  });

  it('shows the hand with each card’s time and who it can be aimed at, and flags useless plays', () => {
    const { world, h, monsters } = fight(['lampbearer']);
    setHand(h, ['mend', 'flare', 'kindle']);
    const view = buildView(world, h.id).encounter!;
    expect(view.yourHand.map((c) => c.card)).toEqual(['mend', 'flare', 'kindle']);
    expect(view.yourHand[0]).toMatchObject({ time: CARDS.mend.time, targets: [h.id], weak: 'Nobody is hurt.' });
    expect(view.yourHand[2].targets).toEqual(monsters.map((m) => m.id));
    expect(view.deckCount + view.discardCount + view.yourHand.length).toBe(10);
    // Your draw pile stays face down.
    expect(buildView(world, h.id).you.deck).toBeNull();
  });
});

describe('Warden', () => {
  it('Shield Bash hits the nearest and Delays it; Cover shields and steps to the front', () => {
    const { world, heroes, h, enc, monsters } = fight(['warden', 'cutthroat']);
    const due = enc.next[monsters[0].id];
    play(world, h, 'bash');
    expect(monsters[0].hp).toBe(999 - R.bash);
    expect(enc.next[monsters[0].id]).toBeCloseTo(due + R.bashDelay);
    play(world, h, 'cover', heroes[1].id);
    expect(heroes[1].st.shield).toBe(R.coverShield);
    expect(combatOrder(world, enc).heroes.at(-1)).toBe(h);
  });

  it('Shield Slam hits for Block + Shield and Delays a second per 3 dealt; Hold the Gate halves and throws attackers back', () => {
    const { world, h, enc, monsters } = fight(['warden']);
    h.armor = 'bulwark'; // Block 6 (+2 at the front)
    h.st.shield = 6;
    const due = enc.next[monsters[0].id];
    play(world, h, 'slam');
    expect(monsters[0].hp).toBe(999 - 12);
    expect(enc.next[monsters[0].id]).toBeCloseTo(due + 4);
    play(world, h, 'gate');
    expect(h.burned).toEqual(['gate']);
    expect(h.st.shield).toBe(6 + R.gateShield);
    const ghoul = monsters[0];
    enc.next[ghoul.id] = world.time;
    untilTurn(world, enc.room, ghoul.id);
    expect(enc.events.some((e) => e.text.includes('thrown back from the gate'))).toBe(true);
    expect(enc.next[ghoul.id] - world.time).toBeCloseTo(ENEMIES.ghoul.speed + R.gateDelay, 0);
  });
});

describe('Cutthroat', () => {
  it('Backstab crits the unready; Cheap Shot stuns; Envenom poisons for turns', () => {
    const { world, h, monsters } = fight(['cutthroat'], ['ghoul', 'ghoul']);
    const [a, b] = monsters;
    play(world, h, 'backstab', a.id);
    expect(a.hp).toBe(999 - 2 * R.backstab);
    play(world, h, 'cheap', b.id);
    expect(b.st.stun).toBe(true);
    play(world, h, 'envenom', b.id);
    expect(b.st.poison).toEqual([{ dmg: R.envenomPoison, rounds: R.envenomTurns }]);
  });

  it('Hand Signal hurries an ally (further out in the open) and their next hit Exposes; Blade Dance makes every card 1s', () => {
    const { world, heroes, h, enc, monsters } = fight(['cutthroat', 'warden']);
    const w = heroes[1];
    enc.next[w.id] = world.time + 600;
    play(world, h, 'signal', w.id);
    expect(enc.next[w.id]).toBeCloseTo(world.time - 0.1 + 600 - R.signalLoudHurry, 0);
    expect(w.st.expose).toBe(true);
    play(world, w, 'bash');
    expect(monsters[0].st.exposed).toBe(R.exposed);
    play(world, h, 'dance');
    expect(cardTime(world, enc, h, 'cheap')).toBe(1);
  });

  it('Smoke Bomb: half the blows miss and fleeing always works, for 6 seconds', () => {
    const { world, heroes, h } = fight(['cutthroat', 'warden']);
    play(world, h, 'smoke');
    for (const x of heroes) {
      expect(x.st.dodge).toBeCloseTo(world.time + R.smokeSecs - CARDS.smoke.time + CARDS.smoke.time, 0);
      expect(x.st.fleeSure).toBe(x.st.dodge);
    }
  });
});

describe('Lampbearer', () => {
  it('Flare lights the room; Mend heals and cures Bleed; Kindle spends light and Blinds at 20', () => {
    const { world, heroes, h, monsters } = fight(['lampbearer', 'warden']);
    h.light = 30;
    play(world, h, 'flare');
    expect(h.light).toBeGreaterThan(30 + R.flareLight - 2);
    const w = heroes[1];
    w.hp = 10;
    w.st.bleed = [{ dmg: 2, until: world.time + 10, next: world.time + 2 }];
    play(world, h, 'mend', w.id);
    expect(w.hp).toBe(10 + R.mend);
    expect(w.st.bleed).toBeUndefined();
    h.light = 25;
    play(world, h, 'kindle', monsters[0].id);
    expect(Math.round(h.light)).toBe(5);
    expect(monsters[0].st.blind).toBe(true);
  });

  it('Sanctuary: Regen every 2s; Dawn burns and brings back light and HP', () => {
    const { world, heroes, h } = fight(['lampbearer', 'warden']);
    const w = heroes[1];
    w.hp = 10;
    const enc = play(world, h, 'sanctuary');
    enc.next[h.id] = world.time + 999;
    run(world, R.sanctuarySecs + 0.5);
    expect(w.hp).toBe(10 + R.sanctuaryRegen * (R.sanctuarySecs / R.pulse));
    w.light = 0;
    play(world, h, 'dawn');
    expect(w.light).toBeGreaterThan(95);
    expect(h.burned).toEqual(['dawn']);
  });
});

describe('Sorceress', () => {
  it('Hex stacks; Wither weakens all; Blood Pact hurts both sides', () => {
    const { world, heroes, h, monsters } = fight(['sorceress', 'warden']);
    const m = monsters[0];
    play(world, h, 'hex', m.id);
    play(world, h, 'hex', m.id);
    expect(999 - m.hp).toBe(R.hex + 2 * R.hex);
    play(world, h, 'wither');
    expect(m.st.weak?.stacks).toBe(1);
    const hp = m.hp;
    play(world, h, 'pact');
    expect(hp - m.hp).toBe(R.pact);
    expect(heroes[1].hp).toBe(heroes[1].maxHp - R.pactCost);
  });

  it('Bound Familiar: up to two Imps, then it heals them; Mad Bargain makes the next card 1s; Curse of Ages adds 2 Hexed and Delays per stack', () => {
    const { world, h, enc, monsters } = fight(['sorceress']);
    play(world, h, 'familiar');
    play(world, h, 'familiar');
    play(world, h, 'familiar');
    expect(enc.legion!.filter((r) => r.type === 'imp')).toHaveLength(2);
    play(world, h, 'bargain');
    expect(cardTime(world, enc, h, 'pact')).toBe(1);
    const due = enc.next[monsters[0].id];
    play(world, h, 'ages');
    expect(monsters[0].st.hexed).toHaveLength(R.agesStacks);
    expect(enc.next[monsters[0].id]).toBeCloseTo(due + R.agesStacks * R.agesDelayPer);
  });
});

describe('Undertaker', () => {
  it('Last Rites kills below 40%, else hits for 8; Raise and Corpse Explosion use up Corpses', () => {
    const { world, h, enc, monsters } = fight(['undertaker'], ['ghoul', 'ghoul', 'ghoul']);
    const [a, b, c] = monsters;
    play(world, h, 'rites', a.id);
    expect(a.hp).toBe(999 - R.rites);
    a.hp = 300;
    play(world, h, 'rites', a.id);
    expect(world.monsters[a.id]).toBeUndefined();
    expect(h.spadeBonus).toBe(1);
    expect(corpses(enc)).toBe(1);
    play(world, h, 'raise');
    expect(corpses(enc)).toBe(0);
    expect(enc.legion!.some((r) => r.type === 'ghoul' && r.turns === R.raiseTurns)).toBe(true);
    play(world, h, 'explode');
    expect(b.hp).toBe(999 - R.explodeBare);
    expect(c.hp).toBe(999 - R.explodeBare);
  });

  it('Grave Ward is quick and stronger with a Corpse; Open the Graves raises every Corpse for the fight', () => {
    const { world, h, enc } = fight(['undertaker']);
    expect(CARDS.graveward.time).toBe(1);
    play(world, h, 'graveward', h.id);
    expect(h.st.shield).toBe(R.graveWard);
    enc.slain = [{ type: 'ghoul', maxHp: 10, dmgMult: 1 }, { type: 'crawler', maxHp: 8, dmgMult: 1 }];
    play(world, h, 'graves');
    expect(enc.legion!.filter((r) => r.summon).map((r) => r.type).sort()).toEqual(['crawler', 'ghoul']);
    // Summons are gone when the fight ends.
    for (const m of monstersIn(world, enc.room)) delete world.monsters[m.id];
    run(world, 0.2);
    expect(h.legion).toEqual([]);
  });
});

describe('Bellwright', () => {
  it('Clang Delays and quickens the Bellwright’s cards; Knell weakens with allies but never below 3', () => {
    const { world, h, enc, monsters } = fight(['bellwright']);
    const due = enc.next[monsters[0].id];
    play(world, h, 'clang');
    expect(enc.next[monsters[0].id]).toBeCloseTo(due + R.clangDelay);
    expect(h.st.clang?.stacks).toBe(1);
    expect(cardTime(world, enc, h, 'knell')).toBe(CARDS.knell.time - R.clangHaste);
    const four = fight(['bellwright', 'warden', 'sorceress', 'cutthroat']);
    play(four.world, four.h, 'knell');
    expect(four.monsters[0].hp).toBe(999 - R.knellMin);
  });

  it('Peal hurries the others; Ring Out Delays every enemy; Echo repeats the last card at half power', () => {
    const { world, heroes, h, enc, monsters } = fight(['bellwright', 'warden'], ['ghoul', 'ghoul']);
    enc.next[heroes[1].id] = world.time + 600;
    play(world, h, 'peal');
    expect(enc.next[heroes[1].id]).toBeCloseTo(world.time - 0.1 + 600 - R.pealHurry, 0);
    const dues = monsters.map((m) => enc.next[m.id]);
    play(world, h, 'ringout');
    monsters.forEach((m, i) => expect(enc.next[m.id]).toBeCloseTo(dues[i] + R.ringOutDelay));
    play(world, h, 'clang');
    const total = () => monsters.reduce((s, m) => s + m.hp, 0);
    const hp = total();
    play(world, h, 'echo');
    expect(hp - total()).toBe(Math.round(R.clang * R.echoMult));
  });
});

describe('Zealot', () => {
  it('Absolution turns the dark below 50 into damage and gives the light back; Take Their Sins gives light away; Penance turns darkness into Shield', () => {
    const { world, heroes, h, monsters } = fight(['zealot', 'warden']);
    h.light = 30;
    const hp = monsters[0].hp;
    play(world, h, 'absolution');
    expect(h.light).toBeCloseTo(50, 0);
    expect(hp - monsters[0].hp).toBeGreaterThanOrEqual(R.absolutionBase + 20);
    heroes[1].light = 20;
    const before = h.light;
    play(world, h, 'sins', heroes[1].id);
    expect(heroes[1].light).toBeCloseTo(20 + R.sinsLight, 0);
    expect(h.light).toBeCloseTo(before - R.sinsLight, 0);
    play(world, h, 'penance');
    expect(h.light).toBeCloseTo(before - R.sinsLight - R.penanceLight, 0);
    expect(h.st.shield).toBe(Math.floor((100 - h.light) / R.penanceDiv));
  });

  it('Fervour: the darker the Zealot, the harder they hit', () => {
    const { world, h, monsters } = fight(['zealot']);
    h.light = 100;
    let hp = monsters[0].hp;
    play(world, h, 'scourge', monsters[0].id);
    expect(hp - monsters[0].hp).toBe(R.scourge);
    h.light = 0;
    hp = monsters[0].hp;
    play(world, h, 'scourge', monsters[0].id);
    expect(hp - monsters[0].hp).toBe(R.scourge * 2);
  });

  it('Martyrdom snuffs light for a quick next card; Rapture pours light into the others and hurls the dark', () => {
    const { world, heroes, h, enc, monsters } = fight(['zealot', 'warden']);
    const before = h.light;
    play(world, h, 'martyrdom');
    expect(h.light).toBeCloseTo(before - R.martyrdomLight, 0);
    expect(cardTime(world, enc, h, 'absolution')).toBe(1);
    heroes[1].light = 40;
    h.light = 60;
    const hp = monsters[0].hp;
    play(world, h, 'rapture', monsters[0].id);
    expect(heroes[1].light).toBeCloseTo(40 + R.raptureLight, 0);
    expect(h.light).toBeCloseTo(60 - R.raptureLight, 0);
    // 15 + half of the 60 it lacks, with +60% Fervour.
    expect(hp - monsters[0].hp).toBe(Math.round((R.rapture + 30) * 1.6));
  });
});

describe('light cards', () => {
  it('Trim the Wick lights you (Common) or an ally (Uncommon); Elder’s Oil fills your lamp and burns', () => {
    const { world, heroes, h } = fight(['warden', 'warden']);
    const w = heroes[1];
    h.light = 40;
    play(world, h, 'wick1');
    expect(h.light).toBeCloseTo(40 + R.wick1, 0);
    w.light = 10;
    play(world, h, 'wick2', w.id);
    expect(w.light).toBeCloseTo(10 + R.wick2, 0);
    h.light = 5;
    play(world, h, 'oil');
    expect(h.light).toBeGreaterThan(99);
    expect(h.burned).toEqual(['oil']);
    expect(uselessReason(world, world.encounters[h.encounter!], h, 'oil')).toMatch(/full/);
  });
});

describe('Alchemist', () => {
  it('Acid lowers Block; Fumes poison all; Catalyst ticks every Poison at once', () => {
    const { world, h, monsters } = fight(['alchemist'], ['giant', 'ghoul']);
    const [giant, ghoul] = monsters;
    play(world, h, 'acid', giant.id);
    expect(giant.st.acid?.stacks).toBe(1);
    play(world, h, 'fumes');
    expect(ghoul.st.poison).toHaveLength(1);
    const hp = ghoul.hp;
    play(world, h, 'catalyst');
    expect(hp - ghoul.hp).toBe(R.fumesPoison + R.catalystPoison);
  });

  it('Healing Mist heals everyone; Opus Magnum fills the pack and makes items quick', () => {
    const { world, heroes, h, enc } = fight(['alchemist', 'warden']);
    for (const x of heroes) x.hp = 10;
    play(world, h, 'mist');
    for (const x of heroes) expect(x.hp).toBe(10 + R.mist);
    play(world, h, 'opus');
    expect(h.items.length).toBe(R.opusItems);
    expect(h.st.quickItems).toBe(true);
    expect(enc.next[h.id]).toBeDefined();
  });
});

describe('Gear cards and passives', () => {
  it('a Bonebreaker adds 2s to every Delay; Studded Leather quickens your first card; Brigandine starts you shielded', () => {
    const { world, h, enc, monsters } = fight(['warden']);
    h.weapon = 'bonebreaker';
    const due = enc.next[monsters[0].id];
    play(world, h, 'bash');
    expect(enc.next[monsters[0].id]).toBeCloseTo(due + R.bashDelay + 2);

    const s = arena(['warden'], ['ghoul']);
    const w = s.world.heroes.h0;
    w.armor = 'studded';
    walkIn(s.world, s.ids, s.room);
    const enc2 = s.world.encounters[s.room];
    expect(cardTime(s.world, enc2, w, 'bash')).toBe(CARDS.bash.time - 1);

    const b = arena(['warden'], ['ghoul']);
    b.world.heroes.h0.armor = 'brigandine';
    walkIn(b.world, b.ids, b.room);
    expect(b.world.heroes.h0.st.shield).toBe(3);
  });

  it('Mercy Stroke finishes the nearly dead; Whisper Cut bleeds every 2s; Earthblow Slows', () => {
    const { world, h, enc, monsters } = fight(['cutthroat'], ['ghoul', 'ghoul']);
    const [a, b] = monsters;
    a.hp = 200;
    play(world, h, 'mercy', a.id);
    expect(world.monsters[a.id]).toBeUndefined();
    play(world, h, 'whispercut', b.id);
    const hp = b.hp;
    run(world, R.pulse + 0.1);
    expect(hp - b.hp).toBeGreaterThanOrEqual(R.whispercutBleed);
    play(world, h, 'earthblow');
    expect(b.st.slow?.amount).toBe(R.earthblowSlow);
    const before = enc.next[b.id];
    enc.next[b.id] = world.time;
    untilTurn(world, enc.room, b.id);
    expect(enc.next[b.id] - world.time).toBeCloseTo(ENEMIES.ghoul.speed + R.earthblowSlow, 0);
    void before;
  });

  it('Fade, Veil and Blink make the next attack miss; a Blinded monster misses', () => {
    const { world, h, enc, monsters } = fight(['warden']);
    play(world, h, 'fade');
    const ghoul = monsters[0];
    enc.next[ghoul.id] = world.time;
    untilTurn(world, enc.room, ghoul.id);
    expect(enc.events.some((e) => e.actor === ghoul.id && e.kind === 'miss')).toBe(true);
    expect(h.st.evade).toBeUndefined();
    ghoul.st.blind = true;
    enc.next[ghoul.id] = world.time;
    untilTurn(world, enc.room, ghoul.id);
    expect(enc.events.filter((e) => e.actor === ghoul.id && e.kind === 'miss')).toHaveLength(2);
    expect(ghoul.st.blind).toBeUndefined();
  });

  it('Lucky Break deals a whole new hand; Turn the Glass gives back the last card played', () => {
    const { world, h } = fight(['warden']);
    setHand(h, ['luckybreak', 'bash', 'cover']);
    play(world, h, 'luckybreak');
    expect(h.deck!.discard).toEqual(expect.arrayContaining(['bash', 'cover', 'luckybreak']));
    expect(h.deck!.hand).toHaveLength(3);
    setHand(h, ['rally', 'glass', 'thornwall']);
    play(world, h, 'rally');
    play(world, h, 'glass');
    expect(h.deck!.hand).toContain('rally');
  });

  it('Promise kills the strongest that isn’t a Boss; Unmake empties the fight; Waystep leaves for any known room', () => {
    const { world, h, room, monsters } = fight(['warden'], ['ghoul', 'giant']);
    play(world, h, 'promise');
    expect(world.monsters[monsters[1].id]).toBeUndefined();
    expect(h.burned).toEqual(['promise']);
    play(world, h, 'unmake');
    expect(monstersIn(world, room)).toHaveLength(0);
    expect(world.bounty[room]).toBeUndefined();

    const w = fight(['warden']);
    play(w.world, w.h, 'waystep', undefined, w.world.dungeon.exit);
    expect(w.h.encounter).toBeNull();
    expect(w.h.pos).toEqual({ kind: 'room', room: w.world.dungeon.exit });
  });

  it('flags useless plays for the fight screen and bots', () => {
    const { world, h, enc } = fight(['lampbearer']);
    expect(uselessReason(world, enc, h, 'mend')).toMatch(/hurt/);
    h.hp -= 5;
    expect(uselessReason(world, enc, h, 'mend')).toBeNull();
    expect(uselessReason(world, enc, h, 'fumble')).toBeTruthy();
    expect(uselessReason(world, enc, h, 'flare')).toBeNull();
  });
});

describe('Burned cards', () => {
  it('stay burned in the next fight; a whole run deals the rest', () => {
    const { world, h } = fight(['cutthroat']);
    play(world, h, 'dance');
    expect(liveCards(h)).not.toContain('dance');
    expect(liveCards(h)).toHaveLength(9);
  });
});

describe('summoned and risen allies', () => {
  it('"every ally" cards reach them too: Shield, Dodge, Regen, healing, Hurry, Now, and the Pact price', () => {
    const { world, h, enc } = fight(['warden', 'bellwright']);
    play(world, h, 'mutter1');
    const rat = enc.legion!.find((r) => r.type === 'rat')!;
    expect(rat).toBeDefined();
    const st = () => rat.st ?? {};
    play(world, h, 'rally');
    expect(st().shield).toBe(R.rallyShield);
    play(world, h, 'runeward');
    expect(st().shield).toBe(R.rallyShield + R.runeWard);
    play(world, h, 'smoke');
    expect(st().dodge).toBeGreaterThan(world.time);
    play(world, h, 'sanctuary');
    expect(st().regen?.amount).toBe(R.sanctuaryRegen);
    rat.hp = 1;
    play(world, h, 'mist');
    expect(rat.hp).toBe(Math.min(rat.maxHp, 1 + R.mist));
    rat.hp = 1;
    play(world, h, 'dawn');
    expect(rat.hp).toBe(Math.min(rat.maxHp, 1 + R.dawnHeal));
    rat.hp = rat.maxHp;
    play(world, h, 'pact');
    expect(rat.hp).toBeLessThan(rat.maxHp);
    const before = enc.next[rat.id];
    play(world, h, 'peal');
    expect(enc.next[rat.id]).toBeCloseTo(before - R.pealHurry, 1);
    // Its action came at once (it has already acted again: its next is a Speed away, not 999s).
    play(world, h, 'reverberate');
    expect(enc.next[rat.id]).toBeLessThan(world.time + 30);
  });

  it('their Shield soaks blows and Regen ticks on them', () => {
    const { world, h, enc, monsters } = fight(['warden']);
    play(world, h, 'mutter1');
    const rat = enc.legion!.find((r) => r.type === 'rat')!;
    rat.st = { shield: 99 };
    enc.next[h.id] = world.time + 999;
    enc.next[monsters[0].id] = world.time;
    untilTurn(world, enc.room, monsters[0].id);
    expect(enc.events.some((e) => e.actor === monsters[0].id && e.target === rat.id && e.amount === 0)).toBe(true);
    expect(rat.hp).toBe(rat.maxHp);
    rat.hp = 1;
    rat.st = { regen: { amount: 2, until: world.time + 10, next: world.time + R.pulse } };
    run(world, R.pulse + 0.2);
    expect(rat.hp).toBe(3);
  });
});

describe('card art', () => {
  it('every card has its own picture (only a Common and Uncommon of one kind share), drawn from parts that exist', () => {
    const seen = new Map<string, string>();
    for (const id of CARD_IDS) {
      const { motif, mark } = CARD_ART[id];
      expect(MOTIF_ROWS[motif] ?? SPRITES[motif], `${id}: ${motif}`).toBeDefined();
      if (mark) expect(MARK_ROWS[mark], `${id}: ${mark}`).toBeDefined();
      const key = `${motif}/${mark ?? ''}`;
      const other = seen.get(key);
      if (other) expect(Object.values(TYPE_CARDS).some((pair) => pair.includes(id) && pair.includes(other as never)), `${id} looks like ${other}`).toBe(true);
      seen.set(key, id);
    }
  });

  it('frames tell class cards from Gear cards, and Gear cards by tier', () => {
    expect(cardSource('bash')).toBe('class');
    expect(cardSource('stab1')).toBe(1);
    expect(cardSource('stab2')).toBe(2);
    expect(cardSource('mercy')).toBe(3);
    expect(cardSource('howl')).toBe(4);
    expect(cardSource('fumble')).toBe(0);
    // A class card that a Gear piece also names is still a class card; every card has some source.
    for (const id of CARD_IDS) expect(cardSource(id)).toBeDefined();
  });
});
