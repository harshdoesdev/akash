// Screen system: plain DOM sections crossfaded over the live canvas.
// States: menu | playing | paused | settings. The world always renders —
// the main menu's "art" is the game itself under a slow cinematic camera.
export function createUI({ audio, seedStr }) {
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

  // Seed line on the main menu.
  const seedEl = document.getElementById('menu-seed');
  if (seedEl) seedEl.textContent = `world: ${seedStr}`;

  // Buttons.
  document.getElementById('btn-fly').addEventListener('click', () => {
    audio.start(); // user gesture — autoplay-safe
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

  // Volume sliders — live while dragging, persisted by audio.setVolume.
  for (const input of document.querySelectorAll('#screen-settings input[type=range]')) {
    const bus = input.dataset.bus;
    input.value = Math.round(audio.getVolume(bus) * 100);
    input.addEventListener('input', () => {
      audio.setVolume(bus, input.value / 100);
    });
  }

  // ESC walks the state graph.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (api.state === 'playing') setState('paused');
    else if (api.state === 'paused') setState('playing');
    else if (api.state === 'settings') setState(settingsReturn);
  });

  setState('menu');
  return api;
}
