import {
  AFFLICTION_RULES, AFFLICTIONS, BLEED_OUT, fmtSpeed, MIN_SPEED, speedOf, speedParts, dirBetween, type Dir, LIGHT_DIM, CLASSES, ESCALATION, EVENT_SEEDING,
  FIELD_SKILLS, fieldSkillsOf, skillTargeted, REVIVE_CHANNEL, type FieldSkill, TIER_TEXT, type PlayerView,
} from '@stcp/shared';
import { beep } from './sound';
import { juice } from './juice';
import type { Net } from './net';
import { cooldownIcon, icon, ICON_TIPS, type IconId } from './icons';

const $ = (id: string) => document.getElementById(id)!;

/** Replace an element's HTML only when it changed, so hover tooltips and clicks survive the 10 Hz redraws. */
const shown = new WeakMap<HTMLElement, string>();
function setHtml(el: HTMLElement, html: string) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private lastTier = 0;
  private bannerTimer = 0;
  private persistentBanner = false;

  constructor(private net: Net) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.outerHTML = icon(el.dataset.icon as IconId);
    $('btn-turn').addEventListener('click', () => net.intent({ type: 'turnBack' }));
    $('btn-lobby').addEventListener('click', () => net.send({ t: 'toLobby' }));
    $('btn-escape').addEventListener('click', () => net.intent({ type: 'extract' }));
    // Out-of-combat class skills (Toll, and abilities that work in the field): one button per possible target.
    $('skills').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-skill]') as HTMLButtonElement | null;
      if (!b || b.classList.contains('cooling')) return;
      const skill = b.dataset.skill as FieldSkill;
      net.intent(b.dataset.target ? { type: 'skill', skill, target: b.dataset.target } : { type: 'skill', skill });
    });
    $('btn-revive').addEventListener('click', () => {
      const id = $('btn-revive').dataset.target;
      if (id) net.intent({ type: 'revive', target: id });
    });
    addEventListener('keydown', (e) => {
      if (!net.cur || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (net.cur.encounter) return; // combat has its own keys
      if (e.code === 'KeyR') $('btn-revive').click();
      if (e.code === 'KeyE' && !$('btn-escape').hidden) $('btn-escape').click();
      const dir = ({ KeyW: 'north', KeyA: 'west', KeyS: 'south', KeyD: 'east' } as const)[e.code as 'KeyW'];
      if (dir) {
        const room = roomInDir(net.cur, dir);
        if (room !== null) net.intent({ type: 'goto', room, step: true });
      }
      if (e.code === 'KeyM' && !$('skills').hidden) ($('skills').querySelector('button[data-skill]:not(.cooling)') as HTMLButtonElement | null)?.click();
      if (e.code === 'Space') {
        e.preventDefault();
        net.intent({ type: 'turnBack' });
      } else if (e.code === 'Escape') {
        net.intent({ type: 'stop' });
      }
    });
  }

  update() {
    const net = this.net;
    const netEl = $('net');
    netEl.textContent = net.status === 'open' ? `connected · ${net.ping} ms` : net.status === 'connecting' ? 'connecting…' : 'disconnected — retrying';
    netEl.classList.toggle('bad', net.status !== 'open');

    const view = net.cur;
    if (!view) return;
    // Smooth the clock between 10 Hz snapshots.
    const time = view.phase === 'running' ? view.time + Math.min(0.1, (performance.now() - net.curAt) / 1000) : view.time;

    $('clock').textContent = fmtTime(time);
    $('tier').textContent = `Tier ${view.tier}`;
    const next = $('next-event');
    const here = view.you.pos.kind === 'room' ? view.you.pos.room : -1;
    if (time < view.exitOpensAt) {
      next.textContent = `Exit opens in ${fmtTime(view.exitOpensAt - time)}`;
    } else {
      next.textContent = `EXIT OPEN · collapse in ${fmtTime(view.collapseAt - time)}`;
    }
    $('clock').classList.toggle('urgent', time >= view.exitOpensAt);

    const you = view.you;
    const cls = CLASSES[you.cls];
    $('hero-name').innerHTML = `<span style="color:${you.color}">■</span> ${escape(you.name)} <span style="color:var(--muted)">· ${cls.name}</span>`;
    const aff = $('affliction');
    aff.hidden = !you.affliction;
    if (you.affliction) {
      const def = AFFLICTIONS[you.affliction];
      aff.textContent = `⚠ ${def.name.toUpperCase()}`;
      aff.title = `${def.desc} ${AFFLICTION_RULES}`;
    }
    const escort = $('escort');
    escort.hidden = !view.leading;
    if (view.leading) escort.textContent = `☺ Escorting a villager (${view.leading.hp}/${view.leading.maxHp}) → rendezvous`;
    const { altars, villagers } = view.objectives;
    const bonus = altars * EVENT_SEEDING.altarBonus + villagers * EVENT_SEEDING.villagerBonus;
    $('objectives').textContent = altars || villagers ? `⛧ ${altars} cleansed · ☺ ${villagers} saved · +${bonus} gold on escape` : '';
    $('hp-text').textContent = `${Math.max(0, Math.ceil(you.hp))}/${you.maxHp}`;
    $('hp-fill').style.width = `${(Math.max(0, you.hp) / you.maxHp) * 100}%`;
    $('stress-text').textContent = `${Math.round(you.stress)}`;
    $('stress-fill').style.width = `${you.stress}%`;
    $('light-text').textContent = view.dim ? (you.light <= 0 ? '(DARK)' : '(DIM)') : '';
    $('light-text').title = you.light <= 0
      ? 'Darkness: +0.5 stress per second, and monsters hit you 25% harder.'
      : `Dim (light under ${LIGHT_DIM}): +0.15 stress per second, and you can't see into neighbouring rooms.`;
    // Speed: seconds per turn in a fight and per tunnel. Hover for what's making it up.
    const speed = speedOf(you, view.time);
    $('speed-text').textContent = `${fmtSpeed(speed)} per turn / tunnel`;
    $('speed-line').title = `${ICON_TIPS.speed}
`
      + speedParts(you, view.time).map((p, i) => `${i === 0 ? '' : p.amount < 0 ? '− ' : '+ '}${fmtSpeed(Math.abs(p.amount))} ${p.label}`).join(' ')
      + ` = ${fmtSpeed(speed)}${speedParts(you, view.time).reduce((t, p) => t + p.amount, 0) < MIN_SPEED ? ` (never below ${fmtSpeed(MIN_SPEED)})` : ''}`;
    const fill = $('light-fill');
    fill.style.width = `${you.light}%`;
    fill.classList.toggle('dim', view.dim);
    $('location').textContent = locationText(view);

    $('btn-turn').hidden = you.pos.kind !== 'corridor' || you.downedAt !== null || you.dead;

    // Out-of-combat revive: a downed ally in your room.
    const reviveBtn = $('btn-revive');
    const downed = !view.encounter && you.downedAt === null && !you.dead
      ? view.allies.find((a) => a.live && a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here)
      : undefined;
    reviveBtn.hidden = !downed || you.channel?.kind === 'dig';
    if (downed) {
      reviveBtn.dataset.target = downed.id;
      reviveBtn.innerHTML = you.channel?.kind === 'revive' ? `Reviving ${escape(downed.name)}…` : `✚ Revive ${escape(downed.name)} (${REVIVE_CHANNEL}s) <kbd>R</kbd>`;
    }

    const free = !view.encounter && you.downedAt === null && !you.dead && !you.extracted && you.pos.kind === 'room';

    renderSkills(view, free, here);

    // Channel progress (reviving, digging), or else your Speed timer and what happens when it runs out.
    const ch = $('channel');
    ch.hidden = you.channel?.kind === 'event' || (!you.channel && !free); // events show progress in their own panel
    if (you.channel && you.channel.kind !== 'event') {
      const left = Math.max(0, you.channel.until - view.time);
      ch.textContent = `${you.channel.kind === 'dig' ? 'Digging' : 'Reviving'}… ${left.toFixed(1)}s (walk elsewhere to cancel)`;
    } else if (!you.channel && free) {
      // Only the text changes each frame, so the icon's hover explanation stays up.
      if (!ch.querySelector('#channel-text')) ch.innerHTML = `${icon('speed', 'Your Speed timer: when it runs out, you take your turn.')} <span id="channel-text"></span>`;
      $('channel-text').textContent = `${Math.max(0, you.turnAt - time).toFixed(1)}s · ${turnPlan(view)}`;
    }

    // The way out
    const esc = $('btn-escape');
    const atExit = free && here === view.exitRoom;
    esc.hidden = !atExit || !view.exitOpen;
    if (!esc.hidden) esc.innerHTML = `⚑ ESCAPE with ${you.gold} gold <kbd>E</kbd>`;
    setHtml($('roster'), rosterHtml(view));
    const isHost = net.lobby?.hostId === net.lobby?.youId;
    $('btn-lobby').hidden = !(view.phase !== 'running' && isHost);

    // Tier-change banner
    if (view.tier > this.lastTier) {
      this.lastTier = view.tier;
      this.showBanner(`Tier ${view.tier}<br><span style="font-size:26px">${TIER_TEXT[view.tier] ?? ''}</span>`, 4500);
      beep(view.tier >= 5 ? 'alarm' : 'tier');
      juice(view.tier >= 5 ? 'alarm' : 'tier');
    }
    this.lastTier = view.tier;
    if (view.phase !== 'running') $('banner').hidden = true; // the results screen takes over
    else if (you.extracted) this.showBanner(`YOU ESCAPED<br><span style="font-size:24px">with ${you.gold} gold. The others are still inside…</span>`, 0);
    else if (you.dead) this.showBanner('YOU HAVE DIED<br><span style="font-size:24px">Your allies fight on without you.</span>', 0);
    else if (you.downedAt !== null && !view.encounter) {
      const left = Math.max(0, BLEED_OUT - (view.time - you.downedAt));
      this.showBanner(`YOU ARE DOWN<br><span style="font-size:24px">Bleeding out in ${Math.ceil(left)}s — an ally must reach you.</span>`, 0);
    } else if (this.persistentBanner) {
      $('banner').hidden = true;
    }
    this.persistentBanner = view.phase !== 'running' || you.dead || you.extracted || (you.downedAt !== null && !view.encounter);
  }

  /** Called when leaving the game view (back to lobby). */
  reset() {
    this.lastTier = 0;
    $('banner').hidden = true;
    $('btn-lobby').hidden = true;
  }

  private showBanner(html: string, ms: number) {
    const b = $('banner');
    b.innerHTML = html;
    b.hidden = false;
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (b.hidden = true), ms);
  }
}

