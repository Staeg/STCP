import { titleFor, type CareerStats, type LeaderboardEntry } from './content/titles';
import { CLASSES, type ClassId } from './content/classes';
import type { TalentId } from './content/talents';
import { Rng } from './rng';
import { emptyCodex, mergeCodex, type Codex } from './content/codex';
import { EMERGENCIES, emergenciesAt, emergencyBans, WELLBEING, type EmergencyId } from './content/emergencies';
import { isResource, ITEMS, migrateItemId, pluralName, RESOURCE_IDS, type ItemId, type ResourceId } from './content/items';
import {
  applyRun, BUILDING_IDS, BUILDINGS, chooseTalent, riteCost, emptyKit, foundVillage, INJURY_NAMES, kitError, LEVEL_NAMES, newCharacter, noBuildings,
  SERVICE_RELICS, serviceHome, SERVICES, talentPending, upkeepOf, VILLAGE_RULES,
  type BuildingId, type Buildings, type Character, type Injury, type Kit, type RunOutcome, type ServiceId, type Sight,
} from './village';
import { forgeable, GEAR_KINDS, GEAR_KIND_PLURALS, randomGear, reforged, rerollPool, type GearKind } from './content/forge';

/** Where the stash is kept: a JSON file on the server, localStorage in solo play. */
export interface StashStore {
  load(): string | null;
  save(json: string): void;
}

interface Record_ extends CareerStats {
  /** Display name as last used (keys are lower-cased). */
  name: string;
  /** Spendable gold (M12). `gold` stays the lifetime total that titles and the Hall of Fortune go by. */
  purse?: number;
  /** The Village's Characters (created on first use). */
  village?: Character[];
  /** Counter for Character ids. */
  nextChar?: number;
  /** What happened to this player's Characters in their last run. */
  report?: string[];
  /** The Village Stash: every consumable and piece of Gear carried home. */
  items?: ItemId[];
  /** Resources carried home (they don't sell any more). */
  resources?: Record<ResourceId, number>;
  /** What the player will take into their next run. */
  kit?: Kit;
  /** The Village's Wellbeing (M13): 1–5, starting at 3. */
  wellbeing?: number;
  /** The Emergency picked for the next run. */
  emergency?: EmergencyId | null;
  /** Wellbeing hit 6 or 0: the game is over until the player chooses how to go on. */
  fate?: VillageFate;
  /** Buildings' levels (0 = not built). */
  buildings?: Buildings;
  /** Services used since the last run (each once between runs). */
  used?: ServiceId[];
  /** What the Seer will show next run. */
  sight?: Sight;
  /** What the last Village action did ("The Blacksmith forged a Rusty Dirk."). */
  notice?: string;
  /** Everything this player's heroes have come across (Armory, Bestiary, Archive; since 2026-10-11). */
  codex?: Codex;
}

/** A use of a building's service: on a Character (Elder), a Stash item (Blacksmith), or a pick (Seer). */
export interface ServiceRequest {
  service: ServiceId;
  charId?: string;
  injury?: Injury;
  item?: ItemId;
  pick?: string;
}

/** How a Village's game ended (Wellbeing 6 or 0). */
export type VillageFate = 'won' | 'lost';
/** After a win or a loss (user, for now): Wellbeing back to 3, or a fresh Village, Stash and purse. */
export type FateChoice = 'reset' | 'restart';

/** One player's Village as the client sees it. */
export interface VillageView {
  purse: number;
  characters: Character[];
  /** What the last run did to them. */
  report: string[];
  /** The Village Stash (consumables and Gear, sorted), Resources, and the kit chosen for the next run. */
  items: ItemId[];
  resources: Record<ResourceId, number>;
  kit: Kit;
  wellbeing: number;
  /** The two Emergencies of this Wellbeing level, and the one picked (if any). */
  offered: EmergencyId[];
  emergency: EmergencyId | null;
  fate: VillageFate | null;
  buildings: Buildings;
  /** Services already used before the next run. */
  used: ServiceId[];
  sight: Sight;
  /** Gold the Village pays after each run. */
  upkeep: number;
  notice: string | null;
  /** The Armory, Bestiary and Archive: what this player has come across in their runs. */
  codex: Codex;
}

