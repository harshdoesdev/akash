// Screen system: plain DOM sections crossfaded over the live canvas.
// States: menu | playing | paused | settings. The world always renders —
// the main menu's "art" is the game itself under a slow cinematic camera.
import { isTouch, lockLandscape } from './touchControls.js';
import { pushProfile } from './session.js';
import {
  fullscreenSupported, fullscreenActive, enterFullscreen, exitFullscreen,
  onFullscreenChange,
} from './fullscreen.js';

// Soft hand-paint pilot palette; the first entry is the stock cream body.
export const PILOT_COLORS = [
  '#f2ead8', '#8fd0ff', '#a8d977', '#f2a06b', '#b9a8e8', '#f2a0b4', '#f2d878',
];

export function createUI({ audio, seedStr, multiplayer, drone }) {
  const screens = {};
  for (const el of document.querySelectorAll('.screen')) {
    screens[el.dataset.screen] = el;
  }

  const api = {
    state: 'menu',
    cameraMode: 'cinematic', // 'chase' whenever the session is in-flight
  };
  let settingsReturn = 'menu'; // where Back goes

  function show(name) {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('active', key === name);
    }
  }

  function setState(state) {
    api.state = state;
    const inFlight = state === 'playing' || state === 'paused'
      || (state === 'settings' && settingsReturn === 'paused');
    api.cameraMode = inFlight ? 'chase' : 'cinematic';
    document.body.classList.toggle('in-game', state === 'playing');
    if (state === 'playing') show('none');
    else show(state);
  }

  // World-code row: enter any code to fly (and share) that world. Applying
  // a new code saves it and reloads — the world builds once at boot, and
  // the boot screen covers the rebuild.
  const worldEl = document.getElementById('world-code');
  const fitWorldEl = () => {
    worldEl.style.width = `${Math.max(4, worldEl.value.length || 4) + 1}ch`;
  };
  worldEl.value = seedStr;
  fitWorldEl();
  worldEl.addEventListener('input', fitWorldEl);
  // Enter commits (below); wandering off just puts the current code back.
  worldEl.addEventListener('blur', () => { worldEl.value = seedStr; fitWorldEl(); });
  function applyWorld(code) {
    code = code.trim();
    if (!code) { worldEl.value = seedStr; return; }
    if (code === seedStr) return;
    localStorage.setItem('akash.world.v1', code);
    const p = new URLSearchParams(location.search);
    p.set('seed', code);
    location.search = p.toString(); // navigates = reloads into the new world
  }
  document.getElementById('btn-world-reroll').addEventListener('click', () => {
    applyWorld(Math.random().toString(36).slice(2, 8));
  });
  // Invite: outside an iframe the full link carries the world; inside
  // itch.io's iframe the page URL is useless to a friend, so share the code
  // itself — they type it into this same field.
  // itch's iframe blocks the async Clipboard API by permissions policy, so
  // fall back to the legacy execCommand path (gesture-gated, not policy-gated).
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* blocked or unsupported — try the legacy path */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* nothing left to try */ }
    ta.remove();
    return ok;
  }
  const copyBtn = document.getElementById('btn-world-copy');
  copyBtn.addEventListener('click', async () => {
    const inIframe = window.self !== window.top;
    const invite = inIframe
      ? seedStr
      : `${location.origin}${location.pathname}?seed=${encodeURIComponent(seedStr)}`;
    if (await copyText(invite)) {
      copyBtn.textContent = 'copied ✓';
      setTimeout(() => { copyBtn.textContent = 'invite'; }, 1600);
    } else {
      // Truly no clipboard — select the code so ⌘C works by hand.
      worldEl.focus();
      worldEl.select();
    }
  });

  // Buttons.
  document.getElementById('btn-fly').addEventListener('click', () => {
    audio.start(); // user gesture — autoplay-safe
    // Mobile: go fullscreen + landscape while we still have the gesture.
    if (isTouch()) lockLandscape();
    setState('playing');
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    settingsReturn = 'menu';
    setState('settings');
  });
  document.getElementById('btn-resume').addEventListener('click', () => setState('playing'));
  document.getElementById('btn-pause-settings').addEventListener('click', () => {
    settingsReturn = 'paused';
    setState('settings');
  });
  document.getElementById('btn-main-menu').addEventListener('click', () => setState('menu'));
  document.getElementById('btn-settings-back').addEventListener('click', () => setState(settingsReturn));

  // Pilot identity on the main menu: name + drone color. Applied to your own
  // drone immediately, saved locally, and pushed to the pilot's server
  // record (multiplayer reconnects so others see it).
  const nameEl = document.getElementById('pilot-name');
  const colorsEl = document.getElementById('pilot-colors');
  nameEl.value = localStorage.getItem('akash.pilot.name') || '';
  let pilotColor = localStorage.getItem('akash.pilot.color') || PILOT_COLORS[0];
  function commitPilot() {
    const name = nameEl.value.trim().slice(0, 14);
    localStorage.setItem('akash.pilot.name', name);
    localStorage.setItem('akash.pilot.color', pilotColor);
    if (drone) drone.setBodyColor(pilotColor);
    pushProfile({ name, color: pilotColor })
      .then((ok) => {
        if (ok && multiplayer) multiplayer.refresh();
        else if (!ok) console.warn('pilot profile: server rejected update');
      })
      .catch((err) => console.warn('pilot profile: offline?', err.message));
  }
  for (const c of PILOT_COLORS) {
    const dot = document.createElement('button');
    dot.className = 'color-dot';
    dot.style.background = c;
    dot.title = 'drone color';
    dot.classList.toggle('sel', c === pilotColor);
    dot.addEventListener('click', () => {
      pilotColor = c;
      for (const d of colorsEl.children) d.classList.toggle('sel', d === dot);
      commitPilot();
    });
    colorsEl.appendChild(dot);
  }
  nameEl.addEventListener('change', commitPilot);

  // Volume sliders — live while dragging, persisted by audio.setVolume.
  for (const input of document.querySelectorAll('#screen-settings input[type=range]')) {
    const bus = input.dataset.bus;
    input.value = Math.round(audio.getVolume(bus) * 100);
    input.addEventListener('input', () => {
      audio.setVolume(bus, input.value / 100);
    });
  }

  // Fullscreen: the corner toggle (visible on every overlay screen) + F.
  // On iPhone there is no page fullscreen API at all — hide the control.
  const fsBtn = document.getElementById('btn-fs');
  const toggleFullscreen = () => {
    if (fullscreenActive()) exitFullscreen();
    else enterFullscreen().catch(() => {});
  };
  if (!fullscreenSupported) {
    fsBtn.style.display = 'none';
  } else {
    const fsLabel = fsBtn.querySelector('span');
    const fsEnter = fsBtn.querySelector('.fs-enter');
    const fsExit = fsBtn.querySelector('.fs-exit');
    fsBtn.addEventListener('click', toggleFullscreen);
    onFullscreenChange(() => {
      const on = fullscreenActive();
      fsLabel.textContent = on ? 'exit fullscreen' : 'fullscreen';
      fsEnter.style.display = on ? 'none' : '';
      fsExit.style.display = on ? '' : 'none';
    });
  }

  // ESC walks the state graph; F toggles fullscreen. Typing in a text field
  // must not trigger either — Enter commits, ESC blurs.
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') {
      if (e.code === 'Enter') {
        if (e.target === worldEl) applyWorld(worldEl.value);
        else e.target.blur(); // fires 'change' → commit
      }
      if (e.code === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (e.code !== 'Escape') return;
    if (api.state === 'playing') setState('paused');
    else if (api.state === 'paused') setState('playing');
    else if (api.state === 'settings') setState(settingsReturn);
  });

  setState('menu');
  return api;
}
