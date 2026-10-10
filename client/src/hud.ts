import {
  AFFLICTION_RULES, AFFLICTIONS, BLEED_OUT, escortSpeed, fmtSpeed, MIN_SPEED, speedOf, speedParts, dirBetween, type Dir, LIGHT_DIM, STRESS, CLASSES, ESCALATION, EVENT_SEEDING,
  fieldSkillsOf, skillInfo, TALENTS, skillTarget, skillTargeted, REVIVE_CHANNEL, type FieldSkill, ESCALATION_TEXT, MAX_ESCALATION, ESCALATION_INTERVAL, type PlayerView,
  INJURY_NAMES, VILLAGE_RULES, ITEMS, type Injury, CALL_RULES, RITES, CR_RULES, crUnitChance, ENEMIES, ROSTER_RULES, TIERS, type EnemyId,
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
  private lastEscalation = 0;
  private bannerTimer = 0;
  private persistentBanner = false;

  constructor(private net: Net) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.outerHTML = icon(el.dataset.icon as IconId);
    $('btn-turn').addEventListener('click', () => net.intent({ type: 'turnBack' }));
    $('btn-escape').addEventListener('click', () => net.intent({ type: 'extract' }));
    $('btn-ready').addEventListener('click', () => net.intent({ type: 'ready' }));
    $('btn-call').addEventListener('click', () => net.intent({ type: 'call' }));
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
      // E (ready to leave), O (autopilot) and C (call for help) work in a fight too, and C even while down.
      if (e.code === 'KeyE' && !e.repeat) net.intent({ type: 'ready' });
      if (e.code === 'KeyC' && !e.repeat) net.intent({ type: 'call' });
      if (e.code === 'KeyO' && !e.repeat) net.intent({ type: 'autopilot' });
      if (net.cur.encounter) return; // combat has its own keys
      if (e.code === 'KeyR') $('btn-revive').click();
      // F: flee in a fight (combat.ts), get out through the exit here.
      if (e.code === 'KeyF' && !$('btn-escape').hidden) $('btn-escape').click();
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
    setHtml($('escalation'), escalationHtml(view.escalation) + ` <span class="cr-tag" title="${rosterTitle(view)}">· CR ${view.cr}</span>`);
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
    const talent = you.talent ? ` <span class="talent-star" title="${escape(TALENTS[you.talent].name)}: ${escape(TALENTS[you.talent].desc)}">★</span>` : '';
    // Village Rites for this run: the Resource's glyph, hover for what it does.
    const rites = (you.rites ?? []).map((r) => ` <span class="rite-tag" title="${escape(`${RITES[r].name}: ${RITES[r].desc}`)}">${ITEMS[r].glyph}</span>`).join('');
    $('hero-name').innerHTML = `<span style="color:${you.color}">■</span> ${escape(you.name)}${talent}${rites} <span style="color:var(--muted)">· ${cls.name}</span>`;
    // A screaming face beside your stress when something has broken; hover for which affliction and what it does.
    const aff = $('affliction');
    aff.hidden = !you.affliction;
    if (you.affliction) {
      const def = AFFLICTIONS[you.affliction];
      aff.title = `${def.name}: ${def.desc} ${AFFLICTION_RULES}`;
    }
    // Injuries beside your HP: a small drop for each Minor, a small and a big one for each Major.
    setHtml($('injuries'), injuriesHtml([...you.injuries, ...(you.runInjuries ?? [])]));
    const escort = $('escort');
    escort.hidden = !view.leading;
    if (view.leading) escort.textContent = `☺ Escorting a villager (${view.leading.hp}/${view.leading.maxHp}) → rendezvous · Speed ${escortSpeed(you) < 0 ? '−' : '+'}${fmtSpeed(Math.abs(escortSpeed(you)))}`;
    $('autopilot').hidden = !you.autopilot;
    const { altars, villagers } = view.objectives;
    const bonus = altars * EVENT_SEEDING.altarBonus + villagers * EVENT_SEEDING.villagerBonus;
    $('objectives').textContent = altars || villagers ? `⛧ ${altars} cleansed · ☺ ${villagers} saved · +${bonus} gold on escape` : '';
    $('hp-text').textContent = `${Math.max(0, Math.ceil(you.hp))}/${you.maxHp}`;
    $('hp-fill').style.width = `${(Math.max(0, you.hp) / you.maxHp) * 100}%`;
    $('stress-text').textContent = `${Math.round(you.stress)}`;
    $('stress-fill').style.width = `${Math.min(100, you.stress)}%`;
    $('light-text').textContent = view.dim ? (you.light <= 0 ? '(DARK)' : '(DIM)') : '';
    $('light-text').title = you.light <= 0
      ? `Darkness: +${STRESS.darkPerSec} stress per second, and monsters hit you 25% harder.`
      : `Dim (light under ${LIGHT_DIM}): +${STRESS.dimPerSec} stress per second, and you can't see into neighbouring rooms.`;
    $('stress-text').title = `The dungeon wears on you: +${STRESS.basePerSec} stress per second, more while Dim or dark, in fights and from what you see. At 100 something breaks.`;
    // Speed: seconds per turn in a fight and per tunnel. Hover for what's making it up.
    const speed = speedOf(you, view.time);
    $('speed-text').textContent = fmtSpeed(speed);
    $('speed-line').title = `${ICON_TIPS.speed}
`
      + speedParts(you, view.time).map((p, i) => `${i === 0 ? '' : p.amount < 0 ? '− ' : '+ '}${fmtSpeed(Math.abs(p.amount))} ${p.label}`).join(' ')
      + ` = ${fmtSpeed(speed)}${speedParts(you, view.time).reduce((t, p) => t + p.amount, 0) < MIN_SPEED ? ` (never below ${fmtSpeed(MIN_SPEED)})` : ''}`;
    const fill = $('light-fill');
    fill.style.width = `${you.light}%`;
    fill.classList.toggle('dim', view.dim);

    $('btn-turn').hidden = you.pos.kind !== 'corridor' || you.downedAt !== null || you.dead;

    // E: ready to leave. It can be set anywhere; at the open exit it shows who you're waiting on.
    const ready = $('btn-ready');
    ready.hidden = you.dead || you.extracted || view.phase !== 'running';
    ready.classList.toggle('on', you.ready);
    let readyText = you.ready ? '✔ Ready to leave' : '⚑ Ready to leave';
    if (you.ready && here === view.exitRoom) {
      const others = view.allies.filter((a) => a.live && !a.dead && !a.extracted && a.pos.kind === 'room' && a.pos.room === here);
      const waiting = others.filter((a) => a.downed || !a.ready).map((a) => (a.downed ? `${a.name} (down)` : a.name));
      readyText += !view.exitOpen ? ' · exit opens soon' : view.encounter ? ' · after the fight' : waiting.length ? ` · waiting for ${waiting.join(', ')}` : '';
    } else if (you.ready) readyText += ' · at the exit';
    setHtml(ready, `${readyText} <kbd>E</kbd>`);
    ready.title = 'Ready to leave: once the exit is open, if everyone standing in the exit room is ready (and nobody is fighting or down there), you all escape together. Alone and ready, you escape as soon as you get there. F still leaves on your own.';

    // C: call for help, once per run.
    const call = $('btn-call');
    call.hidden = you.dead || you.extracted || you.called || view.phase !== 'running';
    setHtml(call, `📣 Call for Help <kbd>C</kbd>`);
    call.title = `Once per run, even while down: every ally may hear where you are (${Math.round(CALL_RULES.falloff * 100)}% less likely per tunnel away). `
      + `So will the dungeon: monsters for this Escalation appear up to ${CALL_RULES.spawnWithin} rooms away and come straight here.`;

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
    if (!esc.hidden) esc.innerHTML = `⚑ ESCAPE ALONE with ${you.gold} gold <kbd>F</kbd>`;
    setHtml($('roster'), rosterHtml(view));

    // Escalation-change banner
    if (view.escalation > this.lastEscalation) {
      this.lastEscalation = view.escalation;
      this.showBanner(`Escalation ${view.escalation}<br><span class="banner-sub">${ESCALATION_TEXT[view.escalation] ?? ''}</span>`, 8000, 'escalation-up');
      beep(view.escalation >= 5 ? 'alarm' : 'escalate');
      juice(view.escalation >= 5 ? 'alarm' : 'escalate');
    }
    this.lastEscalation = view.escalation;
    if (view.phase !== 'running') $('banner').hidden = true; // the results screen takes over
    else if (you.extracted) this.showBanner(`YOU ESCAPED<br><span style="font-size:24px">with ${you.gold} gold. The others are still inside…</span>`, 0);
    else if (you.dead) this.showBanner('YOU HAVE DIED<br><span style="font-size:24px">Your allies fight on without you.</span>', 0);
    else if (you.downedAt !== null && !view.encounter) {
      const left = Math.max(0, BLEED_OUT - (view.time - you.downedAt));
      this.showBanner(`YOU ARE DOWN<br><span style="font-size:24px">Bleeding out in ${Math.ceil(left)}s — an ally must reach you.${you.called ? '' : ' <kbd>C</kbd> to call for help.'}</span>`, 0);
    } else if (this.persistentBanner) {
      $('banner').hidden = true;
    }
    this.persistentBanner = view.phase !== 'running' || you.dead || you.extracted || (you.downedAt !== null && !view.encounter);
  }

  /** Called when leaving the game view (back to lobby). */
  reset() {
    this.lastEscalation = 0;
    $('banner').hidden = true;
  }

  /** `cls` styles one kind of banner (Escalation-ups sit higher up, clear of the map around you). */
  private showBanner(html: string, ms: number, cls = '') {
    const b = $('banner');
    b.innerHTML = html;
    b.className = cls;
    b.hidden = false;
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (b.hidden = true), ms);
  }
}

