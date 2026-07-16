import { touchInput } from './input.js';

// Mobile: two virtual joysticks (Mode-2 drone layout — left stick climb/yaw,
// right stick pitch/roll) plus small pause/reset buttons. Only mounts on
// coarse-pointer devices; visibility is CSS-driven (body.touch.in-game).
export function isTouch() {
  return document.body.classList.contains('touch');
}

export function createTouchControls() {
  const touchCapable = window.matchMedia('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0
    || new URLSearchParams(location.search).has('touch'); // dev: force on desktop
  if (!touchCapable) return;
  document.body.classList.add('touch');

  const TRAVEL = 40; // px of nub travel = full deflection

  function makeStick(id, onMove) {
    const el = document.getElementById(id);
    const nub = el.querySelector('.nub');
    let pid = null;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const c = Math.min(d, TRAVEL);
      dx = (dx / d) * c;
      dy = (dy / d) * c;
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / TRAVEL, dy / TRAVEL);
    };
    el.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      el.setPointerCapture(pid);
      move(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === pid) move(e);
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      nub.style.transform = '';
      onMove(0, 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  makeStick('stick-left', (x, y) => {
    touchInput.yaw = -x;   // drag left = turn left
    touchInput.climb = -y; // drag up = climb
  });
  makeStick('stick-right', (x, y) => {
    touchInput.roll = x;
    touchInput.pitch = -y; // drag up = fly forward
  });

  // Pause routes through the same ESC path the keyboard uses.
  document.getElementById('tb-pause').addEventListener('click', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  });
  document.getElementById('tb-reset').addEventListener('click', () => {
    touchInput.reset = true;
    setTimeout(() => { touchInput.reset = false; }, 120);
  });
}

// Best-effort landscape: needs fullscreen first, and iOS ignores the lock
// entirely (the portrait overlay covers that case).
import { fullscreenSupported, enterFullscreen } from './fullscreen.js';

export function lockLandscape() {
  if (!fullscreenSupported) return; // iPhone: nothing to do
  enterFullscreen()
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}
