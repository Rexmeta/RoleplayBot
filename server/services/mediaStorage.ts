import { ObjectStorageService } from '../replit_integrations/object_storage';
import sharp from 'sharp';

const objectStorage = new ObjectStorageService();

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
  private async uploadToObjectStorage(
    buffer: Buffer,
    objectPath: string,
    contentType: string
  ): Promise<string> {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    
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

    const normalizedPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    
    await objectStorage.trySetObjectEntityAclPolicy(uploadURL, {
      owner: 'system',
      visibility: 'public',
    });

    return normalizedPath;
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

    const imagePath = await this.uploadToObjectStorage(
      optimizedBuffer,
      `scenarios/${safeTitle}-${timestamp}.webp`,
      'image/webp'
    );

    const thumbnailPath = await this.uploadToObjectStorage(
      thumbnailBuffer,
      `scenarios/${safeTitle}-${timestamp}-thumb.webp`,
      'image/webp'
    );

    const originalSize = buffer.length;
    const optimizedSize = optimizedBuffer.length;
    console.log(`📁 시나리오 이미지 Object Storage 저장 완료:`);
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

    const imagePath = await this.uploadToObjectStorage(
      optimizedBuffer,
      `personas/${personaId}/${gender}/${emotionEn}.webp`,
      'image/webp'
    );

    const thumbnailPath = await this.uploadToObjectStorage(
      thumbnailBuffer,
      `personas/${personaId}/${gender}/${emotionEn}-thumb.webp`,
      'image/webp'
    );

    const originalSize = buffer.length;
    const optimizedSize = optimizedBuffer.length;
    console.log(`📁 페르소나 이미지 Object Storage 저장: ${emotionEn}`);
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

    const videoPath = await this.uploadToObjectStorage(
      Buffer.from(videoBytes),
      `videos/${scenarioId}-${safeTitle}-${timestamp}.webm`,
      'video/webm'
    );

    console.log(`📁 비디오 Object Storage 저장 완료: ${videoPath}`);

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
    
    const filePath = await this.uploadToObjectStorage(
      buffer,
      `${folder}/${timestamp}-${safeFilename}`,
      contentType
    );

    console.log(`📁 파일 Object Storage 저장 완료: ${filePath}`);

    return filePath;
  }
}

export const mediaStorage = new MediaStorageService();