/** The Stash lists consumables first, then weapons, armor, amulets, rings. */
const KIND_ORDER = ['consumable', 'weapon', 'armor', 'amulet', 'ring', 'resource'];
const STASH_ORDER = (it: ItemId) => KIND_ORDER.indexOf(ITEMS[it].kind);


/**
 * Career stats per player name (case-insensitive). No accounts in the prototype, so a name is an
 * identity. Gold is for bragging only (titles + the Hall of Fortune), by the user's choice in M11.
 */
export class Stash {
  private data: Record<string, Record_> = {};

  /** `null` keeps everything in memory (tests). */
  constructor(private store: StashStore | null = null) {
    const raw = store?.load();
    if (!raw) return;
    try {
      // The Witch became the Sorceress (2026-10-10): Characters saved before then still say 'witch'.
      const parsed = JSON.parse(raw.replace(/"cls"\s*:\s*"witch"/g, '"cls": "sorceress"')) as Record<string, number | Record_>;
      for (const [key, v] of Object.entries(parsed)) {
        // M5–M10 stored just a gold number.
        this.data[key] = typeof v === 'number' ? { name: key, gold: v, runs: 0, escapes: 0, best: v } : v;
        // Before M12 gold was for bragging only: what was banked becomes the purse.
        this.data[key].purse ??= this.data[key].gold;
        // Gear types (2026-10-11): the old weapons and armor become the new piece of the same rarity.
        const r = this.data[key];
        if (r.items) r.items = r.items.map(migrateItemId);
        if (r.kit) for (const s of Object.keys(r.kit.gear) as (keyof Kit['gear'])[]) r.kit.gear[s] = migrateItemId(r.kit.gear[s]!);
        // Insanity replaced the four afflictions (2026-10-11): any affliction a Character carried home is now Insanity.
        for (const c of (r.village ?? []) as (Character & { affliction?: string | null })[]) {
          if ('affliction' in c) {
            c.insane = !!c.affliction;
            delete c.affliction;
          }
          c.insane ??= false;
        }
      }
    } catch {
      // Unreadable stash: start empty.
    }
  }

  get(name: string): number {
    return this.data[name.toLowerCase()]?.gold ?? 0;
  }

  stats(name: string): CareerStats {
    const r = this.data[name.toLowerCase()];
    return r ? { gold: r.gold, runs: r.runs, escapes: r.escapes, best: r.best } : { gold: 0, runs: 0, escapes: 0, best: 0 };
  }

  /**
   * Record one finished run for a player. `gold` only counts if they escaped; `legacy` is gold an
   * Undertaker carried out for them after they died, which counts either way.
   */
  recordRun(name: string, escaped: boolean, gold: number, legacy = 0) {
    const r = this.record(name);
    r.runs++;
    const banked = escaped ? gold : legacy;
    if (escaped) {
      r.escapes++;
      r.best = Math.max(r.best, gold);
    }
    r.gold += banked;
    r.purse = (r.purse ?? 0) + banked;
    this.save();
  }

  private record(name: string): Record_ {
    const key = name.toLowerCase();
    const r = (this.data[key] ??= { name, gold: 0, runs: 0, escapes: 0, best: 0, purse: 0 });
    r.name = name;
    return r;
  }

  private save() {
    this.store?.save(JSON.stringify(this.data, null, 2));
  }

  /** This player's Characters, founding the Village on first use. */
  private villageOf(name: string): { r: Record_; chars: Character[] } {
    const r = this.record(name);
    if (!r.village) {
      r.nextChar ??= 1;
      r.village = foundVillage(this.rng(name), () => `c${r.nextChar!++}`);
      this.save();
    }
    return { r, chars: r.village };
  }

  private rng(name: string): Rng {
    let h = Date.now() & 0x7fffffff;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff;
    return new Rng(h || 1);
  }

  village(name: string): VillageView {
    const { r, chars } = this.villageOf(name);
    return {
      purse: r.purse ?? 0, characters: structuredClone(chars), report: [...(r.report ?? [])],
      items: [...(r.items ?? [])], resources: this.resourcesOf(r), kit: structuredClone(r.kit ?? emptyKit()),
      wellbeing: this.wellbeingOf(r), offered: r.fate ? [] : emergenciesAt(this.wellbeingOf(r)), emergency: r.fate ? null : (r.emergency ?? null),
      fate: r.fate ?? null,
      buildings: this.buildingsOf(r), used: [...(r.used ?? [])], sight: { ...r.sight }, upkeep: upkeepOf(this.buildingsOf(r)), notice: r.notice ?? null,
      codex: { ...emptyCodex(), ...structuredClone(r.codex) },
    };
  }

