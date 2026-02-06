import sharp from 'sharp';
import { isGCSAvailable, uploadToGCS, deleteFromGCS, normalizeObjectPath, isCloudRun, downloadBufferFromGCS } from './gcsStorage';

let ObjectStorageService: any = null;
let objectStorage: any = null;

async function initReplitObjectStorage() {
  // CRITICAL: Never initialize Replit Object Storage on Cloud Run
  if (isCloudRun()) {
    console.error('[MediaStorage] BLOCKED: Attempted to initialize Replit Object Storage on Cloud Run');
    return null;
  }
  
  if (objectStorage) return objectStorage;
  
  try {
    const module = await import('../replit_integrations/object_storage');
    ObjectStorageService = module.ObjectStorageService;
    objectStorage = new ObjectStorageService();
    return objectStorage;
  } catch (error) {
    console.log('Replit Object Storage not available');
    return null;
  }
}

function getStorageType(): 'gcs' | 'replit' | 'none' {
  if (isGCSAvailable()) {
    return 'gcs';
  }
  // On Cloud Run, never fall back to Replit Object Storage
  if (isCloudRun()) {
    console.error('[MediaStorage] Cloud Run detected but GCS not available. Check GCS_BUCKET_NAME.');
    return 'none';
  }
  if (process.env.REPL_ID && process.env.PRIVATE_OBJECT_DIR) {
    return 'replit';
  }
  return 'none';
}

const IMAGE_CONFIG = {
  scenario: {
    original: { width: 1200, height: 800, quality: 85 },
    thumbnail: { width: 400, height: 300, quality: 80 }
  },
  persona: {
    original: { width: 800, height: 800, quality: 90 },
    thumbnail: { width: 200, height: 200, quality: 80 }
  }
};

export class MediaStorageService {
  private async uploadToStorage(
    buffer: Buffer,
    objectPath: string,
    contentType: string
  ): Promise<string> {
    const storageType = getStorageType();

    if (storageType === 'gcs') {
      return await uploadToGCS(buffer, objectPath, contentType, false);
    }

    if (storageType === 'replit') {
      const module = await import('../replit_integrations/object_storage');
      const client = module.getObjectStorageClient();

      const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
      const searchPaths = pathsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
      if (searchPaths.length === 0) {
        throw new Error('PUBLIC_OBJECT_SEARCH_PATHS not set');
      }

      const publicPath = searchPaths[0];
      const fullPath = publicPath.startsWith('/') ? publicPath.slice(1) : publicPath;
      const parts = fullPath.split('/');
      const bucketName = parts[0];
      const objectPrefix = parts.slice(1).join('/');
      const objectName = objectPrefix ? `${objectPrefix}/${objectPath}` : objectPath;

      const file = client.bucket(bucketName).file(objectName);
      await file.save(buffer, {
        contentType,
        resumable: false,
        metadata: { contentType },
      });

      console.log(`📁 Replit Object Storage 업로드: ${objectPath} (bucket: ${bucketName}, object: ${objectName})`);

      return objectPath;
    }

    throw new Error(
      'No storage backend available. Set GCS_BUCKET_NAME for Google Cloud Storage, ' +
      'or run on Replit with Object Storage configured.'
    );
  }

  async saveScenarioImage(
    base64ImageUrl: string,
    scenarioTitle: string
  ): Promise<{ imagePath: string; thumbnailPath: string }> {
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }

