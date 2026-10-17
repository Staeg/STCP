import {
  DEATH_TIMER, escortSpeed, fmtSpeed, MIN_SPEED, speedOf, speedParts, dirBetween, type Dir, LIGHT_DIM, LIGHT_BRIGHT, lightStage, forgetChance, CLASSES, ESCALATION, EVENT_SEEDING, EMERGENCIES, KIND_NAMES,
  skillInfo, skillTargeted, stealthOf, CLASS_RULES, REVIVE_CHANNEL, ESCALATION_TEXT, MAX_ESCALATION, ESCALATION_INTERVAL, type PlayerView,
  INJURY_NAMES, VILLAGE_RULES, ITEMS, type Injury, CALL_RULES, RITES, CR_RULES, crUnitChance, ENEMIES, ROSTER_RULES, TIERS, type EnemyId,
} from '@stcp/shared';
import { beep } from './sound';
import { juice } from './juice';
import type { Net } from './net';
import { icon, ICON_TIPS, levelStars, type IconId } from './icons';
import { statusIcons } from './statuses';

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

/** Seconds until you can call for help again (0: now). The client's copy of the sim's `callReadyIn`. */
function callWait(you: PlayerView['you'], time: number): number {
  return you.calledAt === null ? 0 : Math.max(0, you.calledAt + CALL_RULES.cooldown - time);
}

/** Unplugged cord with a cross over it: shown in place of the ping while offline. */
const PLUG_OFF = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
  + '<path d="M5 1v3M9 1v3"/><rect x="3" y="4" width="8" height="5" rx="1"/><path d="M7 9v3q0 2 2 2h1"/>'
  + '<path d="M11 10l4 4M15 10l-4 4"/></svg>';

export class Hud {
  private lastEscalation = 0;
  private bannerTimer = 0;
  private persistentBanner = false;

