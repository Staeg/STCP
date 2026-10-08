import { CLASSES, type PlayerView } from '@stcp/shared';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private lastTier = 0;
  private bannerTimer = 0;

  constructor(private net: Net) {
    $('btn-turn').addEventListener('click', () => net.intent({ type: 'turnBack' }));
    $('btn-lobby').addEventListener('click', () => net.send({ t: 'toLobby' }));
    addEventListener('keydown', (e) => {
      if (!net.cur || (e.target as HTMLElement).tagName === 'INPUT') return;
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
    if (time < view.exitOpensAt) {
      next.textContent = `Exit opens in ${fmtTime(view.exitOpensAt - time)}`;
    } else {
      next.textContent = `EXIT OPEN · collapse in ${fmtTime(view.collapseAt - time)}`;
    }
    $('clock').classList.toggle('urgent', time >= view.exitOpensAt);

    const you = view.you;
    const cls = CLASSES[you.cls];
    $('hero-name').innerHTML = `<span style="color:${you.color}">■</span> ${escape(you.name)} <span style="color:var(--muted)">· ${cls.name}</span>`;
    $('light-text').textContent = view.dim ? '(DIM)' : '';
    const fill = $('light-fill');
    fill.style.width = `${you.light}%`;
    fill.classList.toggle('dim', view.dim);
    $('location').textContent = locationText(view);

    $('btn-turn').hidden = you.pos.kind !== 'corridor';
    $('roster').innerHTML = rosterHtml(view);
    const isHost = net.lobby?.hostId === net.lobby?.youId;
    $('btn-lobby').hidden = !(view.phase !== 'running' && isHost);

    // Tier-change banner
    if (view.tier > this.lastTier) {
      this.lastTier = view.tier;
      this.showBanner(`The dungeon stirs…<br><span style="font-size:28px">Tier ${view.tier}</span>`, 2500);
    }
    this.lastTier = view.tier;
    if (view.phase === 'collapsed') this.showBanner('THE DUNGEON COLLAPSES', 0);
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
    const sameRoom = a.pos.kind === 'room' && view.you.pos.kind === 'room' && a.pos.room === view.you.pos.room;
    if (a.live) status = sameRoom ? 'with you' : 'in sight';
    else {
      const where = a.pos.kind === 'room' ? name(a.pos.room) : `heading to ${name(a.pos.to)}`;
      status = `last seen ${fmtTime(view.time - a.seenAt)} ago · ${where}`;
    }
    return `<div class="ally ${a.live ? '' : 'ghost'}"><span style="color:${a.color}">■</span> ${escape(a.name)}${a.isBot ? ' <span class="muted">(bot)</span>' : ''}<div class="ally-status">${escape(status)}</div></div>`;
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