    const imageData = matches[2];
    const buffer = Buffer.from(imageData, 'base64');

    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const optimizedBuffer = await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.original.width, IMAGE_CONFIG.scenario.original.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.original.quality })
      .toBuffer();

    const thumbnailBuffer = await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.thumbnail.width, IMAGE_CONFIG.scenario.thumbnail.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.thumbnail.quality })
      .toBuffer();

    const imagePath = await this.uploadToStorage(
      optimizedBuffer,
      `scenarios/${safeTitle}-${timestamp}.webp`,
      'image/webp'
    );

    const thumbnailPath = await this.uploadToStorage(
      thumbnailBuffer,
      `scenarios/${safeTitle}-${timestamp}-thumb.webp`,
      'image/webp'
    );

    const originalSize = buffer.length;
    const optimizedSize = optimizedBuffer.length;
    console.log(`📁 시나리오 이미지 저장 완료 (${getStorageType().toUpperCase()}):`);
    console.log(`   원본: ${(originalSize / 1024).toFixed(0)}KB → 최적화: ${(optimizedSize / 1024).toFixed(0)}KB`);

    return { imagePath, thumbnailPath };
  }

  async savePersonaImage(
    base64ImageUrl: string,
    personaId: string,
    emotion: string,
    gender: 'male' | 'female'
  ): Promise<{ imagePath: string; thumbnailPath: string }> {
    if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
      throw new Error('Invalid persona ID');
    }

    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }

    const imageData = matches[2];
    const buffer = Buffer.from(imageData, 'base64');

    const emotionEnglishMap: Record<string, string> = {
      '중립': 'neutral',
      '기쁨': 'joy',
      '슬픔': 'sad',
      '분노': 'angry',
      '놀람': 'surprise',
      '호기심': 'curious',
      '불안': 'anxious',
      '단호': 'determined',
      '실망': 'disappointed',
      '당혹': 'confused'
    };

    const emotionEn = emotionEnglishMap[emotion] || emotion;

    const optimizedBuffer = await sharp(buffer)
      .resize(IMAGE_CONFIG.persona.original.width, IMAGE_CONFIG.persona.original.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.persona.original.quality })
      .toBuffer();

    const thumbnailBuffer = await sharp(buffer)
      .resize(IMAGE_CONFIG.persona.thumbnail.width, IMAGE_CONFIG.persona.thumbnail.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.persona.thumbnail.quality })
      .toBuffer();

    const imagePath = await this.uploadToStorage(
      optimizedBuffer,
      `personas/${personaId}/${gender}/${emotionEn}.webp`,
      'image/webp'
    );

    const thumbnailPath = await this.uploadToStorage(
      thumbnailBuffer,
      `personas/${personaId}/${gender}/${emotionEn}-thumb.webp`,
      'image/webp'
    );

    const originalSize = buffer.length;
    const optimizedSize = optimizedBuffer.length;
    console.log(`📁 페르소나 이미지 저장 (${getStorageType().toUpperCase()}): ${emotionEn}`);
    console.log(`   원본: ${(originalSize / 1024).toFixed(0)}KB → 최적화: ${(optimizedSize / 1024).toFixed(0)}KB`);

    return { imagePath, thumbnailPath };
  }

  async saveVideo(
    videoBytes: Uint8Array,
    scenarioId: string,
    scenarioTitle: string
  ): Promise<string> {
    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const videoPath = await this.uploadToStorage(
      Buffer.from(videoBytes),
      `videos/${scenarioId}-${safeTitle}-${timestamp}.webm`,
      'video/webm'
    );

    console.log(`📁 비디오 저장 완료 (${getStorageType().toUpperCase()}): ${videoPath}`);

    return videoPath;
  }

  async saveUploadedFile(
    buffer: Buffer,
    filename: string,
    contentType: string,
    folder: string = 'uploads'
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeFilename = filename.replace(/[^a-zA-Z0-9가-힣.\-_]/g, '');
    
    const filePath = await this.uploadToStorage(
      buffer,
      `${folder}/${timestamp}-${safeFilename}`,
      contentType
    );

    console.log(`📁 파일 저장 완료 (${getStorageType().toUpperCase()}): ${filePath}`);

    return filePath;
  }

  getStorageInfo(): { type: string; available: boolean } {
    const storageType = getStorageType();
    return {
      type: storageType,
      available: storageType !== 'none'
    };
  }

  async readImageBuffer(objectKey: string): Promise<Buffer | null> {
    const storageType = getStorageType();

    try {
      if (storageType === 'gcs') {
        return await downloadBufferFromGCS(objectKey);
      }

      if (storageType === 'replit') {
        const storage = await initReplitObjectStorage();
        if (!storage) return null;
        const file = await storage.searchPublicObject(objectKey);
        if (!file) return null;
        const [buffer] = await file.download();
        return buffer;
      }
    } catch (error) {
      console.error(`[MediaStorage] Failed to read image buffer: ${objectKey}`, error);
    }

    return null;
  }

  async deleteFromStorage(objectPath: string | null | undefined): Promise<boolean> {
    if (!objectPath) return false;
    
    const storageType = getStorageType();
    
    // Normalize the path (remove gcs:// prefix if present, remove leading slash)
    let normalizedPath = normalizeObjectPath(objectPath);
    if (!normalizedPath) return false;
    
    if (normalizedPath.startsWith('/')) {
      normalizedPath = normalizedPath.substring(1);
    }
    
    // Skip if it's already a full URL (shouldn't be deleted via path)
    if (normalizedPath.startsWith('http://') || 
        normalizedPath.startsWith('https://') || 
        normalizedPath.startsWith('data:')) {
      console.log(`⏭️ Skipping deletion of URL: ${normalizedPath.substring(0, 50)}...`);
      return false;
    }
    
    // Validate path prefix for safety
    const validPrefixes = ['scenarios/', 'videos/', 'personas/', 'uploads/'];
    const isValidPath = validPrefixes.some(prefix => normalizedPath!.startsWith(prefix));
    
    if (!isValidPath) {
      console.log(`⏭️ Skipping deletion of invalid path: ${normalizedPath}`);
      return false;
    }

    try {
      if (storageType === 'gcs') {
        await deleteFromGCS(normalizedPath);
        console.log(`🗑️ GCS 파일 삭제 완료: ${normalizedPath}`);
        return true;
      }

      if (storageType === 'replit') {
        const storage = await initReplitObjectStorage();
        if (storage) {
          try {
            const file = await storage.searchPublicObject(normalizedPath);
            if (file) {
              await file.delete();
              console.log(`🗑️ Replit Object Storage 파일 삭제 완료: ${normalizedPath}`);
              return true;
            }
            return false;
          } catch (deleteError: any) {
            if (deleteError.code !== 404) {
              console.error(`Failed to delete from Replit Object Storage: ${normalizedPath}`, deleteError);
            }
            return false;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error(`Failed to delete from storage: ${normalizedPath}`, error);
      return false;
    }
  }

  async deleteMultipleFromStorage(paths: (string | null | undefined)[]): Promise<number> {
    let deletedCount = 0;
    for (const path of paths) {
      if (await this.deleteFromStorage(path)) {
        deletedCount++;
      }
    }
    return deletedCount;
  }
}

export const mediaStorage = new MediaStorageService();