  constructor(private net: Net) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.outerHTML = icon(el.dataset.icon as IconId);
    $('btn-turn').addEventListener('click', () => net.intent({ type: 'turnBack' }));
    $('btn-pause').addEventListener('click', () => net.intent({ type: 'pause' }));
    $('btn-escape').addEventListener('click', () => net.intent({ type: 'extract' }));
    $('btn-ready').addEventListener('click', () => net.intent({ type: 'ready' }));
    $('btn-call').addEventListener('click', () => net.intent({ type: 'call' }));
    $('btn-reveal').addEventListener('click', () => net.intent({ type: 'revealMap' }));
    $('btn-kill-bots').addEventListener('click', () => {
      if (confirm('Kill all three bots now? The run ends at once.')) net.intent({ type: 'killBots' });
    });
    $('btn-revive').addEventListener('click', () => {
      const id = $('btn-revive').dataset.target;
      if (id) net.intent({ type: 'revive', target: id });
    });
    addEventListener('keydown', (e) => {
      if (!net.cur || (e.target as HTMLElement).tagName === 'INPUT') return;
      // Space pauses, alone with three bots, in a fight or out (and never presses a focused button).
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && (net.cur.canPause || net.cur.paused)) net.intent({ type: 'pause' });
        return;
      }
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
      if (e.code === 'KeyX') {
        net.intent({ type: 'turnBack' });
      } else if (e.code === 'Escape') {
        net.intent({ type: 'stop' });
      }
    });
  }

  update() {
    const net = this.net;
    const netEl = $('net');
    if (net.status === 'open') {
      netEl.textContent = `${net.ping} ms`;
      netEl.title = 'Connected · ping';
    } else if (!netEl.querySelector('svg')) {
      netEl.innerHTML = PLUG_OFF;
    }
    if (net.status !== 'open') netEl.title = net.status === 'connecting' ? 'Connecting…' : 'Disconnected — retrying';
    netEl.classList.toggle('bad', net.status !== 'open');

    const view = net.cur;
    if (!view) return;
    // Smooth the clock between 10 Hz snapshots.
    const time = view.phase === 'running' && !view.paused ? view.time + Math.min(0.1, (performance.now() - net.curAt) / 1000) : view.time;

    $('clock').textContent = fmtTime(time);
    setHtml($('escalation'), escalationHtml(view.escalation) + ` <span class="cr-tag" title="${rosterTitle(view)}">· CR ${view.cr}</span>`);
    const next = $('next-event');
    const here = view.you.pos.kind === 'room' ? view.you.pos.room : -1;
    if (time < view.wavesAt) {
      next.textContent = `Waves in ${fmtTime(view.wavesAt - time)}`;
    } else {
      next.textContent = `WAVES · collapse in ${fmtTime(view.collapseAt - time)}`;
    }
    $('clock').classList.toggle('urgent', time >= view.wavesAt);

    const you = view.you;
    const cls = CLASSES[you.cls];
    const stars = levelStars(you.level);
    // Village Rites for this run: the Resource's glyph, hover for what it does.
    const rites = (you.rites ?? []).map((r) => ` <span class="rite-tag" title="${escape(`${RITES[r].name}: ${RITES[r].desc}`)}">${ITEMS[r].glyph}</span>`).join('');
    // Every buff and debuff on you, right of your class, in a fight or out (hover for what each does). Anima and Sneak too.
    const status = [
      ...(you.anima > 0 ? [`<span title="${escape(`Anima ${you.anima}: each is ${-CLASS_RULES.animaSpeed}s off your Speed; your cards spend it for their Anima bonus.`)}">✧${you.anima}</span>`] : []),
      ...(you.legion.some((r) => r.decay !== undefined) ? [`<span title="${escape(`Your undead (they decay after every fight: +${CLASS_RULES.decaySpeed}s Speed, −${CLASS_RULES.decayBlock} Block a stack): ${you.legion.filter((r) => r.decay !== undefined).map((r) => `${r.type ? ENEMIES[r.type].name : '?'} ${r.hp}/${r.maxHp} HP, decay ${r.decay}`).join('; ')}.`)}">☠${you.legion.filter((r) => r.decay !== undefined).length}</span>`] : []),
      ...(you.sneaking ? [`<span title="${escape(`Sneaking: Speed ×${CLASS_RULES.sneakSpeedMult}; Stealth ${stealthOf(you).toFixed(1)} (your light ÷ ${CLASS_RULES.stealthPerLight}).`)}">👣</span>`] : []),
      ...statusIcons(you.st, time),
    ].join('');
    setHtml($('hero-name'), `<span style="color:${you.color}">■</span> ${escape(you.name)}${stars}${rites} <span style="color:var(--muted)">· ${cls.name}</span>${status ? ` <span class="hero-status">${status}</span>` : ''}`);

    // Injuries beside your HP: a small drop for each Minor, a small and a big one for each Major.
    setHtml($('injuries'), injuriesHtml([...you.injuries, ...(you.runInjuries ?? [])]));
    const escort = $('escort');
    const led = view.leading;
    escort.hidden = !led.length;
    if (led.length) {
      const slow = led.length * escortSpeed(you);
      const who = led.length > 1 ? `${led.length} villagers` : 'a villager';
      escort.textContent = `☺ Escorting ${who} (${led.map((v) => `${v.hp}/${v.maxHp}`).join(', ')}) → rendezvous · Speed ${slow < 0 ? '−' : '+'}${fmtSpeed(Math.abs(slow))}`;
    }
    $('autopilot').hidden = !you.autopilot;
    const pause = $('btn-pause');
    pause.hidden = !view.canPause;
    setHtml(pause, view.paused ? '▶ Carry on <kbd>Space</kbd>' : '⏸ Pause <kbd>Space</kbd>');
    $('paused').hidden = !view.paused;
    const { altars, villagers } = view.objectives;
    const bonus = altars * EVENT_SEEDING.altarBonus + villagers * EVENT_SEEDING.villagerBonus;
    const em = view.emergency;
    const emText = em
      ? `⚑ ${EMERGENCIES[em.id].name}: ${em.impossible ?? em.parts.map((p) => `${Math.min(p.have, p.need)}/${p.need} ${p.label}`).join(' · ')}${em.done ? ' ✓' : ''}`
      : '';
    $('objectives').textContent = [altars || villagers ? `⛧ ${altars} cleansed · ☺ ${villagers} saved · +${bonus} gold on escape` : '', emText].filter(Boolean).join('  |  ');
    $('objectives').title = em ? `${EMERGENCIES[em.id].desc} (${KIND_NAMES[EMERGENCIES[em.id].kind]})` : '';
    $('hp-text').textContent = `${Math.max(0, Math.ceil(you.hp))}/${you.maxHp}`;
    $('hp-fill').style.width = `${(Math.max(0, you.hp) / you.maxHp) * 100}%`;
    // Light: the number, its stage (Bright, Dim, Dark; nothing for plain Lit), and hover for what it does to you now.
    const stage = lightStage(you.light);
    const forget = Math.round(forgetChance(you.light) * 100);
    setHtml($('light-text'), `${Math.round(you.light)}${stage === 'lit' ? '' : ` <span class="light-stage ${stage}">${stage.toUpperCase()}</span>`}`);
    $('light-text').title = {
      bright: `Bright (light above ${LIGHT_BRIGHT}): you forget nothing.`,
      lit: `Lit: each path that drops out of your sight is forgotten ${forget}% of the time (1% for every point of light below ${LIGHT_BRIGHT}).`,
      dim: `Dim (light under ${LIGHT_DIM}): you can't see into neighbouring rooms, and forget each path that drops out of sight ${forget}% of the time.`,
      dark: `Darkness: monsters hit you 25% harder, you can't see next door, and you forget each path that drops out of sight ${forget}% of the time.`,
    }[stage];
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
    fill.classList.toggle('bright', stage === 'bright');

    $('btn-turn').hidden = you.pos.kind !== 'corridor' || you.downedAt !== null || you.dead;

    // E: ready to leave. It can be set anywhere; at the exit it shows who you're waiting on.
    const ready = $('btn-ready');
    ready.hidden = you.dead || you.extracted || view.phase !== 'running';
    ready.classList.toggle('on', you.ready);
    let readyText = you.ready ? '✔ Ready to leave' : '⚑ Ready to leave';
    if (you.ready && here === view.exitRoom) {
      const others = view.allies.filter((a) => a.live && !a.dead && !a.extracted && a.pos.kind === 'room' && a.pos.room === here);
      const waiting = others.filter((a) => a.downed || !a.ready).map((a) => (a.downed ? `${a.name} (down)` : a.name));
      readyText += view.encounter ? ' · after the fight' : waiting.length ? ` · waiting for ${waiting.join(', ')}` : '';
    } else if (you.ready) readyText += ' · at the exit';
    setHtml(ready, `${readyText} <kbd>E</kbd>`);
    ready.title = 'Ready to leave: if everyone standing in the exit room is ready (and nobody is fighting or down there), you all escape together. Alone and ready, you escape as soon as you get there. F still leaves on your own.';

    // C: call for help, then wait out the cooldown.
    const call = $('btn-call');
    const callIn = callWait(you, time);
    call.hidden = you.dead || you.extracted || view.phase !== 'running';
    (call as HTMLButtonElement).disabled = callIn > 0;
    setHtml(call, `📣 Call for Help ${callIn > 0 ? `${Math.ceil(callIn)}s` : '<kbd>C</kbd>'}`);
    call.title = `Even while down, once every ${CALL_RULES.cooldown}s: every ally may hear where you are (${Math.round(CALL_RULES.falloff * 100)}% less likely per tunnel away). `
      + `So will the dungeon: monsters for this Escalation appear up to ${CALL_RULES.spawnWithin} rooms away and come straight here.`;

    // Out of a bots-only run (escaped or dead): see the whole map now, or end it by killing the bots.
    const reveal = $('btn-reveal');
    reveal.hidden = !view.soloOut || view.mapRevealed;
    reveal.title = 'Lift the fog: see every room and tunnel, and what is in them, while the bots play on.';
    const kill = $('btn-kill-bots');
    kill.hidden = !view.soloOut;
    kill.title = 'The bots die where they stand and the run ends now. Whatever they carry is lost.';

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
    esc.hidden = !atExit;
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
      const left = Math.max(0, DEATH_TIMER - (view.time - you.downedAt));
      this.showBanner(`YOU ARE DOWN<br><span style="font-size:24px">Dying in ${Math.ceil(left)}s — an ally must reach you.${callWait(you, view.time) > 0 ? '' : ' <kbd>C</kbd> to call for help.'}</span>`, 0);
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
  return `Challenge Rating ${view.cr}: rolled from the heroes' levels, Gear and Rites. More gold, and worse things in the dark.\n\nThis run's monsters: ${main.join(' · ')}.\nCR units: ${cr.join(' · ')}.`;
}

