/**
 * One-off repair: find `videos/*.webm` objects whose bytes are actually MP4
 * (Veo output stored without transcoding) and re-encode them to real WebM
 * (VP9/Opus), re-uploading to the SAME key on both GCS and Replit Object
 * Storage. No DB changes needed — scenario intro_video_url keys stay valid.
 *
 * Run: npx tsx server/scripts/repairMislabeledIntroVideos.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  listGCSFilesMeta,
  downloadBufferFromGCS,
  uploadToGCS,
  isGCSAvailable,
} from '../services/gcsStorage';
import { mediaStorage } from '../services/mediaStorage';

const execAsync = promisify(exec);

function isWebM(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

async function transcodeToWebM(input: Buffer): Promise<Buffer> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-repair-'));
  const inPath = path.join(workDir, 'in.mp4');
  const outPath = path.join(workDir, 'out.webm');
  try {
    fs.writeFileSync(inPath, input);
    await execAsync(
      `ffmpeg -hide_banner -y -i "${inPath}" -c:v libvpx-vp9 -b:v 1M -crf 30 -c:a libopus -b:a 128k "${outPath}"`,
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
    );
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!isGCSAvailable()) {
    console.error('GCS is not available in this environment — aborting.');
    process.exit(1);
  }

  const files = await listGCSFilesMeta('videos/');
  const webmKeys = files.filter(f => f.name.toLowerCase().endsWith('.webm'));
  console.log(`Found ${webmKeys.length} .webm objects under videos/`);

  let repaired = 0, ok = 0, failed = 0;
  for (const f of webmKeys) {
    const buf = await downloadBufferFromGCS(f.name);
    if (!buf) {
      console.warn(`SKIP (download failed): ${f.name}`);
      failed++;
      continue;
    }
    if (isWebM(buf)) {
      ok++;
      continue;
    }
    console.log(`REPAIRING (MP4 bytes under .webm key): ${f.name} (${buf.length} bytes)`);
    try {
      const fixed = await transcodeToWebM(buf);
      if (!isWebM(fixed)) throw new Error('transcode output is not WebM');
      // Re-upload to the same key on GCS…
      await uploadToGCS(fixed, f.name, 'video/webm', false);
      // …and write-through to Replit OS so dev/dual mode also serves the fixed bytes.
      try {
        await mediaStorage.saveToFixedPath(fixed, f.name, 'video/webm');
      } catch (e: any) {
        console.warn(`  Replit OS write-through failed (GCS fixed): ${e.message}`);
      }
      console.log(`  ✅ fixed: ${f.name} (${buf.length} → ${fixed.length} bytes)`);
      repaired++;
    } catch (e: any) {
      console.error(`  ❌ repair failed for ${f.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. already-ok=${ok}, repaired=${repaired}, failed=${failed}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
