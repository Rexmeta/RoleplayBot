import { Storage } from "@google-cloud/storage";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
const GCS_URL_TTL = Number(process.env.GCS_URL_TTL || 3600);

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export function isGCSAvailable(): boolean {
  return !!GCS_BUCKET_NAME && !process.env.REPL_ID;
}

export function getGCSBucketName(): string {
  if (!GCS_BUCKET_NAME) {
    throw new Error(
      "GCS_BUCKET_NAME environment variable is not set. " +
      "Please set it to your Google Cloud Storage bucket name."
    );
  }
  return GCS_BUCKET_NAME;
}

export async function uploadToGCS(
  buffer: Buffer,
  objectPath: string,
  contentType: string,
  isPublic: boolean = false
): Promise<string> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: isPublic ? "public, max-age=31536000" : "private, max-age=0",
    },
  });

  if (isPublic) {
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectPath}`;
    console.log(`📁 GCS 공개 업로드 완료: ${publicUrl}`);
    return publicUrl;
  }

  // Return only the objectPath for private files (no gcs:// prefix)
  // This allows consistent handling when generating signed URLs
  console.log(`📁 GCS 비공개 업로드 완료: ${objectPath}`);
  return objectPath;
}

export async function getSignedUrl(objectPath: string): Promise<{ url: string; expiresIn: number }> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(objectPath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error("File not found");
  }

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + GCS_URL_TTL * 1000,
  });

  return { url, expiresIn: GCS_URL_TTL };
}

export async function checkFileExists(objectPath: string): Promise<boolean> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(objectPath);

  const [exists] = await file.exists();
  return exists;
}

export async function deleteFromGCS(objectPath: string): Promise<void> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  try {
    await file.delete();
    console.log(`🗑️ GCS 삭제 완료: ${objectPath}`);
  } catch (error: any) {
    if (error.code !== 404) {
      throw error;
    }
  }
}

export async function checkGCSConnection(): Promise<boolean> {
  if (!isGCSAvailable()) {
    return false;
  }

  try {
    const bucketName = getGCSBucketName();
    const storage = getStorageClient();
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    return exists;
  } catch (error) {
    console.error("GCS 연결 확인 실패:", error);
    return false;
  }
}

/**
 * Normalize object path by removing gcs:// prefix if present
 * Handles backward compatibility with old format
 */
export function normalizeObjectPath(path: string | null | undefined): string | null {
  if (!path) return null;
  
  // Remove gcs:// prefix if present (backward compatibility)
  if (path.startsWith('gcs://')) {
    return path.substring(6);
  }
  
  // Already a clean object path
  return path;
}

/**
 * Transform a media path to a signed URL for GCS
 * Returns the original path for Replit environment or non-GCS paths
 */
export async function transformToSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  
  // Normalize the path (remove gcs:// if present)
  const objectPath = normalizeObjectPath(path);
  if (!objectPath) return null;
  
  // If not in GCS environment or path is already a full URL, return as-is
  if (!isGCSAvailable()) {
    return path;
  }
  
  // Skip if it's already a full URL (public GCS, HTTP, data:, etc.)
  if (objectPath.startsWith('http://') || 
      objectPath.startsWith('https://') || 
      objectPath.startsWith('data:') ||
      objectPath.startsWith('/')) {
    return objectPath;
  }
  
  // Check if it's a valid GCS object path (scenarios/, videos/, personas/, uploads/)
  const validPrefixes = ['scenarios/', 'videos/', 'personas/', 'uploads/'];
  const isValidPath = validPrefixes.some(prefix => objectPath.startsWith(prefix));
  
  if (!isValidPath) {
    return objectPath;
  }
  
  try {
    const { url } = await getSignedUrl(objectPath);
    return url;
  } catch (error) {
    console.error(`Failed to generate signed URL for ${objectPath}:`, error);
    return null;
  }
}

/**
 * Transform a scenario object's media fields to signed URLs
 */
export async function transformScenarioMedia(scenario: any): Promise<any> {
  if (!scenario) return scenario;
  
  const [imageUrl, introVideoUrl] = await Promise.all([
    transformToSignedUrl(scenario.image),
    transformToSignedUrl(scenario.introVideoUrl)
  ]);
  
  return {
    ...scenario,
    image: imageUrl,
    introVideoUrl: introVideoUrl
  };
}

/**
 * Transform multiple scenarios' media fields to signed URLs
 */
export async function transformScenariosMedia(scenarios: any[]): Promise<any[]> {
  if (!scenarios || !Array.isArray(scenarios)) return scenarios;
  
  return Promise.all(scenarios.map(scenario => transformScenarioMedia(scenario)));
}

/**
 * Transform persona images object to signed URLs
 * Handles the nested structure: images.male.expressions, images.female.expressions
 */
export async function transformPersonaImages(images: any): Promise<any> {
  if (!images || !isGCSAvailable()) return images;
  
  const result: any = { ...images };
  
  // Transform male expressions
  if (images.male?.expressions) {
    const maleExpressions: Record<string, string> = {};
    for (const [emotion, path] of Object.entries(images.male.expressions)) {
      if (typeof path === 'string') {
        const signedUrl = await transformToSignedUrl(path);
        maleExpressions[emotion] = signedUrl || path;
      }
    }
    result.male = { ...images.male, expressions: maleExpressions };
  }
  
  // Transform female expressions
  if (images.female?.expressions) {
    const femaleExpressions: Record<string, string> = {};
    for (const [emotion, path] of Object.entries(images.female.expressions)) {
      if (typeof path === 'string') {
        const signedUrl = await transformToSignedUrl(path);
        femaleExpressions[emotion] = signedUrl || path;
      }
    }
    result.female = { ...images.female, expressions: femaleExpressions };
  }
  
  return result;
}

/**
 * Transform a persona object's image fields to signed URLs
 */
export async function transformPersonaMedia(persona: any): Promise<any> {
  if (!persona) return persona;
  
  const transformedImages = await transformPersonaImages(persona.images);
  
  return {
    ...persona,
    images: transformedImages
  };
}

/**
 * Transform multiple personas' image fields to signed URLs
 */
export async function transformPersonasMedia(personas: any[]): Promise<any[]> {
  if (!personas || !Array.isArray(personas)) return personas;
  
  return Promise.all(personas.map(persona => transformPersonaMedia(persona)));
}