  /** A run's finds go into the player's Codex (true if anything was new). */
  recordCodex(name: string, found: Partial<Codex>): boolean {
    const { r } = this.villageOf(name);
    const added = mergeCodex((r.codex ??= emptyCodex()), found);
    if (added) this.save();
    return added;
  }

  private buildingsOf(r: Record_): Buildings {
    return { ...noBuildings(), ...r.buildings };
  }

  private resourcesOf(r: Record_): Record<ResourceId, number> {
    return { ...(Object.fromEntries(RESOURCE_IDS.map((x) => [x, 0])) as Record<ResourceId, number>), ...r.resources };
  }

  /** The kit this player would bring now (empty if none chosen). */
  kitOf(name: string): Kit {
    return structuredClone(this.data[name.toLowerCase()]?.kit ?? emptyKit());
  }

  /** Choose what to take into the next run. Returns an error, or null. */
  setKit(name: string, kit: Kit): string | null {
    const r = this.record(name);
    const err = kitError(kit, r.items ?? [], this.resourcesOf(r), r.emergency ?? null);
    if (err) return err;
    r.kit = structuredClone(kit);
    this.save();
    return null;
  }

  /**
   * A run is starting: take the chosen kit out of the Stash (whatever of it is still there) and spend the Rites'
   * Resources. Returns what was actually taken; the choice is cleared.
   */
  takeKit(name: string): Kit {
    const r = this.data[name.toLowerCase()];
    if (!r?.kit) return emptyKit();
    const kit = r.kit;
    const items = r.items ?? [];
    const res = this.resourcesOf(r);
    const take = (it: ItemId) => {
      const i = items.indexOf(it);
      if (i < 0) return false;
      items.splice(i, 1);
      return true;
    };
    const out = emptyKit();
    for (const [slot, it] of Object.entries(kit.gear)) if (it && take(it)) out.gear[slot as keyof Kit['gear']] = it;
    out.rites = kit.rites.filter((x) => {
      if (res[x] < riteCost(x)) return false;
      res[x] -= riteCost(x);
      return true;
    });
    // The Gem Rite forbids consumables, and the Emergency what it needs carried out: they stay in the Stash.
    const banned = emergencyBans(r.emergency);
    out.consumables = out.rites.includes('gem') ? [] : kit.consumables.filter((it) => !banned.includes(it)).filter(take);
    r.items = items;
    r.resources = res;
    r.kit = undefined;
    this.save();
    return out;
  }

  /** Everything a player's hero carried out goes into their Village Stash. Returns a line for the run report. */
  storeLoot(name: string, carried: ItemId[]): string | null {
    if (!carried.length) return null;
    const r = this.record(name);
    const res = this.resourcesOf(r);
    r.items ??= [];
    for (const it of carried) {
      if (isResource(it)) res[it]++;
      // Valuables are sold on the way home.
      else if (ITEMS[it].kind === 'valuable') r.purse = (r.purse ?? 0) + (ITEMS[it].value ?? 0);
      else r.items.push(it);
    }
    r.items.sort((a, b) => STASH_ORDER(a) - STASH_ORDER(b) || ITEMS[a].name.localeCompare(ITEMS[b].name));
    r.resources = res;
    this.save();
    const counts = new Map<ItemId, number>();
    for (const it of carried) counts.set(it, (counts.get(it) ?? 0) + 1);
    return `Into the Village Stash: ${[...counts].map(([it, n]) => (n > 1 ? `${n} ${pluralName(it)}` : ITEMS[it].name)).join(', ')}.`;
  }

  private wellbeingOf(r: Record_): number {
    return r.wellbeing ?? WELLBEING.start;
  }

  /** The Emergency this player has picked for their next run (none while their game is over). */
  emergencyOf(name: string): EmergencyId | null {
    const r = this.data[name.toLowerCase()];
    return r && !r.fate ? (r.emergency ?? null) : null;
  }