function rosterHtml(view: PlayerView): string {
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'somewhere unknown';
  const rows = view.allies.map((a) => {
    let status: string;
    const hp = a.extracted ? '' : a.dead ? ' · DEAD' : a.downed ? ' · DOWN' : ` · ${icon('hp')}${Math.max(0, Math.ceil(a.hp))}/${a.maxHp}`;
    const sameRoom = a.pos.kind === 'room' && view.you.pos.kind === 'room' && a.pos.room === view.you.pos.room;
    if (a.extracted) status = `escaped at ${fmtTime(a.seenAt)}`;
    else if (a.live) status = (sameRoom ? 'with you' : 'in sight') + (a.heading !== null ? ` · → ${name(a.heading)}` : '');
    else {
      const where = a.heading !== null ? `heading to ${name(a.heading)}` : a.pos.kind === 'room' ? name(a.pos.room) : `heading to ${name(a.pos.to)}`;
      status = `last seen ${fmtTime(view.time - a.seenAt)} ago · ${where}`;
    }
    const aff = a.affliction ? ` <span class="aff" title="${escape(`${AFFLICTIONS[a.affliction].desc} ${AFFLICTION_RULES}`)}">${AFFLICTIONS[a.affliction].name}</span>` : '';
    return `<div class="ally ${a.live ? '' : 'ghost'}"><span style="color:${a.color}">■</span> ${escape(a.name)}${a.isBot ? ' <span class="muted">(bot)</span>' : ''}${aff}<div class="ally-status">${escape(status)}${hp}</div></div>`;
  });
  return rows.join('');
}