function rosterHtml(view: PlayerView): string {
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'somewhere unknown';
  const rows = view.allies.map((a) => {
    let status: string;
    const hp = a.extracted ? '' : a.dead ? ' · DEAD' : a.downed ? ' · DOWN'
      : ` · ${icon('hp')}${Math.max(0, Math.ceil(a.hp))}/${a.maxHp}${a.light !== undefined ? ` · ${icon('light')}${a.light}` : ''}`;
    const sameRoom = a.pos.kind === 'room' && view.you.pos.kind === 'room' && a.pos.room === view.you.pos.room;
    if (a.extracted) status = `escaped at ${fmtTime(a.seenAt)}`;
    // Watching a revealed map from outside: where they are, not whether you can see them.
    else if (a.live && (view.you.extracted || view.you.dead)) {
      const next = a.pos.kind === 'room' ? null : a.pos.to;
      status = (a.pos.kind === 'room' ? name(a.pos.room) : `tunnel to ${name(a.pos.to)}`)
        + (a.heading !== null && a.heading !== next ? ` · → ${name(a.heading)}` : '');
    } else if (a.live) status = (sameRoom ? 'with you' : 'in sight') + (a.heading !== null ? ` · → ${name(a.heading)}` : '');
    else {
      const where = a.heading !== null ? `heading to ${name(a.heading)}` : a.pos.kind === 'room' ? name(a.pos.room) : `heading to ${name(a.pos.to)}`;
      status = `last seen ${fmtTime(view.time - a.seenAt)} ago · ${where}`;
    }
    const ready = a.live && a.ready ? ' <span class="ready-tag" title="Ready to leave (E)">⚑ ready</span>' : '';
    return `<div class="ally ${a.live ? '' : 'ghost'}"><span style="color:${a.color}">■</span> ${escape(a.name)}${a.isBot ? ' <span class="muted">(bot)</span>' : ''}${ready}<div class="ally-status">${escape(status)}${hp}</div></div>`;
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
  const here = you.pos.kind === 'room' ? you.pos.room : -1;
  if (next === undefined) {
    return you.unnoticedIn === here && here >= 0
      ? "unnoticed by the monsters here: slip on, or turn Sneak off and they're on you"
      : 'pick a direction, or you wait a turn';
  }
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
  const tip = `${lines} They last until an Elder in the Village heals them.`;
  const drops = injuries.map((i) => (i === 'major' ? DROP(false) + DROP(true) : DROP(false))).join('');
  return `<span class="injury-drops" title="${escape(tip)}">${drops}</span>`;
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