  /** Pick one of the two Emergencies of the Village's Wellbeing. What it needs carried out leaves the kit. */
  chooseEmergency(name: string, id: EmergencyId): string | null {
    const r = this.record(name);
    if (r.fate) return 'Your Village’s story is over: choose how to go on first.';
    if (!emergenciesAt(this.wellbeingOf(r)).includes(id)) return `${EMERGENCIES[id].name} isn't this Village's Emergency.`;
    r.emergency = id;
    const banned = emergencyBans(id);
    if (r.kit) {
      r.kit.consumables = r.kit.consumables.filter((it) => !banned.includes(it));
      for (const [slot, it] of Object.entries(r.kit.gear)) if (it && banned.includes(it)) delete r.kit.gear[slot as keyof Kit['gear']];
    }
    this.save();
    return null;
  }

  /**
   * A real run is over: the player's Emergency was done (+1 Wellbeing) or not (−1). At 6 the game is won, at 0
   * lost. Returns the lines for the run report.
   */
  settleEmergency(name: string, id: EmergencyId, done: boolean): string[] {
    const r = this.record(name);
    const before = this.wellbeingOf(r);
    const after = Math.max(WELLBEING.lose, Math.min(WELLBEING.win, before + (done ? 1 : -1)));
    r.wellbeing = after;
    r.emergency = null;
    const lines = [`${EMERGENCIES[id].name}: ${done ? 'done' : 'failed'}. Wellbeing ${before} → ${after}.`];
    if (after >= WELLBEING.win) {
      r.fate = 'won';
      lines.push('The Village prospers. You have won!');
    } else if (after <= WELLBEING.lose) {
      r.fate = 'lost';
      lines.push('The Village has fallen. The game is lost.');
    }
    (r.report ??= []).push(...lines);
    this.save();
    return lines;
  }

  /** After a win or a loss: Wellbeing back to 3 (everything else kept), or start over with a fresh Village. */
  chooseFate(name: string, choice: FateChoice): string | null {
    const r = this.record(name);
    if (!r.fate) return 'Your Village’s story isn’t over.';
    r.fate = undefined;
    r.wellbeing = WELLBEING.start;
    r.emergency = null;
    if (choice === 'restart') {
      // A fresh Village, Stash and purse. Career stats (titles, the Hall of Fortune) are kept.
      r.village = undefined;
      r.items = [];
      r.resources = undefined;
      r.kit = undefined;
      r.purse = 0;
      r.buildings = undefined;
      r.used = undefined;
      r.sight = undefined;
      r.report = ['A new Village rises from the old one’s ashes.'];
    } else {
      r.report = ['The Village carries on. Wellbeing is back to 3.'];
    }
    this.save();
    return null;
  }

  purse(name: string): number {
    return this.data[name.toLowerCase()]?.purse ?? 0;
  }

  /** The Character this player brings when they pick a class (the first of that class). */
  characterFor(name: string, cls: ClassId): Character {
    return structuredClone(this.villageOf(name).chars.find((c) => c.cls === cls)!);
  }

  /** Every Character in this player's Village. */
  characters(name: string): Character[] {
    return structuredClone(this.villageOf(name).chars);
  }

  /** Returns an error, or null. */
  chooseTalent(name: string, charId: string, talent: TalentId): string | null {
    const c = this.villageOf(name).chars.find((x) => x.id === charId);
    if (!c) return 'No such Character.';
    const err = chooseTalent(c, talent);
    if (!err) this.save();
    return err;
  }

  /** Build the next level of a building, paying its Resources. Returns an error, or null. */
  build(name: string, id: BuildingId): string | null {
    const r = this.record(name);
    const b = this.buildingsOf(r);
    const def = BUILDINGS[id];
    if (!def) return 'No such building.';
    if (b[id] >= def.levels.length) return `The ${def.name} is already a Master.`;
    const level = def.levels[b[id]];
    const res = this.resourcesOf(r);
    for (const [x, n] of Object.entries(level.cost) as [ResourceId, number][]) {
      if (res[x] < n) return `${b[id] === 0 ? 'An' : 'A'} ${LEVEL_NAMES[b[id] + 1]} ${def.name} needs ${n} ${pluralName(x)}; you have ${res[x]}.`;
    }
    for (const [x, n] of Object.entries(level.cost) as [ResourceId, number][]) res[x] -= n;
    r.resources = res;
    b[id]++;
    r.buildings = b;
    r.notice = `Built: ${LEVEL_NAMES[b[id]]} ${def.name} (+${level.upkeep} gold upkeep a run).`;
    this.save();
    return null;
  }