/** "Escalation N", with what every Escalation so far has done on hover. */
function escalationHtml(esc: number): string {
  const lines = [];
  for (let t = 1; t <= esc; t++) lines.push(`<div><b>Escalation ${t}</b>: ${ESCALATION_TEXT[t] ?? ''}</div>`);
  const next = esc < MAX_ESCALATION ? `<div class="muted">Escalation ${esc + 1} comes at ${fmtTime((esc + 1) * ESCALATION_INTERVAL)}.</div>` : '';
  return `Escalation ${esc}<div class="hover-tip">${lines.join('') || '<div>Nothing has stirred yet.</div>'}${next}</div>`;
}

/** Hover text for the CR tag: the run's monsters, by tier, and its CR units' chances now. */
function rosterTitle(view: PlayerView): string {
  const r = view.roster;
  const name = (u: EnemyId) => ENEMIES[u].name;
  const main = TIERS.filter((t) => r.main[t].length).map((t) => `T${t} ${r.main[t].map(name).join(', ')}${ROSTER_RULES.escalation[t] > 0 ? ` (from Escalation ${ROSTER_RULES.escalation[t]})` : ''}`);
  const cr = TIERS.flatMap((t) => {
    const u = r.cr[t];
    return u ? [`T${t} ${name(u)}: ${crUnitChance(t, view.cr) > 0 ? `${Math.round(crUnitChance(t, view.cr) * 100)}% per group` : `from CR ${CR_RULES.units[t].from}`}`] : [];
  });
  return `Challenge Rating ${view.cr}: rolled from the heroes' Talents, Gear and Rites. More gold, and worse things in the dark.\n\nThis run's monsters: ${main.join(' · ')}.\nCR units: ${cr.join(' · ')}.`;
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
    const aff = a.affliction ? ` <span class="aff" title="${escape(`${AFFLICTIONS[a.affliction].name}: ${AFFLICTIONS[a.affliction].desc} ${AFFLICTION_RULES}`)}">😱</span>` : '';
    const ready = a.live && a.ready ? ' <span class="ready-tag" title="Ready to leave (E)">⚑ ready</span>' : '';
    return `<div class="ally ${a.live ? '' : 'ghost'}"><span style="color:${a.color}">■</span> ${escape(a.name)}${a.isBot ? ' <span class="muted">(bot)</span>' : ''}${aff}${ready}<div class="ally-status">${escape(status)}${hp}</div></div>`;
  });
  return rows.join('');
}

