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
    addEventListener('keydown', (e) => {
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

    // Tier-change banner
    if (view.tier > this.lastTier) {
      this.lastTier = view.tier;
      this.showBanner(`The dungeon stirs…<br><span style="font-size:28px">Tier ${view.tier}</span>`, 2500);
    }
    this.lastTier = view.tier;
    if (view.phase === 'collapsed') this.showBanner('THE DUNGEON COLLAPSES', 0);
  }

  private showBanner(html: string, ms: number) {
    const b = $('banner');
    b.innerHTML = html;
    b.hidden = false;
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (b.hidden = true), ms);
  }
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