  /** Tear down a building's top level, for nothing back. */
  demolish(name: string, id: BuildingId): string | null {
    const r = this.record(name);
    const b = this.buildingsOf(r);
    if (!BUILDINGS[id]) return 'No such building.';
    if (b[id] <= 0) return 'Nothing to tear down.';
    r.notice = `Torn down: ${LEVEL_NAMES[b[id]]} ${BUILDINGS[id].name}.`;
    b[id]--;
    r.buildings = b;
    this.save();
    return null;
  }

  /** Use one of the Village's services (each once between runs). Returns an error, or null. */
  useService(name: string, req: ServiceRequest): string | null {
    const r = this.record(name);
    const s = req.service;
    if (!SERVICES[s]) return 'No such service.';
    const home = serviceHome(s);
    const def = BUILDINGS[home.building];
    if (this.buildingsOf(r)[home.building] < home.level) return `That needs ${home.level === 1 ? 'an' : 'a'} ${LEVEL_NAMES[home.level]} ${def.name}.`;
    if (r.used?.includes(s)) return `${SERVICES[s].name} is done for now: once before each run.`;
    const res = this.resourcesOf(r);
    if (SERVICES[s].relic && res.relic < SERVICE_RELICS) return `${SERVICES[s].name} costs a Relic.`;
    const chars = this.villageOf(name).chars;
    const items = (r.items ??= []);
    const rng = this.rng(name + s);
    const char = () => chars.find((c) => c.id === req.charId);
    const gearHere = () => (req.item && items.includes(req.item) ? req.item : null);
    let notice: string;
    switch (s) {
      case 'forge': {
        const it = randomGear(rng, 1);
        items.push(it);
        notice = `The Blacksmith forged a ${ITEMS[it].name}.`;
        break;
      }
      case 'reroll':
      case 'upgrade': {
        const it = gearHere();
        if (!it) return 'Pick a piece of Gear from your Stash.';
        let into: ItemId;
        if (s === 'reroll') {
          const pool = rerollPool(it);
          if (!pool.length) return `There is no other ${ITEMS[it].name} of its type and rarity.`;
          into = rng.pick(pool);
        } else {
          if (!forgeable(it)) return 'Rares can’t be bettered.';
          into = reforged(rng, it);
        }
        items[items.indexOf(it)] = into;
        notice = `The Blacksmith ${s === 'reroll' ? 'reforged' : 'reworked'} your ${ITEMS[it].name} into a ${ITEMS[into].name}.`;
        break;
      }
      case 'seeConsumable':
      case 'seeResource':
      case 'seeGear': {
        const p = req.pick ?? '';
        const sight = (r.sight ??= {});
        if (s === 'seeConsumable') {
          if (!(p in ITEMS) || ITEMS[p as ItemId].kind !== 'consumable') return 'Pick a consumable.';
          sight.consumable = p as ItemId;
          notice = `Next run, the Seer will show you where ${pluralName(p as ItemId)} lie.`;
        } else if (s === 'seeResource') {
          if (!RESOURCE_IDS.includes(p as ResourceId)) return 'Pick a Resource.';
          sight.resource = p as ResourceId;
          notice = `Next run, the Seer will show you where ${pluralName(p as ResourceId)} lie.`;
        } else {
          if (!GEAR_KINDS.includes(p as GearKind)) return 'Pick a type of Gear.';
          sight.gear = p as GearKind;
          notice = `Next run, the Seer will show you where ${GEAR_KIND_PLURALS[p as GearKind]} lie.`;
        }
        break;
      }
      case 'heal': {
        const c = char();
        if (!c) return 'Pick a Character.';
        const i = c.injuries.indexOf(req.injury ?? (c.injuries.includes('major') ? 'major' : 'minor'));
        if (i < 0) return `${c.name} has no such injury.`;
        const healed = c.injuries.splice(i, 1)[0];
        notice = `The Elder healed ${c.name}'s ${INJURY_NAMES[healed]}.`;
        break;
      }
      case 'cure': {
        const c = char();
        if (!c) return 'Pick a Character.';
        if (!c.insane) return `${c.name} is not Insane.`;
        c.insane = false;
        notice = `The Elder brought ${c.name} back to their senses.`;
        break;
      }
      case 'train': {
        const c = char();
        if (!c) return 'Pick a Character.';
        if (c.talent || talentPending(c)) return `${c.name} has nothing more to learn for now.`;
        c.xp = Math.min(VILLAGE_RULES.xpForTalent, c.xp + 1);
        notice = talentPending(c) ? `${c.name} learned enough to choose a Talent.` : `${c.name} gained XP (${c.xp}/${VILLAGE_RULES.xpForTalent}).`;
        break;
      }
    }
    if (SERVICES[s].relic) {
      res.relic -= SERVICE_RELICS;
      r.resources = res;
    }
    (r.used ??= []).push(s);
    this.sortStash(r);
    this.fixKit(r);
    r.notice = notice;
    this.save();
    return null;
  }

