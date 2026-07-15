import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const baseUrl = process.env.AKASH_BASE_URL || 'http://127.0.0.1:4173';
const outputDir = path.join(rootDir, 'release', 'media');
const clipsDir = path.join(outputDir, 'clips');
const shotsDir = path.join(outputDir, 'screenshots');
const exportDir = path.join(process.env.HOME || '', 'Projects', 'akash-screenshots');
const bgmPath = path.join(rootDir, 'public', 'bgm.mp3');

const scenarios = [
  {
    name: 'menu',
    seed: 'ghibli1',
    kind: 'menu',
    screenshotDelayMs: 4200,
    tailMs: 1600,
  },
  {
    name: 'lake-glide',
    seed: 'ghibli1',
    kind: 'flight',
    screenshotDelayMs: 6200,
    actions: [
      { type: 'hold', keys: ['KeyW'], ms: 2400 },
      { type: 'wait', ms: 500 },
      { type: 'hold', keys: ['Space', 'ArrowRight'], ms: 1800 },
      { type: 'wait', ms: 1800 },
    ],
  },
  {
    name: 'meadow-bank',
    seed: 'ghibli2',
    kind: 'flight',
    screenshotDelayMs: 6800,
    actions: [
      { type: 'hold', keys: ['KeyW'], ms: 2600 },
      { type: 'wait', ms: 300 },
      { type: 'hold', keys: ['KeyW', 'ArrowLeft'], ms: 1800 },
      { type: 'wait', ms: 500 },
      { type: 'hold', keys: ['Space'], ms: 1200 },
      { type: 'wait', ms: 1800 },
    ],
  },
  {
    name: 'shore-rise',
    seed: 'ghibli3',
    kind: 'flight',
    screenshotDelayMs: 6000,
    actions: [
      { type: 'hold', keys: ['KeyW'], ms: 2000 },
      { type: 'wait', ms: 300 },
      { type: 'hold', keys: ['KeyW', 'Space'], ms: 2000 },
      { type: 'wait', ms: 300 },
      { type: 'hold', keys: ['ArrowRight'], ms: 1400 },
      { type: 'wait', ms: 1600 },
    ],
  },
];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function ensureDirs() {
  await fs.mkdir(clipsDir, { recursive: true });
  await fs.mkdir(shotsDir, { recursive: true });
  await fs.mkdir(exportDir, { recursive: true });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function holdKeys(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function startCanvasRecorder(page) {
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
      videoBitsPerSecond: 18_000_000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    window.__akashCapture = {
      recorder,
      chunks,
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

async function saveCanvasStill(page, outPath) {
  const dataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png') || null);
  if (!dataUrl) throw new Error('Failed to capture canvas still');
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
}

async function recordScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const screenshotPath = path.join(shotsDir, `${scenario.name}.png`);
  const clipPath = path.join(clipsDir, `${scenario.name}.webm`);

  await page.goto(`${baseUrl}/?seed=${scenario.seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4800);

  if (scenario.kind === 'flight') {
    await page.click('#btn-fly');
    await page.waitForTimeout(900);
  }

  await startCanvasRecorder(page);
  const start = Date.now();
  let screenshotTaken = false;

  async function maybeCaptureStill() {
    if (!screenshotTaken && Date.now() - start >= scenario.screenshotDelayMs) {
      await saveCanvasStill(page, screenshotPath);
      screenshotTaken = true;
    }
  }

  if (!scenario.actions) {
    while (!screenshotTaken) {
      await page.waitForTimeout(250);
      await maybeCaptureStill();
    }
    await page.waitForTimeout(scenario.tailMs ?? 1500);
  } else {
    for (const action of scenario.actions) {
      await maybeCaptureStill();
      if (action.type === 'wait') {
        await page.waitForTimeout(action.ms);
      } else if (action.type === 'hold') {
        await holdKeys(page, action.keys, action.ms);
      }
      await maybeCaptureStill();
    }
    if (!screenshotTaken) {
      await saveCanvasStill(page, screenshotPath);
      screenshotTaken = true;
    }
    await page.waitForTimeout(1200);
  }

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate((filename) => window.__akashCapture.stopAndDownload(filename), `${scenario.name}.webm`);
  const download = await downloadPromise;
  await download.saveAs(clipPath);
  await context.close();
  return { clipPath, screenshotPath };
}

async function exportScreenshots(results) {
  const ordered = [
    path.join(shotsDir, 'title-card.png'),
    ...results
      .filter((item) => item.name !== 'menu')
      .map((item) => item.screenshotPath),
  ];
  for (let i = 0; i < ordered.length; i++) {
    const src = ordered[i];
    const name = `akash-${String(i + 1).padStart(2, '0')}-${path.basename(src)}`;
    await fs.copyFile(src, path.join(exportDir, name));
  }
}

async function composeTitleShot() {
  const menuPath = path.join(shotsDir, 'menu.png');
  const titlePath = path.join(shotsDir, 'title-card.png');
  const logoPath = path.join(rootDir, 'public', 'branding', 'akash-logo-text.png');
  run('ffmpeg', [
    '-y',
    '-i', menuPath,
    '-i', logoPath,
    '-filter_complex', '[1:v]scale=760:-1[logo];[0:v][logo]overlay=(W-w)/2:120',
    '-frames:v', '1',
    titlePath,
  ]);
}

async function composeItchCover() {
  const menuPath = path.join(shotsDir, 'menu.png');
  const coverPath = path.join(shotsDir, 'itch-cover-630x500.png');
  const exportedPath = path.join(exportDir, 'akash-cover-630x500.png');
  const logoPath = path.join(rootDir, 'public', 'branding', 'akash-logo-text.png');
  run('ffmpeg', [
    '-y',
    '-i', menuPath,
    '-i', logoPath,
    '-filter_complex',
    [
      '[0:v]scale=889:500,crop=630:500:129:0[bg]',
      '[1:v]scale=500:-1[logo]',
      '[bg][logo]overlay=(W-w)/2:140'
    ].join(';'),
    '-frames:v', '1',
    coverPath,
  ]);
  await fs.copyFile(coverPath, exportedPath);
}

async function stitchVideo(results) {
  const concatFile = path.join(outputDir, 'clips.txt');
  const mergedPath = path.join(outputDir, 'akash-alpha-gameplay-silent.mp4');
  const finalPath = path.join(outputDir, 'akash-alpha-gameplay.mp4');
  const exportedPath = path.join(exportDir, 'akash-alpha-gameplay.mp4');

  const concatBody = results
    .filter((item) => item.name !== 'menu')
    .map((item) => `file '${item.clipPath.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(concatFile, `${concatBody}\n`);

  run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '14',
    '-pix_fmt', 'yuv420p',
    mergedPath,
  ]);

  run('ffmpeg', [
    '-y',
    '-i', mergedPath,
    '-stream_loop', '-1',
    '-i', bgmPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    finalPath,
  ]);

  await fs.copyFile(finalPath, exportedPath);
}

async function main() {
  await ensureDirs();
  const browser = await chromium.launch({ headless: false });
  const results = [];

  try {
    for (const scenario of scenarios) {
      const recorded = await recordScenario(browser, scenario);
      results.push({ name: scenario.name, ...recorded });
    }
  } finally {
    await browser.close();
  }

  await composeTitleShot();
  await composeItchCover();
  await exportScreenshots(results);
  await stitchVideo(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
