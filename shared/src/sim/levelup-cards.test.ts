import { describe, expect, it } from 'vitest';
import { CARD_RULES as R, CARDS, LEVELUP_CARDS } from '../content/cards';
import { CLASS_IDS } from '../content/classes';
import { LIGHT_MAX } from '../content/constants';
import { cardSource } from '../content/items';
import { addClang, damageMult, stepToEnd, submitChoice, type Monster } from './combat';
import { cardTime } from './cards';
import { arena, holdMonsters, play, run, setHand, untilTurn, walkIn } from './testkit';
import { applyItem } from './loot';
import type { World } from './world';

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

/** Let this monster take its turn now (everyone else waits). */
function act(world: World, room: number, m: Monster) {
  const enc = world.encounters[room];
  for (const id of Object.keys(enc.next)) enc.next[id] = world.time + 999;
  enc.next[m.id] = world.time;
  untilTurn(world, room, m.id);
}

describe('level-up cards', () => {
  it('five a class, framed as class cards, each with its text', () => {
    for (const cls of CLASS_IDS) {
      expect(LEVELUP_CARDS[cls]).toHaveLength(5);
      for (const c of LEVELUP_CARDS[cls]) {
        expect(cardSource(c)).toBe('class');
        expect(CARDS[c].desc.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('Warden', () => {
  it('Aegis Toss hits for your Shield and ricochets back down the line at half each bounce; it costs half your Shield', () => {
    const { world, h, monsters } = fight(['warden'], ['ghoul', 'ghoul', 'ghoul']);
    h.st.shield = 20;
    play(world, h, 'aegis', monsters[1].id);
    expect(monsters[0].hp).toBe(999);
    expect(monsters[1].hp).toBe(999 - 20);
    expect(monsters[2].hp).toBe(999 - 10);
    expect(h.st.shield).toBe(10);
    play(world, h, 'aegis', monsters[0].id);
    expect(monsters.map((m) => 999 - m.hp)).toEqual([10, 25, 12]);
  });

  it('Linked Shields: two characters share one pool; Mirror Guard turns a debuff back', () => {
    const { world, heroes, h, room, monsters } = fight(['warden', 'cutthroat'], ['crawler']);
    const [, c] = heroes;
    play(world, h, 'linked', c.id);
    expect(h.st.link).toBe(c.id);
    expect(h.st.shield).toBe(R.linkedShield);
    // The Cutthroat has no Shield of their own, so the Warden's takes the bite.
    stepToEnd(world, c, 'front');
    play(world, h, 'mirror');
    const before = c.hp;
    for (let i = 0; i < 6 && !monsters[0].st.poison; i++) act(world, room, monsters[0]);
    expect(monsters[0].st.poison).toBeDefined();
    expect(h.st.poison ?? c.st.poison).toBeUndefined();
    expect(c.hp).toBe(before);
  });

  it('War Banner shields every ally at the start of their turns; Phalanx spills half of any Shield to the rest', () => {
    const { world, heroes, h } = fight(['warden', 'lampbearer']);
    play(world, h, 'banner');
    const shield = h.st.shield ?? 0;
    play(world, h, 'phalanx');
    expect(h.st.shield).toBe(shield + R.bannerShield);
    const lamp = heroes[1].st.shield ?? 0;
    play(world, h, 'cover', h.id);
    // Cover +8 and the banner's +2 at the turn's start, half of each spilling to the Lampbearer.
    expect(heroes[1].st.shield).toBe(lamp + R.coverShield / 2 + R.bannerShield / 2);
    expect(h.burned).toContain('phalanx');
  });
});

describe('Cutthroat', () => {
  it("Marked for Death: the next two hits crit, whoever lands them; Flurry hits three times", () => {
    const { world, heroes, h, monsters } = fight(['cutthroat', 'warden']);
    const m = monsters[0];
    play(world, h, 'marked', m.id);
    play(world, heroes[1], 'bash');
    expect(m.hp).toBe(999 - R.bash * 2);
    m.hp = 999;
    m.st.acted = true;
    play(world, h, 'flurry', m.id);
    expect(m.hp).toBe(999 - R.flurry * 2 - R.flurry * 2 / 2 - R.flurry);
  });

  it('Coup de Grâce Chains on a kill; Misdirect turns a blow onto another enemy', () => {
    const { world, h, room, monsters } = fight(['cutthroat'], ['ghoul', 'ghoul', 'ghoul']);
    monsters[0].hp = 3;
    play(world, h, 'coup', monsters[0].id);
    expect(world.monsters[monsters[0].id]).toBeUndefined();
    // The Chain: their next action came at once.
    const log = world.encounters[room].log;
    const i = log.findIndex((l) => l.includes('chains into the next move'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(log.slice(i + 1).some((l) => l.startsWith(`${h.name} hesitates`))).toBe(true);
    const hp = h.hp;
    play(world, h, 'misdirect', monsters[1].id);
    act(world, room, monsters[1]);
    expect(h.hp).toBe(hp);
    expect(monsters[2].hp).toBeLessThan(999);
  });

  it('Thousand Cuts: after every card a random enemy takes 1, then 2, then 3…', () => {
    const { world, h, enc } = fight(['cutthroat']);
    play(world, h, 'cuts');
    play(world, h, 'envenom');
    play(world, h, 'envenom');
    const cuts = enc.log.filter((l) => l.startsWith('A thousand cuts')).slice(0, 3);
    expect(cuts).toEqual(['A thousand cuts: Ghoul takes 1.', 'A thousand cuts: Ghoul takes 2.', 'A thousand cuts: Ghoul takes 3.']);
  });
});

describe('Lampbearer', () => {
  it('Radiant Hymn overfills light past 100 and the Radiant hit harder; it fades with the fight', () => {
    const { world, heroes, h } = fight(['lampbearer', 'warden']);
    const base = damageMult(heroes[1], world);
    heroes[1].light = LIGHT_MAX;
    play(world, h, 'hymn');
    expect(heroes[1].light).toBeCloseTo(LIGHT_MAX + R.hymnLight, -1);
    expect(heroes[1].light).toBeGreaterThan(LIGHT_MAX);
    expect(damageMult(heroes[1], world)).toBeCloseTo(base * (1 + R.radiantMult));
  });

  it('Lightwell: every card played here gives light and heals; Halo: a blow on its wearer heals every ally', () => {
    const { world, heroes, h, room, monsters } = fight(['lampbearer', 'warden']);
    const w = heroes[1];
    play(world, h, 'lightwell');
    w.hp -= 10;
    w.light = 50;
    play(world, w, 'rally');
    expect(w.light).toBeCloseTo(50 + R.wellLight, 0);
    expect(w.hp).toBe(w.maxHp - 10 + R.wellHeal);
    play(world, h, 'halo', w.id);
    h.hp -= 10;
    stepToEnd(world, w, 'front');
    const lamp = h.hp;
    act(world, room, monsters[0]);
    expect(h.hp).toBe(lamp + R.haloHeal);
  });

  it("Lightbringer's March hurries every ally by your light; the Eternal Lamp floors light and adds to every hit and heal", () => {
    const { world, heroes, h, enc, monsters } = fight(['lampbearer', 'warden']);
    const w = heroes[1];
    h.light = 90; // 4s, whatever the lamp loses meanwhile
    const t0 = world.time;
    play(world, h, 'march');
    // The play holds the Warden 999s off; the March brings that 4s nearer.
    expect(enc.next[w.id]).toBeCloseTo(t0 + 999 - 4, 0);
    h.light = 0;
    play(world, h, 'eternal');
    expect(h.light).toBe(R.eternalFloor);
    play(world, h, 'kindle', monsters[0].id);
    expect(h.light).toBe(R.eternalFloor);
    expect(monsters[0].hp).toBe(999 - R.kindleBase - R.eternalBonus);
    w.hp -= 20;
    play(world, h, 'mend', w.id);
    expect(w.hp).toBe(w.maxHp - 20 + R.mend + R.eternalBonus);
  });
});

describe('Sorceress', () => {
  it('Puppet Strings turns its next action on its own; Anima Surge spends all Anima on the next card', () => {
    const { world, h, room, monsters } = fight(['sorceress'], ['ghoul', 'ghoul']);
    const hp = h.hp;
    play(world, h, 'puppet', monsters[0].id);
    act(world, room, monsters[0]);
    expect(h.hp).toBe(hp);
    expect(monsters[1].hp).toBe(999 - 4);
    h.anima = 2;
    play(world, h, 'surge');
    expect(h.anima).toBe(0);
    play(world, h, 'hex', monsters[1].id);
    expect(monsters[1].hp).toBe(999 - 4 - R.hex * 2);
  });

  it('Witching Hour: every debuff Hexes too; Blood Moon costs HP (not with Anima) and heals half of what allies deal', () => {
    const { world, h, monsters } = fight(['sorceress']);
    play(world, h, 'witching');
    play(world, h, 'wither');
    expect(monsters[0].st.weak).toBeDefined();
    expect(monsters[0].st.hexed).toHaveLength(1);
    const hp = h.hp;
    play(world, h, 'bloodmoon');
    expect(h.hp).toBe(hp - R.bloodMoonHp);
    play(world, h, 'hex', monsters[0].id);
    expect(h.hp).toBe(hp - R.bloodMoonHp + Math.floor(R.hex * 2 * R.lifesteal));
    h.anima = 1;
    const now = h.hp;
    play(world, h, 'bloodmoon');
    expect(h.hp).toBe(now);
  });

  it('Wandering Curse: when it dies, its Hexed stacks leap to another', () => {
    const { world, h, monsters } = fight(['sorceress'], ['ghoul', 'ghoul']);
    play(world, h, 'wander', monsters[0].id);
    monsters[0].hp = 1;
    play(world, h, 'hex', monsters[0].id);
    expect(world.monsters[monsters[0].id]).toBeUndefined();
    expect(monsters[1].st.hexed?.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Undertaker', () => {
  it('Danse Macabre: every summon acts now; Plague Bearers: their attacks poison', () => {
    const { world, h, enc, monsters } = fight(['undertaker']);
    play(world, h, 'danse'); // none yet: a Rat claws up
    expect(enc.legion!.some((r) => r.type === 'rat')).toBe(true);
    play(world, h, 'plague');
    expect(monsters[0].st.poison).toBeUndefined();
    // Held back by the play, the Rat moves at once on the Danse, and its bite carries the plague.
    play(world, h, 'danse');
    expect(monsters[0].st.poison).toBeDefined();
  });

  it('Claim the Grave: the claimed rises at once, at half HP, and follows; Preserve: it never decays and survives one killing blow', () => {
    const { world, h, enc, monsters } = fight(['undertaker'], ['ghoul', 'ghoul']);
    play(world, h, 'claim', monsters[0].id);
    monsters[0].hp = 1;
    play(world, h, 'spade', monsters[0].id);
    const risen = enc.legion!.find((r) => r.type === 'ghoul')!;
    expect(risen.hp).toBe(Math.round(999 * R.claimHp));
    expect(risen.decay).toBe(0);
    expect(enc.slain ?? []).toHaveLength(0);
    play(world, h, 'preserve');
    expect(risen.preserved).toBe(true);
    risen.hp = 1;
    stepToEnd(world, h, 'back');
    act(world, enc.room, monsters[1]);
    expect(risen.hp).toBe(1);
    expect(risen.saved).toBe(true);
  });

  it('Lord of the Dead: a following of 6, and all decay shed', () => {
    const { world, h, enc } = fight(['undertaker']);
    play(world, h, 'graves');
    enc.legion![0].decay = 3;
    play(world, h, 'lord');
    expect(h.followCap).toBe(R.lordCap);
    expect(enc.legion![0].decay).toBe(0);
  });
});

describe('Bellwright', () => {
  it('Bellguard: Shield per Clang, and the Clang holds; Resonant Strike: Ringing Stuns on the next Delay', () => {
    const { world, h, monsters } = fight(['bellwright']);
    addClang(h, 3);
    play(world, h, 'bellguard');
    expect(h.st.shield).toBe(3 * R.bellguardPer);
    for (let i = 0; i < 4; i++) play(world, h, 'peal');
    expect(h.st.clang!.stacks).toBeGreaterThanOrEqual(3);
    play(world, h, 'resonant');
    expect(monsters[0].st.ringing).toBe(true);
    play(world, h, 'clang');
    expect(monsters[0].st.stun).toBe(true);
  });

  it('Discord trades places on the timeline; Metronome makes every card 3s; Send not for me tolls at each of its turns', () => {
    const { world, heroes, h, enc, room, monsters } = fight(['bellwright', 'warden']);
    const [, w] = heroes;
    const m = monsters[0];
    // The Ghoul is due in 5s, the Warden in 30: Discord trades them.
    setHand(h, ['discord']);
    submitChoice(world, h, { action: 'card', card: 'discord', target: w.id });
    enc.next[h.id] = world.time;
    enc.next[m.id] = world.time + 5;
    enc.next[w.id] = world.time + 30;
    const t0 = world.time;
    untilTurn(world, room, h.id);
    expect(enc.next[w.id]).toBeCloseTo(t0 + 5, 1);
    expect(enc.next[m.id]).toBeCloseTo(t0 + 30, 1);
    play(world, h, 'metronome');
    expect(cardTime(world, enc, h, 'knell')).toBe(R.metronomeTime);
    expect(cardTime(world, enc, w, 'slam')).toBe(R.metronomeTime);
    play(world, h, 'tollthee', m.id);
    const hp = m.hp;
    const clang = h.st.clang?.stacks ?? 0;
    act(world, room, m);
    expect(m.hp).toBe(hp - R.tollthee - R.tolltheePer * clang);
  });
});

describe('Zealot', () => {
  it("Eclipse: light to 0, and the Zealot's Fervour adds to every ally's damage this fight", () => {
    const { world, heroes, h } = fight(['zealot', 'warden']);
    const base = damageMult(heroes[1], world);
    play(world, h, 'eclipse');
    expect(h.light).toBe(0);
    expect(damageMult(heroes[1], world)).toBeGreaterThan(base * 1.5);
  });

  it('Brand: +1 taken per 10 light lacking; Purging Fire; Litany hits once more per 25 light lacking', () => {
    const { world, h, monsters } = fight(['zealot'], ['ghoul', 'ghoul']);
    h.light = 100;
    play(world, h, 'brand', monsters[0].id);
    expect(monsters[0].hp).toBe(999 - R.brand);
    h.light = 50;
    play(world, h, 'purge');
    // Darker now: Fervour on the hit, and the Brand on top.
    expect(monsters[1].hp).toBe(999 - Math.round(R.purge * damageMult(h, world)));
    expect(999 - R.brand - monsters[0].hp).toBe(Math.round(R.purge * damageMult(h, world)) + 7);
    h.light = 0;
    const hp = monsters[1].hp;
    play(world, h, 'litany', monsters[1].id);
    expect(hp - monsters[1].hp).toBe(R.litanyMax * Math.round(R.litany * damageMult(h, world)));
  });

  it('Blood for Blood: you bleed, another heals; alone, Shield', () => {
    const { world, heroes, h } = fight(['zealot', 'warden']);
    const w = heroes[1];
    w.hp -= 20;
    const hp = h.hp;
    play(world, h, 'bloodforblood', w.id);
    expect(h.hp).toBe(hp - R.bloodHp);
    expect(w.hp).toBe(w.maxHp - 20 + R.bloodHeal);
    const solo = fight(['zealot']);
    play(solo.world, solo.h, 'bloodforblood');
    expect(solo.h.st.shield).toBe(R.bloodBare);
  });
});

describe('Alchemist', () => {
  it('Mutagen: +50% damage and Regen, then Weak; Bottomless Flask: the next item stays', () => {
    const { world, h } = fight(['alchemist']);
    const base = damageMult(h, world);
    play(world, h, 'mutagen', h.id);
    expect(damageMult(h, world)).toBeCloseTo(base * (1 + R.mutagenMult));
    run(world, R.mutagenSecs + 1);
    expect(h.st.mutated).toBeUndefined();
    expect(h.st.weak).toBeDefined();
    h.items = ['bandage'];
    play(world, h, 'bottomless');
    h.hp -= 20;
    expect(applyItem(world, h, 0, h.id)).not.toMatch(/^!/);
    expect(h.items).toEqual(['bandage']);
    h.hp -= 20;
    applyItem(world, h, 0, h.id);
    expect(h.items).toEqual([]);
  });

  it('Corrosive Cloud: Acid now and at the start of each enemy turn; Flash Powder Blinds all; Distillation', () => {
    const { world, h, room, monsters } = fight(['alchemist'], ['ghoul', 'ghoul']);
    play(world, h, 'corrosive');
    expect(monsters[0].st.acid!.stacks).toBe(1);
    act(world, room, monsters[0]);
    expect(monsters[0].st.acid!.stacks).toBe(2);
    play(world, h, 'flash');
    expect(monsters.every((m) => m.st.blind)).toBe(true);
    monsters[1].st.poison = [{ dmg: 3, rounds: 3 }];
    const hp = monsters[1].hp;
    play(world, h, 'distill', monsters[1].id);
    expect(monsters[1].st.poison).toBeUndefined();
    expect(hp - monsters[1].hp).toBeGreaterThanOrEqual(Math.round(9 * R.distillMult));
  });
});