function locationText(view: PlayerView): string {
  const pos = view.you.pos;
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'the unknown';
  if (pos.kind === 'room') return name(pos.room);
  // Seconds left at your own pace (escorting a villager slows you down).
  const rate = view.leading ? EVENT_SEEDING.villagerSpeed : 1;
  return `Corridor → ${name(pos.to)} (${Math.max(0, Math.ceil((pos.dur - pos.t) / rate))}s)`;
}

/** What you'll do when your timer runs out (out of combat, standing in a room). */
function turnPlan(view: PlayerView): string {
  const you = view.you;
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'the unknown';
  if (you.queuedEvent) return 'then you start on the event';
  if (you.queuedSkill) {
    const { skill, target: t } = you.queuedSkill;
    const who = !t || !skillTargeted(skill) ? '' : t === you.id ? ' on yourself' : ` on ${view.allies.find((a) => a.id === t)?.name ?? 'them'}`;
    return `then you use ${FIELD_SKILLS[skill].name}${who}`;
  }
  const next = you.path[0];
  if (next === undefined) return 'pick a direction, or you wait a turn';
  const here = you.pos.kind === 'room' ? you.pos.room : -1;
  const rubble = view.corridors.some((c) => c.collapsed && ((c.a === here && c.b === next) || (c.b === here && c.a === next)));
  const dig = you.cls === 'undertaker' ? speedOf(you, view.time) : ESCALATION.digTime;
  return rubble ? `then you dig toward ${name(next)} (${fmtSpeed(dig)})` : `arriving in ${name(next)}`;
}