  /** The Seer's sight for the run that's starting: it's used up. */
  takeSight(name: string): Sight | undefined {
    const r = this.data[name.toLowerCase()];
    const sight = r?.sight;
    if (r?.sight) {
      r.sight = undefined;
      this.save();
    }
    return sight && Object.keys(sight).length ? sight : undefined;
  }

  /**
   * A real run is over for this player: pay the buildings' upkeep from the purse (after the haul). If the purse can't
   * cover it, levels fall at random until it can. Services are ready again. Returns the report lines.
   */
  payUpkeep(name: string): string[] {
    const r = this.record(name);
    const b = this.buildingsOf(r);
    const lines: string[] = [];
    const rng = this.rng(`${name}upkeep`);
    let purse = r.purse ?? 0;
    while (upkeepOf(b) > purse) {
      const standing = BUILDING_IDS.filter((id) => b[id] > 0);
      if (!standing.length) break;
      const id = rng.pick(standing);
      lines.push(`Short of upkeep: the ${LEVEL_NAMES[b[id]]} ${BUILDINGS[id].name} closed.`);
      b[id]--;
    }
    const upkeep = upkeepOf(b);
    if (upkeep > 0) {
      purse -= upkeep;
      lines.push(`Upkeep: −${upkeep} gold.`);
    }
    r.purse = purse;
    r.buildings = b;
    r.used = [];
    r.notice = undefined;
    (r.report ??= []).push(...lines);
    this.save();
    return lines;
  }

  private sortStash(r: Record_) {
    r.items?.sort((a, b) => STASH_ORDER(a) - STASH_ORDER(b) || ITEMS[a].name.localeCompare(ITEMS[b].name));
  }

  /** Drop from the kit any Gear the Stash no longer holds (reforged, say). */
  private fixKit(r: Record_) {
    if (!r.kit) return;
    const left = [...(r.items ?? [])];
    for (const [slot, it] of Object.entries(r.kit.gear)) {
      const i = it ? left.indexOf(it) : -1;
      if (i >= 0) left.splice(i, 1);
      else delete r.kit.gear[slot as keyof Kit['gear']];
    }
  }

  /** A run is over: what it did to one of this player's Characters. A death replaces them with a recruit. */
  recordCharacter(name: string, charId: string, out: RunOutcome): string[] {
    const { r, chars } = this.villageOf(name);
    const i = chars.findIndex((x) => x.id === charId);
    if (i < 0) return [];
    const c = chars[i];
    const { died, lines } = applyRun(c, out);
    if (died) {
      r.nextChar ??= 1;
      const recruit = newCharacter(`c${r.nextChar++}`, c.cls, this.rng(name + charId), chars.map((x) => x.name));
      chars[i] = recruit;
      lines.push(`${recruit.name}, a new ${CLASSES[recruit.cls].name}, takes their place.`);
    }
    r.report = lines;
    this.save();
    return lines;
  }

  /** Add a line to this player's last-run report (e.g. what went into the Stash). */
  addReport(name: string, line: string) {
    const r = this.record(name);
    (r.report ??= []).push(line);
    this.save();
  }

  leaderboard(limit = 10): LeaderboardEntry[] {
    return Object.values(this.data)
      .filter((r) => r.gold > 0 || r.runs > 0)
      .sort((a, b) => b.gold - a.gold || b.escapes - a.escapes)
      .slice(0, limit)
      .map((r) => ({ name: r.name, gold: r.gold, runs: r.runs, escapes: r.escapes, best: r.best, title: titleFor(r.gold) }));
  }
}
