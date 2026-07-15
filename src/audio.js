// Procedural audio — no files. Layers, each on its own bus for the mixer:
//  - ambience: looped filtered wind noise + synthesized bird chirps
//  - drone: detuned saw pair pitched to throttle
//  - bgm: generative music — slow warm maj7 pad chords + sparse music-box
//    plucks on a pentatonic scale through a feedback delay
// Volumes persist to localStorage; audio starts on the menu's Fly click
// (a user gesture, which satisfies the autoplay policy).
const STORE_KEY = 'akash-audio-v1';
const DEFAULTS = { master: 0.55, drone: 1.0, ambience: 1.0, bgm: 0.5 };

export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return { update() {}, start() {}, setVolume() {}, getVolume: () => 0 };
  }
  const ctx = new Ctx();

  let volumes = { ...DEFAULTS };
  try {
    volumes = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch { /* fresh defaults */ }

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const buses = {};
  for (const name of ['drone', 'ambience', 'bgm']) {
    buses[name] = ctx.createGain();
    buses[name].gain.value = volumes[name];
    buses[name].connect(master);
  }

  let started = false;
  let muted = false;
  const applyMaster = (ramp = 0.2) => {
    const target = started && !muted ? volumes.master : 0;
    master.gain.linearRampToValueAtTime(target, ctx.currentTime + ramp);
  };
  const start = () => {
    if (started) return;
    started = true;
    ctx.resume().catch(() => {});
    applyMaster(1.5);
    startBgmFile();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && started) {
      muted = !muted;
      applyMaster(0.15);
    }
  });

  const setVolume = (name, v) => {
    volumes[name] = Math.max(0, Math.min(1, v));
    if (name === 'master') applyMaster(0.1);
    else buses[name].gain.linearRampToValueAtTime(volumes[name], ctx.currentTime + 0.1);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(volumes)); } catch { /* private mode */ }
  };
  const getVolume = (name) => volumes[name];

  // ---- Wind (ambience)
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 480;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.06;
  wind.connect(windFilter).connect(windGain).connect(buses.ambience);
  wind.start();

  // ---- Motor (drone)
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 900;
  motorFilter.connect(motorGain).connect(buses.drone);
  const oscA = ctx.createOscillator();
  oscA.type = 'sawtooth';
  oscA.frequency.value = 100;
  const oscB = ctx.createOscillator();
  oscB.type = 'sawtooth';
  oscB.frequency.value = 203; // slightly detuned octave = mechanical beat
  const oscBGain = ctx.createGain();
  oscBGain.gain.value = 0.4;
  oscA.connect(motorFilter);
  oscB.connect(oscBGain).connect(motorFilter);
  oscA.start();
  oscB.start();

  // ---- Birds (ambience)
  function chirp() {
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(g).connect(pan).connect(buses.ambience);

    const f0 = 2100 + Math.random() * 1900;
    let t = t0;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const dur = 0.05 + Math.random() * 0.09;
      osc.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.25), t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (1.05 + Math.random() * 0.4), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.015);
      g.gain.linearRampToValueAtTime(0, t + dur);
      t += dur + 0.04 + Math.random() * 0.1;
    }
    osc.start(t0);
    osc.stop(t + 0.1);
    osc.onended = () => pan.disconnect();
  }
  let birdTimer = 1.5;

  // ---- BGM
  // Primary: /bgm.mp3 — "First Light Particles" by Yoiyami (CC0, from
  // OpenGameArt), looped. Fallback if the file is missing: the generative
  // pad-and-pluck layer below.
  let bgmBuffer = null;
  let bgmSource = null;
  let useGenerative = false;
  fetch('/bgm.mp3')
    .then((r) => { if (!r.ok) throw new Error('no bgm'); return r.arrayBuffer(); })
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      bgmBuffer = decoded;
      if (started) startBgmFile();
    })
    .catch(() => { useGenerative = true; });

  function startBgmFile() {
    if (!bgmBuffer || bgmSource) return;
    bgmSource = ctx.createBufferSource();
    bgmSource.buffer = bgmBuffer;
    bgmSource.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    bgmSource.connect(g).connect(buses.bgm);
    bgmSource.start();
  }

  // ---- BGM fallback (generative)
  // Pads: one warm maj7-ish chord at a time, ~10s each, long cross-faded
  // envelopes. Plucks: a slow music box wandering a C-major pentatonic,
  // echoed by a feedback delay. Everything very quiet — a haze, not a song.
  const bgmPad = ctx.createBiquadFilter();
  bgmPad.type = 'lowpass';
  bgmPad.frequency.value = 900;
  bgmPad.connect(buses.bgm);

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  delay.connect(feedback).connect(delay);
  delay.connect(buses.bgm);

  // Cmaj7, Fmaj7, Am7, Gadd9 — the cozy corner of the key.
  const CHORDS = [
    [130.81, 164.81, 196.0, 246.94],
    [174.61, 220.0, 261.63, 329.63],
    [110.0, 164.81, 196.0, 261.63],
    [98.0, 146.83, 196.0, 220.0],
  ];
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  let chordIdx = 0;
  let chordTimer = 0;
  let pluckTimer = 3;

  function playChord(freqs) {
    const t0 = ctx.currentTime;
    const DUR = 11;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.028, t0 + 3.5);
      g.gain.setValueAtTime(0.028, t0 + DUR - 4);
      g.gain.linearRampToValueAtTime(0, t0 + DUR);
      osc.connect(g).connect(bgmPad);
      osc.start(t0);
      osc.stop(t0 + DUR + 0.1);
    }
  }

  function pluck() {
    const t0 = ctx.currentTime;
    const f = PENTA[Math.floor(Math.random() * PENTA.length)];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 1.4);
    osc.connect(g);
    g.connect(buses.bgm);
    g.connect(delay);
    osc.start(t0);
    osc.stop(t0 + 1.5);
  }

  const lerp = (param, target, dt, rate) => {
    param.value += (target - param.value) * Math.min(1, rate * dt);
  };

  return {
    start,
    setVolume,
    getVolume,
    update(dt, { speed, throttle, agl }) {
      if (!started || muted) return;

      // Wind builds with airspeed and altitude.
      const windTarget = Math.min(0.4, 0.05 + speed * 0.007 + agl * 0.001);
      lerp(windGain.gain, windTarget, dt, 2);
      lerp(windFilter.frequency, 420 + speed * 28, dt, 2);

      // Motor whine follows throttle.
      lerp(motorGain.gain, 0.02 + throttle * 0.075, dt, 5);
      const f = 88 + throttle * 75 + speed * 1.1;
      lerp(oscA.frequency, f, dt, 5);
      lerp(oscB.frequency, f * 2.03, dt, 5);

      // Birds live near the ground and trees; they go quiet at speed.
      birdTimer -= dt;
      if (birdTimer <= 0) {
        if (agl < 45 && speed < 18 && Math.random() < 0.85) chirp();
        birdTimer = 2 + Math.random() * 5;
      }

      // Generative BGM only runs if the music file failed to load.
      if (useGenerative) {
        chordTimer -= dt;
        if (chordTimer <= 0) {
          playChord(CHORDS[chordIdx % CHORDS.length]);
          chordIdx += Math.random() < 0.75 ? 1 : 2; // mostly stepwise, some skips
          chordTimer = 9;
        }
        pluckTimer -= dt;
        if (pluckTimer <= 0) {
          if (Math.random() < 0.8) pluck();
          pluckTimer = 1.6 + Math.random() * 4;
        }
      }
    },
  };
}
