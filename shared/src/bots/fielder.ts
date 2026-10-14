import { FIELD_RULES as F } from '../content/innates';
import { packFree } from '../content/items';
import { fieldSkillsOf, type FieldSkill } from '../sim/skills';
import type { PlayerView } from '../sim/views';
import type { Intent } from '../sim/world';

/**
 * When a bot uses its field ability (M16): a plain rule per ability, judged from its own view. Mediocre on purpose:
 * no planning, just "is it ready, and is now a sensible moment". The Toll stays with the explorer (it's for the exit).
 */
export function botFieldSkill(view: PlayerView): Intent | null {
  const you = view.you;
  if (you.encounter !== null || you.pos.kind !== 'room') return null;
  const here = you.pos.room;
  const ready = (s: FieldSkill) => fieldSkillsOf(you).includes(s) && (you.fieldReady[s] ?? 0) <= view.time;
  const mates = view.allies.filter((a) => a.live && !a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
  const threatNext = view.corridors.some((c) => !c.collapsed && (c.a === here || c.b === here)
    && (view.rooms.find((r) => r.id === (c.a === here ? c.b : c.a))?.threat ?? 0) > 0);
  const use = (skill: FieldSkill): Intent => ({ type: 'skill', skill });
  if (ready('formup') && (you.st.shield ?? 0) < F.formUpCap - F.formUpShield) return use('formup');
  if (ready('siphon') && you.light >= 60) return use('siphon');
  if (ready('rekindle') && (you.light < 60 || mates.some((a) => (a.light ?? 100) < 60))) return use('rekindle');
  if (ready('ringin') && threatNext) return use('ringin');
  if (ready('flagellate') && you.hp > you.maxHp * 0.6 && you.light > 50 && (threatNext || mates.some((a) => (a.light ?? 100) < 60))) return use('flagellate');
  if (ready('brew') && !you.rites.includes('gem') && packFree(you.items, you.gold) > 0) return use('brew');
  return null;
}
