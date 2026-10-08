import { AFFLICTIONS, BLEED_OUT, CLASSES, ESCALATION, EVENT_SEEDING, REVIVE_CHANNEL, TIER_TEXT, type PlayerView } from '@stcp/shared';
import { beep } from './sound';
import { juice } from './juice';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private lastTier = 0;
  private bannerTimer = 0;
  private persistentBanner = false;

  constructor(private net: Net) {
    $('btn-turn').addEventListener('click', () => net.intent({ type: 'turnBack' }));
    $('btn-lobby').addEventListener('click', () => net.send({ t: 'toLobby' }));
    $('btn-escape').addEventListener('click', () => net.intent({ type: 'extract' }));
    $('btn-mend').addEventListener('click', () => {
      const id = $('btn-mend').dataset.target;
      if (id && !$('btn-mend').classList.contains('cooling')) net.intent({ type: 'fieldMend', target: id });
    });
    $('btn-dig').addEventListener('click', () => {
      const c = Number($('btn-dig').dataset.corridor);
      if (!Number.isNaN(c)) net.intent({ type: 'dig', corridor: c });
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
      if (e.code === 'KeyD' && !$('btn-dig').hidden) $('btn-dig').click();
      if (e.code === 'KeyM' && !$('btn-mend').hidden) $('btn-mend').click();
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
      aff.title = def.desc;
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
    $('light-text').textContent = view.dim ? '(DIM)' : '';
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

    // Rubble in a tunnel leading out of your room.
    const free = !view.encounter && you.downedAt === null && !you.dead && !you.extracted && you.pos.kind === 'room';
    const rubble = free ? view.corridors.find((c) => c.collapsed && (c.a === here || c.b === here)) : undefined;
    const digBtn = $('btn-dig');
    digBtn.hidden = !rubble || !!you.channel;
    if (rubble) {
      const other = view.rooms.find((r) => r.id === (rubble.a === here ? rubble.b : rubble.a));
      digBtn.dataset.corridor = String(rubble.id);
      digBtn.innerHTML = `⛏ Dig toward ${escape(other?.name ?? 'the unknown')} (${you.cls === 'warden' ? ESCALATION.digTimeWarden : ESCALATION.digTime}s) <kbd>D</kbd>`;
    }

    // Lampbearer: mend the most hurt person here between fights.
    const mendBtn = $('btn-mend');
    const patients = you.cls === 'lampbearer' && free
      ? [
          { id: you.id, name: 'yourself', frac: you.hp / you.maxHp },
          ...view.allies
            .filter((a) => a.live && !a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here)
            .map((a) => ({ id: a.id, name: a.name, frac: a.hp / a.maxHp })),
        ].filter((p) => p.frac < 1).sort((a, b) => a.frac - b.frac)
      : [];
    mendBtn.hidden = patients.length === 0;
    if (patients.length) {
      const wait = Math.ceil(you.fieldMendAt - view.time);
      mendBtn.dataset.target = patients[0].id;
      mendBtn.classList.toggle('cooling', wait > 0);
      mendBtn.innerHTML = wait > 0 ? `✚ Mend ready in ${wait}s` : `✚ Mend ${escape(patients[0].name)} (+8) <kbd>M</kbd>`;
    }

    // Channel progress (reviving, digging)
    const ch = $('channel');
    ch.hidden = !you.channel || you.channel.kind === 'event'; // events show progress in their own panel
    if (you.channel && you.channel.kind !== 'event') {
      const left = Math.max(0, you.channel.until - view.time);
      ch.textContent = `${you.channel.kind === 'dig' ? 'Digging' : 'Reviving'}… ${left.toFixed(1)}s (move to cancel)`;
    }

    // The way out
    const esc = $('btn-escape');
    const atExit = free && here === view.exitRoom;
    esc.hidden = !atExit || !view.exitOpen;
    if (!esc.hidden) esc.innerHTML = `⚑ ESCAPE with ${you.gold} gold <kbd>E</kbd>`;
    $('roster').innerHTML = rosterHtml(view);
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
    const hp = a.extracted ? '' : a.dead ? ' · DEAD' : a.downed ? ' · DOWN' : ` · ${Math.max(0, Math.ceil(a.hp))}/${a.maxHp} HP`;
    const sameRoom = a.pos.kind === 'room' && view.you.pos.kind === 'room' && a.pos.room === view.you.pos.room;
    if (a.extracted) status = `escaped at ${fmtTime(a.seenAt)}`;
    else if (a.live) status = (sameRoom ? 'with you' : 'in sight') + (a.heading !== null ? ` · → ${name(a.heading)}` : '');
    else {
      const where = a.heading !== null ? `heading to ${name(a.heading)}` : a.pos.kind === 'room' ? name(a.pos.room) : `heading to ${name(a.pos.to)}`;
      status = `last seen ${fmtTime(view.time - a.seenAt)} ago · ${where}`;
    }
    status += hp;
    const aff = a.affliction ? ` <span class="aff" title="${escape(AFFLICTIONS[a.affliction].desc)}">${AFFLICTIONS[a.affliction].name}</span>` : '';
    return `<div class="ally ${a.live ? '' : 'ghost'}"><span style="color:${a.color}">■</span> ${escape(a.name)}${a.isBot ? ' <span class="muted">(bot)</span>' : ''}${aff}<div class="ally-status">${escape(status)}</div></div>`;
  });
  return rows.join('');
}

function locationText(view: PlayerView): string {
  const pos = view.you.pos;
  const name = (id: number) => view.rooms.find((r) => r.id === id)?.name ?? 'the unknown';
  if (pos.kind === 'room') return name(pos.room);
  return `Corridor → ${name(pos.to)}`;
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
