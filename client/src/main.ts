import { Hud } from './hud';
import { Net } from './net';
import { MapRenderer } from './render/map';
import { Screens } from './screens';

const net = new Net();
const map = new MapRenderer(document.getElementById('map') as HTMLCanvasElement, net);
const hud = new Hud(net);
const screens = new Screens(net);

// Lobby links: ?lobby=CODE joins automatically, and the URL tracks the lobby you're in so refresh/share works.
const urlCode = new URLSearchParams(location.search).get('lobby');
let triedUrlJoin = false;
net.onLobby = (lobby) => {
  if (lobby) {
    history.replaceState(null, '', `?lobby=${lobby.code}`);
  } else if (urlCode && !triedUrlJoin) {
    triedUrlJoin = true;
    net.send({ t: 'join', code: urlCode });
  }
};

const toast = document.getElementById('toast')!;
let toastTimer = 0;
net.onError = (msg) => {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 3500);
};

const gameUi = ['hud', 'actions', 'help'].map((id) => document.getElementById(id)!);
let inGame = false;

function frame() {
  const covered = screens.update();
  if (covered && inGame) hud.reset();
  inGame = !covered;
  for (const el of gameUi) el.hidden = covered;
  map.draw();
  if (!covered) hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev-only hook for automated playtesting from the browser console.
if (import.meta.env.DEV) (window as unknown as { __net: Net }).__net = net;