/** What you'll do when your timer runs out (out of combat, standing in a room). */
function turnPlan(view: PlayerView): string {
  const you = view.you;
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'the unknown';
  if (you.queuedEvent) return 'then you start on the event';
  if (you.queuedItem) return `then you use the ${ITEMS[you.queuedItem.item].name}`;
  if (you.queuedSkill) {
    const { skill, target: t } = you.queuedSkill;
    const who = !t || !skillTargeted(you, skill) ? '' : t === you.id ? ' on yourself' : ` on ${view.allies.find((a) => a.id === t)?.name ?? 'them'}`;
    return `then you use ${skillInfo(you, skill).name}${who}`;
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

const DROP_ROWS = ['..r..', '..r..', '.rrr.', 'rrrrr', 'rwrrr', 'rwrrR', '.rRR.'];
const DROP_SVG = `<svg viewBox="0 0 5 7" shape-rendering="crispEdges" aria-hidden="true">${DROP_ROWS.map((row, y) => [...row].map((c, x) =>
  c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === 'w' ? '#f0a0a0' : c === 'R' ? '#8a2a2a' : '#d94a4a'}"/>`).join('')).join('')}</svg>`;
const DROP = (big: boolean) => `<span class="drop ${big ? 'big' : ''}">${DROP_SVG}</span>`;

/** Small drop per Minor Injury, small + big per Major; hover lists them and what they cost. */
function injuriesHtml(injuries: Injury[]): string {
  if (!injuries.length) return '';
  const minor = injuries.filter((i) => i === 'minor').length;
  const major = injuries.length - minor;
  const lines = [
    minor && `${minor > 1 ? `${minor}× ` : ''}${INJURY_NAMES.minor}: −${VILLAGE_RULES.minorHpLoss * 100}% max HP${minor > 1 ? ' each' : ''}.`,
    major && `${major > 1 ? `${major}× ` : ''}${INJURY_NAMES.major}: −${VILLAGE_RULES.majorHpLoss * 100}% max HP and Speed +${fmtSpeed(VILLAGE_RULES.majorSpeed)}${major > 1 ? ' each' : ''}.`,
  ].filter(Boolean).join(' ');
  const tip = `${lines} They last until treated in the Village.`;
  const drops = injuries.map((i) => (i === 'major' ? DROP(false) + DROP(true) : DROP(false))).join('');
  return `<span class="injury-drops" title="${escape(tip)}">${drops}</span>`;
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
    const def = { ...skillInfo(you, skill), target: skillTarget(you, skill) };
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
