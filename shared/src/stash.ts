import { titleFor, type CareerStats, type LeaderboardEntry } from './content/titles';
import { CLASSES, type ClassId } from './content/classes';
import type { TalentId } from './content/talents';
import { Rng } from './rng';
import { isResource, ITEMS, pluralName, RESOURCE_IDS, type ItemId, type ResourceId } from './content/items';
import {
  applyRun, chooseTalent, emptyKit, foundVillage, KIT_RULES, kitError, newCharacter, VILLAGE_RULES, type Character, type Injury, type Kit, type RunOutcome,
} from './village';

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
}

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
}

export type Treatment = Injury | 'affliction';

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
      const parsed = JSON.parse(raw) as Record<string, number | Record_>;
      for (const [key, v] of Object.entries(parsed)) {
        // M5–M10 stored just a gold number.
        this.data[key] = typeof v === 'number' ? { name: key, gold: v, runs: 0, escapes: 0, best: v } : v;
        // Before M12 gold was for bragging only: what was banked becomes the purse.
        this.data[key].purse ??= this.data[key].gold;
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
    };
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
    const err = kitError(kit, r.items ?? [], this.resourcesOf(r));
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
    out.consumables = kit.consumables.filter(take);
    out.rites = kit.rites.filter((x) => {
      if (res[x] < KIT_RULES.riteCost) return false;
      res[x] -= KIT_RULES.riteCost;
      return true;
    });
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
      else r.items.push(it);
    }
    r.items.sort((a, b) => STASH_ORDER(a) - STASH_ORDER(b) || ITEMS[a].name.localeCompare(ITEMS[b].name));
    r.resources = res;
    this.save();
    const counts = new Map<ItemId, number>();
    for (const it of carried) counts.set(it, (counts.get(it) ?? 0) + 1);
    return `Into the Village Stash: ${[...counts].map(([it, n]) => (n > 1 ? `${n} ${pluralName(it)}` : ITEMS[it].name)).join(', ')}.`;
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

  /** Pay to treat one injury (or the affliction) of a Character. Returns an error, or null. */
  treat(name: string, charId: string, what: Treatment): string | null {
    const { r, chars } = this.villageOf(name);
    const c = chars.find((x) => x.id === charId);
    if (!c) return 'No such Character.';
    if (what === 'affliction' ? !c.affliction : !c.injuries.includes(what)) return `${c.name} has nothing like that to treat.`;
    const cost = VILLAGE_RULES.cost[what];
    if ((r.purse ?? 0) < cost) return `That costs ${cost} gold; you have ${r.purse ?? 0}.`;
    r.purse = (r.purse ?? 0) - cost;
    if (what === 'affliction') c.affliction = null;
    else c.injuries.splice(c.injuries.indexOf(what), 1);
    this.save();
    return null;
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
