import { Hud } from './hud';
import { Net } from './net';
import { MapRenderer } from './render/map';

const net = new Net();
const map = new MapRenderer(document.getElementById('map') as HTMLCanvasElement, net);
const hud = new Hud(net);

function frame() {
  map.draw();
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev-only hook for automated playtesting from the browser console.
if (import.meta.env.DEV) (window as unknown as { __net: Net }).__net = net;
