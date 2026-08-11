/**
 * Repair avatar clips that were stored before the generation pipeline
 * normalised its output.
 *
 * Those clips have two defects:
 *   - the bytes are H.264/AAC in an MP4 container but the object is stored
 *     under a `.webm` key and served as `video/webm`, which Chrome refuses to
 *     decode (every clip timed out on `canplay` and fell back to the still);
 *   - some carry solid black letterbox bars baked into the frame, which
 *     `object-fit: cover` turns into a black band above the avatar.
 *
 * The script re-uploads a normalised copy under a `.mp4` key and prints an
 * `old key -> new key` mapping so the persona records can be repointed.
 * Existing objects are left in place; nothing is deleted.
 *
 * Usage: tsx scripts/repairAvatarClips.ts <objectKey> [<objectKey> ...]
 */

import { normalizeAvatarClip } from '../server/services/gemini-video-generator';
import { mediaStorage } from '../server/services/mediaStorage';

const ORIGIN = process.env.REPAIR_ORIGIN ?? 'http://127.0.0.1:5000';

async function fetchClip(objectKey: string): Promise<Uint8Array> {
  const response = await fetch(`${ORIGIN}/objects?key=${encodeURIComponent(objectKey)}`);
  if (!response.ok) {
    throw new Error(`${objectKey} 다운로드 실패: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function repairClip(objectKey: string): Promise<{ from: string; to: string; crop: string | null }> {
  const original = await fetchClip(objectKey);
  const normalized = await normalizeAvatarClip(original);
  const newKey = objectKey.replace(/\.[^./]+$/, '') + `.${normalized.extension}`;

  await mediaStorage.saveToFixedPath(normalized.buffer, newKey, normalized.contentType);
  return { from: objectKey, to: newKey, crop: normalized.crop };
}

async function main() {
  const keys = process.argv.slice(2);
  if (keys.length === 0) {
    console.error('복구할 오브젝트 키를 하나 이상 전달하세요.');
    process.exit(1);
  }

  const mapping: Record<string, string> = {};
  for (const key of keys) {
    try {
      const result = await repairClip(key);
      mapping[result.from] = result.to;
      console.log(`✅ ${result.from}\n   → ${result.to}${result.crop ? ` (crop=${result.crop})` : ' (letterbox 없음)'}`);
    } catch (error: any) {
      console.error(`❌ ${key}: ${error.message}`);
    }
  }

  console.log(`\nMAPPING_JSON=${JSON.stringify(mapping)}`);

  // The storage clients keep handles open, so exit explicitly rather than
  // leaving the script hanging after the work is done.
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
