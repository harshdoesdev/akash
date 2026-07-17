import * as THREE from 'three';
import { buildDroneMesh } from './drone.js';
import { mintTicket, RELAY_HTTP } from './session.js';

// Freeroam presence: everyone flying the same world code shares a room on a
// tiny WebSocket relay and sees each other as real drones — pilot-colored
// body, name floating overhead. No authority, no physics exchange: each
// client sends its own pose at WIRE_HZ and renders everyone else's latest
// through light smoothing.
//
// Identity is server-attributed (anonymous auth; see src/session.js and
// server/relay) — the wire never carries names, only poses:
// [x, y, z, yaw, pitch, roll], the same order as the race-ghost recording.
const RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');
const WIRE_HZ = 10;
const STALE_S = 8;      // no update for this long → the pilot fades away
const DROP_S = 30;      // this long → forget them entirely
const SMOOTH = 10;      // exp smoothing rate toward the latest sample (1/s)

// A solid pilot drone + floating name label. Fade is only used to slip
// in/out of the sky (materials go opaque again once fully arrived).
function buildPilotDrone(scene, color, name) {
  const { group, props, discs } = buildDroneMesh({ bodyColor: color || undefined });
  const discSet = new Set(discs);
  const mats = [];
  group.traverse((o) => {
    if (o.isMesh && !discSet.has(o)) mats.push(o.material);
  });

  let label = null;
  if (name) {
    const FONT = '600 30px "Hiragino Maru Gothic ProN", Quicksand, Avenir, sans-serif';
    const pad = 18;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = FONT;
    canvas.width = Math.min(512, Math.ceil(ctx.measureText(name).width) + pad * 2);
    canvas.height = 44;
    // Resizing reset the context state — set it again, then paint a soft
    // dark pill under the text so the name reads over bright grass.
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(24, 44, 72, 0.42)';
    ctx.beginPath();
    ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 21);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const h = 0.14;
    const w = h * (canvas.width / canvas.height);
    // The label lives beside the drone in the scene (not inside the group)
    // so billboarding is a straight copy of the camera quaternion.
    label = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    label.visible = false;
    scene.add(label);
  }

  group.visible = false;
  scene.add(group);

  return {
    group,
    label,
    setFade(f) {
      const solid = f >= 0.995;
      for (const m of mats) {
        m.transparent = !solid;
        m.opacity = solid ? 1 : f;
        m.depthWrite = solid;
      }
      if (label) { label.material.opacity = f; label.material.transparent = true; }
    },
    setPose(x, y, z, yaw, pitch, roll) {
      group.position.set(x, y, z);
      // Same composition as Drone.update: yaw → pitch → roll.
      group.rotation.set(0, 0, 0);
      group.rotateY(yaw);
      group.rotateX(-pitch);
      group.rotateZ(-roll);
      if (label) label.position.set(x, y + 0.34, z);
    },
    spinProps(dt) {
      for (const [k, prop] of props.entries()) {
        prop.rotation.y += (k % 2 ? 1 : -1) * 55 * dt;
      }
    },
    dispose() {
      scene.remove(group);
      if (label) scene.remove(label);
    },
  };
}