/**
 * The room one corridor away in a compass direction (WASD). From a corridor it's measured from the room
 * you're heading into, except that pressing back toward where you came from turns you around.
 */
export function roomInDir(view: PlayerView | null, dir: Dir): number | null {
  if (!view) return null;
  const pos = view.you.pos;
  const at = (id: number) => view.rooms.find((r) => r.id === id);
  if (pos.kind === 'corridor') {
    const to = at(pos.to);
    const from = at(pos.from);
    if (to && from && dirBetween(to, from) === dir) return pos.from;
  }
  const here = at(pos.kind === 'room' ? pos.room : pos.to);
  if (!here) return null;
  for (const c of view.corridors) {
    if (c.a !== here.id && c.b !== here.id) continue;
    const other = at(c.a === here.id ? c.b : c.a);
    if (other && dirBetween(here, other) === dir) return other.id;
  }
  return null;
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Each field skill: one button if untargeted (Toll, Flare), else one per person here it can go to. */
function renderSkills(view: PlayerView, free: boolean, here: number) {
  const box = $('skills');
  const you = view.you;
  const skills = fieldSkillsOf(you);
  if (!skills.length || !free) {
    box.hidden = true;
    return;
  }
  const near = view.allies.filter((a) => a.live && !a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
  let first = true;
  const html = skills.map((skill) => {
    const def = FIELD_SKILLS[skill];
    const wait = you.cooldowns[skill] ?? 0;
    const queued = you.queuedSkill?.skill === skill;
    type Option = { id: string | null; label: string };
    let options: Option[] = [{ id: null, label: def.name }];
    if (def.target !== 'none') {
      const others = skill === 'sins' ? near.filter((a) => (a.stress ?? 0) > 0) : skill === 'mend' ? near.filter((a) => a.hp < a.maxHp) : near;
      const label = (a: { name: string; stress?: number; hp: number; maxHp: number }) =>
        skill === 'sins' || skill === 'vigil' ? `${escape(a.name)} (${a.stress ?? 0}${icon('stress')})` : skill === 'mend' ? `${escape(a.name)} (${icon('hp')}${a.hp}/${a.maxHp})` : escape(a.name);
      options = others.map((a) => ({ id: a.id, label: `${def.name}: ${label(a)}` }));
      if (def.target === 'any') options.unshift({ id: you.id, label: `${def.name}: yourself${skill === 'vigil' ? ` (${Math.round(you.stress)}${icon('stress')})` : ''}` });
    }
    // Cooling down, the buttons all say the same thing: show just one.
    if (wait > 0) options = options.slice(0, 1);
    return options.map((o) => {
      // Labels are HTML (names escaped above).
      const text = wait > 0 ? `${def.name} ${cooldownIcon(0, wait)}` : queued && you.queuedSkill?.target === o.id ? `${o.label} (when your timer runs out)` : o.label;
      const key = first && wait <= 0 ? ' <kbd>M</kbd>' : '';
      if (wait <= 0) first = false;
      return `<button data-skill="${skill}" ${o.id ? `data-target="${o.id}"` : ''} class="${wait > 0 ? 'cooling' : ''}" title="${escape(def.desc)}">${text}${key}</button>`;
    }).join('');
  }).join('');
  box.hidden = html === '';
  setHtml(box, html);
}
