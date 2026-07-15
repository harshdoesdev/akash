import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const baseUrl = process.env.AKASH_BASE_URL || 'http://127.0.0.1:4173';
const exportDir = path.join(process.env.HOME || '', 'Projects', 'akash-screenshots');
const outputDir = path.join(rootDir, 'release', 'single-take');
const rawPath = path.join(outputDir, 'akash-single-take-wildlife.webm');
const silentMp4 = path.join(outputDir, 'akash-single-take-wildlife-silent.mp4');
const finalMp4 = path.join(outputDir, 'akash-single-take-wildlife.mp4');
const bgmPath = path.join(rootDir, 'public', 'bgm.mp3');

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
}

async function hold(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function wait(page, ms) {
  await page.waitForTimeout(ms);
}

async function startCapture(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('No canvas found');
    const stream = canvas.captureStream(60);
    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm;codecs=vp8';
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 20_000_000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    window.__singleTake = {
      recorder,
      async stopAndDownload(filename) {
        const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      },
    };
    recorder.start(250);
  });
}

async function installAutopilot(page, waypoints) {
  await page.evaluate((points) => {
    const drone = window.drone;
    const surfaceAt = window.surfaceAt;
    if (!drone || !surfaceAt) throw new Error('Autopilot hooks unavailable');

    const originalUpdate = drone.update.bind(drone);
    let elapsed = 0;
    let index = 0;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    drone.update = (dt) => {
      elapsed += dt;
      const current = points[Math.min(index, points.length - 1)];
      const dx = current.x - drone.position.x;
      const dz = current.z - drone.position.z;
      const dist = Math.hypot(dx, dz);

      if ((dist < current.radius && elapsed > current.minTime) || elapsed > current.maxTime) {
        index = Math.min(points.length - 1, index + 1);
        elapsed = 0;
      }

      const target = points[Math.min(index, points.length - 1)];
      const tx = target.x - drone.position.x;
      const tz = target.z - drone.position.z;
      const forwardX = -Math.sin(drone.yaw);
      const forwardZ = -Math.cos(drone.yaw);
      const rightX = Math.cos(drone.yaw);
      const rightZ = -Math.sin(drone.yaw);
      const ahead = tx * forwardX + tz * forwardZ;
      const side = tx * rightX + tz * rightZ;
      const targetY = surfaceAt(drone.position.x, drone.position.z) + target.agl;
      const climbErr = targetY - drone.position.y;

      const input = {
        pitch: clamp(ahead / 28, 0, 1),
        roll: clamp(side / 24, -0.55, 0.55),
        yaw: clamp(-side / 20, -1, 1),
        climb: clamp(climbErr / 3.5, -0.8, 0.8),
        reset: false,
      };

      // If the target is mostly behind the drone, stop pushing forward and turn first.
      if (ahead < -8) {
        input.pitch = 0;
        input.roll = 0;
        input.yaw = clamp(-side / 10 || -Math.sign(tx || 1), -1, 1);
      }

      originalUpdate(dt, input);
    };
    window.__autopilotDuration = points.reduce((sum, point) => sum + point.maxTime, 0);
  }, waypoints);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(exportDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/?seed=meadow2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await page.click('#btn-fly');
    await page.waitForTimeout(900);

    await installAutopilot(page, [
      { x: -6, z: -40, agl: 4.2, radius: 10, minTime: 1.4, maxTime: 3.2 },
      { x: -12, z: -110, agl: 4.0, radius: 14, minTime: 1.8, maxTime: 4.2 },
      { x: -10, z: -152, agl: 3.4, radius: 12, minTime: 2.2, maxTime: 4.2 },
      { x: 22, z: -142, agl: 3.8, radius: 12, minTime: 1.2, maxTime: 3.0 },
      { x: 70, z: -108, agl: 4.8, radius: 14, minTime: 1.8, maxTime: 3.4 },
      { x: 118, z: -72, agl: 6.6, radius: 16, minTime: 2.0, maxTime: 4.0 },
      { x: 128, z: -32, agl: 6.2, radius: 15, minTime: 1.4, maxTime: 3.0 },
      { x: 108, z: 18, agl: 5.6, radius: 14, minTime: 1.8, maxTime: 3.4 },
      { x: 96, z: 76, agl: 5.2, radius: 14, minTime: 2.0, maxTime: 4.0 },
      { x: 108, z: 102, agl: 5.8, radius: 12, minTime: 1.8, maxTime: 3.6 },
      { x: 76, z: 86, agl: 4.6, radius: 12, minTime: 1.2, maxTime: 2.8 },
      { x: 48, z: 38, agl: 4.2, radius: 12, minTime: 1.8, maxTime: 3.2 },
      { x: 22, z: -12, agl: 4.2, radius: 14, minTime: 1.6, maxTime: 3.0 },
      { x: 4, z: -78, agl: 4.8, radius: 16, minTime: 2.0, maxTime: 3.8 },
    ]);

    await startCapture(page);
    const durationMs = await page.evaluate(() => Math.ceil((window.__autopilotDuration || 24) * 1000));
    await page.waitForTimeout(durationMs + 1200);

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.__singleTake.stopAndDownload('akash-single-take-wildlife.webm'));
    const download = await downloadPromise;
    await download.saveAs(rawPath);
  } finally {
    await context.close();
    await browser.close();
  }

  run('ffmpeg', [
    '-y',
    '-i', rawPath,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '14',
    '-pix_fmt', 'yuv420p',
    silentMp4,
  ]);

  run('ffmpeg', [
    '-y',
    '-i', silentMp4,
    '-stream_loop', '-1',
    '-i', bgmPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    finalMp4,
  ]);

  await fs.copyFile(finalMp4, path.join(exportDir, 'akash-single-take-wildlife.mp4'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
