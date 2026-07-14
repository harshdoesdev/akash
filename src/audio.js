// Procedural ambience — no audio files. Three layers:
//  - wind: looped filtered noise, swells with speed and altitude
//  - motor: detuned saw pair pitched to throttle
//  - birds: synthesized chirps, sparse when flying high/fast
// Browsers require a user gesture before audio; we start on first input.
export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { update() {} };
  const ctx = new Ctx();

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  let started = false;
  let muted = false;
  const start = () => {
    if (started) return;
    started = true;
    ctx.resume().catch(() => {});
    master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.5);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && started) {
      muted = !muted;
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.55, ctx.currentTime + 0.15);
      return;
    }
    start();
  });
  window.addEventListener('pointerdown', start);

  // ---- Wind
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
  wind.connect(windFilter).connect(windGain).connect(master);
  wind.start();

  // ---- Motor
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 900;
  motorFilter.connect(motorGain).connect(master);
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

  // ---- Birds
  function chirp() {
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(g).connect(pan).connect(master);

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

  const lerp = (param, target, dt, rate) => {
    param.value += (target - param.value) * Math.min(1, rate * dt);
  };

  return {
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
    },
  };
}
