// Procedural audio — no files. Layers, each on its own bus for the mixer:
//  - wind: looped noise bed (gusting LFO) + a bandpass whoosh that sweeps
//    up with airspeed
//  - ambience: synthesized bird chirps
//  - drone: detuned saw pair pitched to throttle
//  - bgm: generative music — slow warm maj7 pad chords + sparse music-box
//    plucks on a pentatonic scale through a feedback delay
// Volumes persist to localStorage; audio starts on the menu's Fly click
// (a user gesture, which satisfies the autoplay policy).
const STORE_KEY = 'akash-audio-v1';
const DEFAULTS = { master: 0.55, drone: 0.8, wind: 1.0, ambience: 1.0, bgm: 0.5 };
// Sliders are linear but loudness perception is logarithmic — square the
// slider value so "half volume" actually sounds like half.
const curve = (v) => v * v;

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
  for (const name of ['drone', 'wind', 'ambience', 'bgm']) {
    buses[name] = ctx.createGain();
    buses[name].gain.value = curve(volumes[name]);
    buses[name].connect(master);
  }

  let started = false;
  let muted = false;
  const applyMaster = (ramp = 0.2) => {
    const target = started && !muted ? curve(volumes.master) : 0;
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
    else buses[name].gain.linearRampToValueAtTime(curve(volumes[name]), ctx.currentTime + 0.1);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(volumes)); } catch { /* private mode */ }
  };
  const getVolume = (name) => volumes[name];

  // ---- Wind (its own bus): a soft low bed that gusts, plus a bandpass
  // whoosh that sweeps up with airspeed — the "air rushing past" layer.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // Softer pink-ish noise for water — raw white noise reads as "zsh" static.
  // One-pole smoothed, with the loop seam crossfaded so it doesn't thump.
  const smoothBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const sdata = smoothBuf.getChannelData(0);
  let lastS = 0;
  for (let i = 0; i < sdata.length; i++) {
    lastS = lastS * 0.94 + (Math.random() * 2 - 1) * 0.25;
    sdata[i] = lastS * 2.2;
  }
  const SEAM = 2048;
  for (let k = 0; k < SEAM; k++) {
    const mixT = k / SEAM;
    const j = sdata.length - SEAM + k;
    sdata[j] = sdata[j] * (1 - mixT) + sdata[k] * mixT;
  }
  const waterNoise = ctx.createBufferSource();
  waterNoise.buffer = smoothBuf;
  waterNoise.loop = true;
  waterNoise.start();

  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 480;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.06;
  wind.connect(windFilter).connect(windGain).connect(buses.wind);
  const whooshFilter = ctx.createBiquadFilter();
  whooshFilter.type = 'bandpass';
  whooshFilter.frequency.value = 380;
  whooshFilter.Q.value = 0.9;
  // White noise through a bandpass alone sizzles ("grain") — a lowpass on
  // top rounds it into an actual whoosh.
  const whooshSmooth = ctx.createBiquadFilter();
  whooshSmooth.type = 'lowpass';
  whooshSmooth.frequency.value = 1100;
  const whooshGain = ctx.createGain();
  whooshGain.gain.value = 0;
  wind.connect(whooshFilter).connect(whooshSmooth).connect(whooshGain).connect(buses.wind);
  wind.start();
  // Slow gust LFO breathing on the bed — still air is never a flat hiss.
  const gust = ctx.createOscillator();
  gust.type = 'sine';
  gust.frequency.value = 0.13;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.02;
  gust.connect(gustDepth).connect(windGain.gain);
  gust.start();

  // ---- Water (ambience/nature bus)
  // A LAKE, not a sea: oceans roar in continuous surf; lakes lap — quiet,
  // discrete little slaps and gurgles at the waterline. So: a barely-there
  // damp ripple bed, plus randomized lap events and sparse bubble plips.
  const shoreHP = ctx.createBiquadFilter();
  shoreHP.type = 'highpass';
  shoreHP.frequency.value = 140;
  const shoreFilter = ctx.createBiquadFilter();
  shoreFilter.type = 'lowpass';
  shoreFilter.frequency.value = 450; // damp, dark — no crisp hiss
  const shoreGain = ctx.createGain();
  shoreGain.gain.value = 0;
  waterNoise.connect(shoreHP).connect(shoreFilter).connect(shoreGain)
    .connect(buses.ambience);

  // One soft wavelet slapping the shore: a dark little noise puff.
  function playLap(strength) {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = smoothBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420 + Math.random() * 320;
    const g = ctx.createGain();
    const peak = (0.05 + Math.random() * 0.08) * strength;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.04 + Math.random() * 0.06);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.3 + Math.random() * 0.3);
    src.connect(lp).connect(g).connect(buses.ambience);
    src.start(t0, Math.random() * 1.3, 0.8);
  }

  // A tiny bubble "plip" — short sine with a slight upward chirp (the
  // resonance of a small bubble reaching the surface).
  function playPlip(strength) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 600 + Math.random() * 900;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), t0 + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime((0.012 + Math.random() * 0.018) * strength, t0);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.09 + Math.random() * 0.08);
    osc.connect(g).connect(buses.ambience);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  }
  let lapTimer = 1;
  let plipTimer = 3;
  // Skim spray: rotor downwash kicking water when hovering low over the
  // lake — brighter than the whoosh but rounded the same way.
  const sprayFilter = ctx.createBiquadFilter();
  sprayFilter.type = 'bandpass';
  sprayFilter.frequency.value = 1400;
  sprayFilter.Q.value = 0.8;
  const spraySmooth = ctx.createBiquadFilter();
  spraySmooth.type = 'lowpass';
  spraySmooth.frequency.value = 1900;
  const sprayGain = ctx.createGain();
  sprayGain.gain.value = 0;
  wind.connect(sprayFilter).connect(spraySmooth).connect(sprayGain).connect(buses.ambience);

  // ---- Motor (drone)
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 900; // the rotor voicing — don't dull it
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
  // Primary: bgm.mp3 — "First Light Particles" by Yoiyami (CC0, from
  // OpenGameArt), looped. Fallback if the file is missing: the generative
  // pad-and-pluck layer below.
  let bgmBuffer = null;
  let bgmSource = null;
  let useGenerative = false;
  fetch(`${import.meta.env.BASE_URL}bgm.mp3`)
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
    update(dt, {
      speed, throttle, agl, flying = true, camDist = 5.6,
      shore = 0,      // 0..1 — how much nearby low-altitude water
      overWater = false,
      waterH = 999,   // height above the water surface
    }) {
      if (!started || muted) return;

      // On menus the drone is unmanned: motor fades out entirely and the
      // wind settles to its calm base. Ambience + music keep playing.
      const spd = flying ? speed : 0;
      const thr = flying ? throttle : 0;

      // Wind: the bed builds gently with airspeed and altitude; the whoosh
      // layer carries the sense of speed, sweeping up in level and pitch.
      const windTarget = Math.min(0.3, 0.045 + spd * 0.004 + agl * 0.0008);
      lerp(windGain.gain, windTarget, dt, 2);
      lerp(windFilter.frequency, 420 + spd * 20, dt, 2);
      const whooshTarget = Math.min(0.22, Math.max(0, spd - 3) * 0.011);
      lerp(whooshGain.gain, whooshTarget, dt, 3);
      lerp(whooshFilter.frequency, 320 + spd * 17, dt, 3);

      // Motor whine follows throttle — silent when not flying. Loudness is
      // the mixer's job (perceptual curve), not the voicing's. The camera
      // hears it, but gently: the chase cam stretches to 8–12m at speed, so
      // full level holds to 9m and never drops below 40% — distance should
      // read as nuance, not dimness.
      const att = Math.max(0.4, Math.min(1, Math.pow(9 / Math.max(camDist, 9), 1.2)));
      lerp(motorGain.gain, flying ? (0.02 + thr * 0.075) * att : 0, dt, 5);
      const f = 88 + thr * 75 + spd * 1.1;
      lerp(oscA.frequency, f, dt, 5);
      lerp(oscB.frequency, f * 2.03, dt, 5);

      // Water: near the lake's edge and low, a faint damp ripple bed plus
      // irregular wavelet laps and sparse plips; downwash spray when
      // skimming the surface — strongest under ~3m, gone by ~8m.
      lerp(shoreGain.gain, 0.06 * shore, dt, 1.5);
      lapTimer -= dt;
      if (shore > 0.04 && lapTimer <= 0) {
        playLap(Math.min(1, shore * 1.6));
        lapTimer = 0.5 + Math.random() * 2.2;
      }
      plipTimer -= dt;
      if (shore > 0.1 && plipTimer <= 0) {
        if (Math.random() < 0.7) playPlip(Math.min(1, shore * 1.5));
        plipTimer = 1.5 + Math.random() * 4;
      }
      const skim = overWater ? Math.max(0, Math.min(1, 1 - (waterH - 1) / 7)) : 0;
      const sprayTarget = Math.min(0.24, skim * (thr * 0.18 + spd * 0.005));
      lerp(sprayGain.gain, sprayTarget, dt, 4);
      lerp(sprayFilter.frequency, 1200 + spd * 25, dt, 3);

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
