import sharp from 'sharp';
import { isGCSAvailable, uploadToGCS } from './gcsStorage';

let ObjectStorageService: any = null;
let objectStorage: any = null;

async function initReplitObjectStorage() {
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
      return await uploadToGCS(buffer, objectPath, contentType);
    }

    if (storageType === 'replit') {
      const storage = await initReplitObjectStorage();
      if (!storage) {
        throw new Error('Replit Object Storage initialization failed');
      }

      const uploadURL = await storage.getObjectEntityUploadURL();
      
      const response = await fetch(uploadURL, {
        method: 'PUT',
        body: buffer,
        headers: {
          'Content-Type': contentType,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to upload to object storage: ${response.status}`);
      }

      const normalizedPath = storage.normalizeObjectEntityPath(uploadURL);
      
      await storage.trySetObjectEntityAclPolicy(uploadURL, {
        owner: 'system',
        visibility: 'public',
      });

      return normalizedPath;
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
}

export const mediaStorage = new MediaStorageService();
