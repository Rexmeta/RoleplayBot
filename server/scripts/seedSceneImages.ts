import * as fs from 'fs';
import * as path from 'path';

const WORKPLACE_SCENE_IMAGES = [
  'ai-interview.png',
  'automation-notice.png',
  'ai-colleague-first-day.png',
  'hr-chatbot-booth.png',
  'ai-performance-review.png',
  'reskilling-first-day.png',
  'team-disbandment-eve.png',
  'anti-ai-union-meeting.png',
  'ai-onboarding.png',
  'career-counseling.png',
];

const SOURCE_DIR = path.join(process.cwd(), 'client', 'public', 'scenes');

function isReplitObjectStorageAvailable(): boolean {
  return !!process.env.REPL_ID && !!process.env.PUBLIC_OBJECT_SEARCH_PATHS;
}

async function uploadSceneImage(filename: string): Promise<'uploaded' | 'skipped'> {
  const { getObjectStorageClient } = await import('../replit_integrations/object_storage/objectStorage');
  const client = getObjectStorageClient();

  const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
  const firstSearchPath = pathsStr.split(',')[0].trim();
  const fullPath = firstSearchPath.startsWith('/') ? firstSearchPath.slice(1) : firstSearchPath;
  const parts = fullPath.split('/');
  const bucketName = parts[0];
  const objectPrefix = parts.slice(1).join('/');
  const objectKey = `scenes/${filename}`;
  const objectName = objectPrefix ? `${objectPrefix}/${objectKey}` : objectKey;

  const file = client.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();

  if (exists) {
    return 'skipped';
  }

  const sourcePath = path.join(SOURCE_DIR, filename);
  const buffer = fs.readFileSync(sourcePath);

  await file.save(buffer, {
    contentType: 'image/png',
    resumable: false,
    metadata: { contentType: 'image/png' },
  });

  console.log(`✅ 업로드: ${objectKey}`);
  return 'uploaded';
}

export async function seedSceneImages(): Promise<void> {
  console.log('🖼️  직장/현실 장면 이미지 업로드 시작...');

  if (!isReplitObjectStorageAvailable()) {
    console.log('⚠️  Replit Object Storage 미설정 — 장면 이미지 업로드 건너뜀');
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of WORKPLACE_SCENE_IMAGES) {
    const sourcePath = path.join(SOURCE_DIR, filename);

    if (!fs.existsSync(sourcePath)) {
      console.warn(`⚠️  소스 이미지 없음: ${filename}`);
      errors++;
      continue;
    }

    try {
      const result = await uploadSceneImage(filename);
      if (result === 'uploaded') {
        uploaded++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.error(`❌ 업로드 실패 (${filename}):`, err.message);
      errors++;
    }
  }

  console.log(`📊 장면 이미지 완료: ${uploaded}개 업로드, ${skipped}개 기존 존재, ${errors}개 오류`);
}