export function createMultiplayer(scene, worldCode, drone, isPlaying, camera) {
  const peers = new Map(); // userId → { rig, meta, target, cur, lastSeen, fade }
  let ws = null;
  let connecting = false;
  let sendTimer = 0;
  let clockS = 0;
  let count = 0;
  let retryS = 1;
  let closed = false;
  let sent = 0;
  let ticks = 0;

  function peerFor(id) {
    let p = peers.get(id);
    if (!p) {
      p = { rig: null, meta: { name: '', color: null }, target: null, cur: null, lastSeen: clockS, fade: 0 };
      peers.set(id, p);
    }
    return p;
  }

  function hear(id, pose, meta) {
    const p = peerFor(id);
    if (meta) {
      // Identity changed (or first sight) — rebuild the rig on next pose.
      if (p.rig && (meta.name !== p.meta.name || meta.color !== p.meta.color)) {
        p.rig.dispose();
        p.rig = null;
      }
      p.meta = { name: meta.name || '', color: meta.color || null };
    }
    if (pose) {
      p.target = pose;
      if (!p.cur) p.cur = pose.slice();
      p.lastSeen = clockS;
    }
  }

  async function connect() {
    if (closed || connecting) return;
    connecting = true;
    let ticket;
    try {
      ticket = await mintTicket();
    } catch (err) {
      connecting = false;
      console.warn('multiplayer: no ticket, retrying —', err.message);
      setTimeout(connect, retryS * 1000 * (0.7 + Math.random() * 0.6));
      retryS = Math.min(retryS * 2, 30);
      return;
    }
    ws = new WebSocket(
      `${RELAY_WS}/ws?room=${encodeURIComponent(worldCode)}&ticket=${encodeURIComponent(ticket)}`,
    );
    ws.onopen = () => { connecting = false; retryS = 1; };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.t === 'p') {
        hear(msg.id, msg.p, null);
      } else if (msg.t === 'hello') {
        for (const peer of msg.peers) hear(peer.id, peer.p, peer);
      } else if (msg.t === 'join') {
        hear(msg.id, null, msg);
      } else if (msg.t === 'bye') {
        const p = peers.get(msg.id);
        if (p) p.lastSeen = Math.min(p.lastSeen, clockS - STALE_S); // start the fade now
      }
    };
    ws.onclose = (e) => {
      ws = null;
      connecting = false;
      if (closed) return;
      if (e.code === 4002) return; // superseded by a newer tab — stand down
      // The relay or the network blinked — retry with backoff, forever.
      setTimeout(connect, retryS * 1000 * (0.7 + Math.random() * 0.6));
      retryS = Math.min(retryS * 2, 15);
    };
    ws.onerror = () => { if (ws) ws.close(); };
  }
  connect();

  return {
    get count() { return count; },
    // dev: spawn a labeled pilot drone in front of the camera to eyeball
    // label rendering without a second player
    _testLabel: (name = 'miyako', color = '#8fd0ff') => {
      const r = buildPilotDrone(scene, color, name);
      r.setPose(drone.position.x, drone.position.y + 0.8, drone.position.z - 1.8, 0, 0, 0);
      r.group.visible = true;
      if (r.label) {
        r.label.visible = true;
        r.label.quaternion.copy(camera.quaternion);
      }
      r.setFade(1);
      return { hasLabel: !!r.label };
    },
    // dev: connection introspection from the console
    _debug: () => ({
      ws: ws ? ws.readyState : -1,
      connecting,
      sent,
      ticks,
      peers: [...peers.entries()].map(([id, p]) => ({
        id: id.slice(0, 6),
        name: p.meta.name,
        hasPose: !!p.target,
        fade: Math.round(p.fade * 100) / 100,
      })),
    }),

    // Identity changed in settings: bounce the socket so the relay re-reads
    // the user record and everyone sees the new name/color.
    refresh() {
      if (ws) ws.close(); // CONNECTING sockets close too — onclose reconnects
    },

    update(dt) {
      clockS += dt;
      ticks++;

      // Send own pose while flying.
      if (isPlaying() && ws && ws.readyState === 1) {
        sendTimer -= dt;
        if (sendTimer <= 0) {
          sendTimer = 1 / WIRE_HZ;
          sent++;
          ws.send(JSON.stringify([
            Math.round(drone.position.x * 100) / 100,
            Math.round(drone.position.y * 100) / 100,
            Math.round(drone.position.z * 100) / 100,
            Math.round(drone.yaw * 1000) / 1000,
            Math.round(drone.pitch * 1000) / 1000,
            Math.round(drone.roll * 1000) / 1000,
          ]));
        }
      }

      // Advance every known pilot: smooth toward the latest sample, fade on
      // staleness, drop when long gone.
      count = 0;
      const k = 1 - Math.exp(-SMOOTH * dt);
      for (const [id, p] of peers) {
        const age = clockS - p.lastSeen;
        if (age > DROP_S) {
          if (p.rig) p.rig.dispose();
          peers.delete(id);
          continue;
        }
        if (!p.target) continue; // met them, haven't seen them fly yet
        if (!p.rig) {
          p.rig = buildPilotDrone(scene, p.meta.color, p.meta.name);
          p.fade = 0;
        }
        const fadeTarget = age > STALE_S ? 0 : 1;
        p.fade += (fadeTarget - p.fade) * Math.min(1, 4 * dt);
        p.rig.group.visible = p.fade > 0.02;
        if (p.rig.label) p.rig.label.visible = p.rig.group.visible;
        if (fadeTarget === 1) count++;
        if (!p.rig.group.visible) continue;
        for (let i = 0; i < 6; i++) p.cur[i] += (p.target[i] - p.cur[i]) * k;
        p.rig.setPose(...p.cur);
        p.rig.setFade(p.fade);
        p.rig.spinProps(dt);
        if (p.rig.label) p.rig.label.quaternion.copy(camera.quaternion);
      }
    },

    dispose() {
      closed = true;
      if (ws) ws.close();
    },
  };
}
