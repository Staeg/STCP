/** Screen feedback: shakes and colour flashes. Purely cosmetic. */
type Kind = 'shake' | 'hurt' | 'escalate' | 'alarm';

export function juice(kind: Kind) {
  if (kind === 'shake') {
    restart(document.getElementById('combat'), 'shake');
    restart(document.getElementById('map'), 'shake');
    return;
  }
  const flash = document.getElementById('flash');
  if (!flash) return;
  flash.className = '';
  restart(flash, kind);
}

/** Re-trigger a CSS animation class even if it's already applied. */
function restart(el: HTMLElement | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 700);
}
