import { Storage } from "@google-cloud/storage";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
const GCS_URL_TTL = Number(process.env.GCS_URL_TTL || 3600);

let storageClient: Storage | null = null;

// Startup environment logging
console.log(`[Storage Config] Environment detection:`);
console.log(`  - K_SERVICE: ${process.env.K_SERVICE ? 'SET (Cloud Run)' : 'NOT SET'}`);
console.log(`  - REPL_ID: ${process.env.REPL_ID ? 'SET (Replit)' : 'NOT SET'}`);
console.log(`  - GCS_BUCKET_NAME: ${GCS_BUCKET_NAME ? `"${GCS_BUCKET_NAME}"` : 'NOT SET'}`);
console.log(`  - PRIVATE_OBJECT_DIR: ${process.env.PRIVATE_OBJECT_DIR ? 'SET' : 'NOT SET'}`);

// Determine and log the active storage mode
const isCloudRunEnv = !!process.env.K_SERVICE || !!process.env.K_REVISION;
const isReplitEnv = !!process.env.REPL_ID;

if (isCloudRunEnv) {
  console.log(`[Storage Config] ========================================`);
  console.log(`[Storage Config] CLOUD RUN MODE ACTIVE`);
  console.log(`[Storage Config] ========================================`);
  if (GCS_BUCKET_NAME) {
    console.log(`[Storage Config] ✅ Storage Backend: Google Cloud Storage`);
    console.log(`[Storage Config]    Bucket: ${GCS_BUCKET_NAME}`);
    console.log(`[Storage Config]    /objects/* routes: DISABLED (use GCS Signed URLs)`);
  } else {
    console.error(`[Storage Config] ❌ CRITICAL: GCS_BUCKET_NAME not configured!`);
    console.error(`[Storage Config]    Media uploads/downloads will FAIL`);
    console.error(`[Storage Config]    Set: gcloud run services update SERVICE --update-env-vars GCS_BUCKET_NAME=your-bucket`);
  }
} else if (isReplitEnv) {
  console.log(`[Storage Config] ========================================`);
  console.log(`[Storage Config] REPLIT MODE ACTIVE`);
  console.log(`[Storage Config] ========================================`);
  if (GCS_BUCKET_NAME) {
    console.log(`[Storage Config] ✅ Storage Backend: Google Cloud Storage`);
  } else if (process.env.PRIVATE_OBJECT_DIR) {
    console.log(`[Storage Config] ✅ Storage Backend: Replit Object Storage`);
    console.log(`[Storage Config]    /objects/* routes: ENABLED`);
  } else {
    console.log(`[Storage Config] ⚠️ No storage backend configured`);
  }
} else {
  console.log(`[Storage Config] ========================================`);
  console.log(`[Storage Config] LOCAL/UNKNOWN MODE`);
  console.log(`[Storage Config] ========================================`);
}

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export function isCloudRun(): boolean {
  return !!process.env.K_SERVICE || !!process.env.K_REVISION;
}

export function isReplitEnvironment(): boolean {
  return !!process.env.REPL_ID;
}

export function isGCSAvailable(): boolean {
  if (isCloudRun()) {
    if (!GCS_BUCKET_NAME) {
      console.error("[GCS] Cloud Run detected but GCS_BUCKET_NAME is not set!");
      return false;
    }
    return true;
  }
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

  // Use resumable: false to avoid delete permission issues when overwriting
  // With resumable uploads, GCS may try to delete the old object which requires delete permissions
  await file.save(buffer, {
    resumable: false,
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
  // CRITICAL: Normalize path to remove query strings (?t=timestamp) that break GCS lookups
  const cleanPath = normalizeObjectPath(objectPath);
  if (!cleanPath) {
    throw new Error("Invalid object path");
  }
  
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(cleanPath);

  const [exists] = await file.exists();
  if (!exists) {
    console.error(`[GCS] File not found: "${cleanPath}" (original: "${objectPath}")`);
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
  
  let cleanPath = path;
  
  // Remove gcs:// prefix if present (backward compatibility)
  if (cleanPath.startsWith('gcs://')) {
    cleanPath = cleanPath.substring(6);
  }
  
  // Handle URL format (extract pathname)
  try {
    // Check if it's a full URL (signed URL or http URL)
    if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
      const url = new URL(cleanPath);
      cleanPath = url.pathname.replace(/^\/+/, ''); // Remove leading slashes
    }
  } catch {
    // Not a URL, continue with path processing
  }
  
  // CRITICAL: Remove query strings (?t=timestamp, etc.) - these break GCS lookups
  // GCS object keys must be exact matches without query parameters
  const queryIndex = cleanPath.indexOf('?');
  if (queryIndex !== -1) {
    cleanPath = cleanPath.substring(0, queryIndex);
  }
  
  return cleanPath;
}

/**
 * Transform a media path to a signed URL for GCS
 * Returns the original path for Replit environment or non-GCS paths
 */
export async function transformToSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  
  // Normalize the path (remove gcs://, query strings, etc.)
  let objectPath = normalizeObjectPath(path);
  if (!objectPath) return null;
  
  // If not in GCS environment, return as-is (for Replit)
  if (!isGCSAvailable()) {
    return path;
  }
  
  // Skip if it's already a full URL (public GCS, HTTP, data:, etc.)
  if (objectPath.startsWith('http://') || 
      objectPath.startsWith('https://') || 
      objectPath.startsWith('data:')) {
    return objectPath;
  }
  
  // Remove leading slash if present (e.g., /scenarios/... -> scenarios/...)
  if (objectPath.startsWith('/')) {
    objectPath = objectPath.substring(1);
  }
  
  // Handle Replit Object Storage paths (/objects/...) on Cloud Run
  // These paths cannot be served on Cloud Run - return null or try to extract useful path
  if (objectPath.startsWith('objects/')) {
    // On Cloud Run, /objects/* paths are not valid - these are Replit-only
    if (isCloudRun()) {
      console.warn(`[GCS] Replit Object Storage path detected on Cloud Run: ${path}`);
      console.warn('[GCS] This path cannot be served on Cloud Run. Data migration may be needed.');
      // Try to extract uploads/ or other prefixes from the path
      const uploadsMatch = objectPath.match(/objects\/uploads\/(.+)/);
      if (uploadsMatch) {
        // Try to serve from uploads/ in GCS
        objectPath = `uploads/${uploadsMatch[1]}`;
      } else {
        return null; // Cannot serve this path on Cloud Run
      }
    } else {
      return path; // On Replit, return as-is for /objects/* route
    }
  }
  
  // Check if it's a valid GCS object path (scenarios/, videos/, personas/, uploads/)
  const validPrefixes = ['scenarios/', 'videos/', 'personas/', 'uploads/'];
  const isValidPath = validPrefixes.some(prefix => objectPath.startsWith(prefix));
  
  if (!isValidPath) {
    return path; // Return original path for non-GCS paths
  }
  
  try {
    const { url } = await getSignedUrl(objectPath);
    return url;
  } catch (error) {
    console.error(`Failed to generate signed URL for ${objectPath}:`, error);
    return path; // Return original path on error instead of null
  }
}

/**
 * Safely transform a single path to signed URL
 * Returns original path on failure instead of throwing
 */
async function safeTransformToSignedUrl(path: string): Promise<string> {
  if (!path) return path;
  try {
    const signedUrl = await transformToSignedUrl(path);
    return signedUrl || path;
  } catch (error) {
    console.error(`[GCS] Failed to generate signed URL for ${path}:`, error);
    return path; // Return original path as fallback
  }
}

/**
 * Transform a scenario object's media fields to signed URLs
 * Uses safe transformation to prevent failures from breaking scenario
 */
export async function transformScenarioMedia(scenario: any): Promise<any> {
  if (!scenario) return scenario;
  
  try {
    const [imageUrl, introVideoUrl] = await Promise.all([
      safeTransformToSignedUrl(scenario.image || ''),
      safeTransformToSignedUrl(scenario.introVideoUrl || '')
    ]);
    
    return {
      ...scenario,
      image: imageUrl || scenario.image,
      introVideoUrl: introVideoUrl || scenario.introVideoUrl
    };
  } catch (error) {
    console.error(`[GCS] Failed to transform scenario media for ${scenario?.id || 'unknown'}:`, error);
    return scenario; // Return original scenario on failure
  }
}

/**
 * Transform multiple scenarios' media fields to signed URLs
 * Uses Promise.allSettled for partial failure tolerance
 */
export async function transformScenariosMedia(scenarios: any[]): Promise<any[]> {
  if (!scenarios || !Array.isArray(scenarios)) return scenarios;
  
  // Use Promise.allSettled for partial failure tolerance
  const results = await Promise.allSettled(
    scenarios.map(scenario => transformScenarioMedia(scenario))
  );
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`[GCS] Scenario media transform failed:`, result.reason);
      return scenarios[index]; // Return original on failure
    }
  });
}

/**
 * Transform persona images object to signed URLs
 * Handles the nested structure: images.male.expressions, images.female.expressions
 * Uses safe transformation to prevent single image failures from breaking entire persona
 */
export async function transformPersonaImages(images: any): Promise<any> {
  if (!images || !isGCSAvailable()) return images;
  
  const result: any = { ...images };
  
  // Transform male expressions with safe error handling
  if (images.male?.expressions) {
    const maleExpressions: Record<string, string> = {};
    for (const [emotion, path] of Object.entries(images.male.expressions)) {
      if (typeof path === 'string') {
        maleExpressions[emotion] = await safeTransformToSignedUrl(path);
      }
    }
    result.male = { ...images.male, expressions: maleExpressions };
  }
  
  // Transform female expressions with safe error handling
  if (images.female?.expressions) {
    const femaleExpressions: Record<string, string> = {};
    for (const [emotion, path] of Object.entries(images.female.expressions)) {
      if (typeof path === 'string') {
        femaleExpressions[emotion] = await safeTransformToSignedUrl(path);
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
  
  try {
    const transformedImages = await transformPersonaImages(persona.images);
    
    return {
      ...persona,
      images: transformedImages
    };
  } catch (error) {
    console.error(`[GCS] Failed to transform persona media for ${persona?.id || 'unknown'}:`, error);
    return persona; // Return original persona on failure
  }
}

/**
 * Transform multiple personas' image fields to signed URLs
 * Uses safe transformation to prevent single persona failure from breaking entire list
 */
export async function transformPersonasMedia(personas: any[]): Promise<any[]> {
  if (!personas || !Array.isArray(personas)) return personas;
  
  // Use Promise.allSettled for partial failure tolerance
  const results = await Promise.allSettled(
    personas.map(persona => transformPersonaMedia(persona))
  );
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`[GCS] Persona media transform failed:`, result.reason);
      return personas[index]; // Return original on failure
    }
  });
}

/**
 * List files in storage (GCS or Replit Object Storage) with given prefix
 */
export async function listGCSFiles(prefix: string): Promise<{ name: string; signedUrl: string; updatedAt: Date }[]> {
  // If GCS is available, use it
  if (isGCSAvailable()) {
    try {
      const bucketName = getGCSBucketName();
      const storage = getStorageClient();
      const bucket = storage.bucket(bucketName);

      const [files] = await bucket.getFiles({ prefix });

      const results: { name: string; signedUrl: string; updatedAt: Date }[] = [];

      for (const file of files) {
        // Skip directories (files ending with /)
        if (file.name.endsWith('/')) continue;
        
        const signedUrlResult = await getSignedUrl(file.name);
        const metadata = file.metadata;
        
        results.push({
          name: file.name,
          signedUrl: signedUrlResult.url,
          updatedAt: metadata.updated ? new Date(metadata.updated) : new Date()
        });
      }

      // Sort by updatedAt descending (newest first)
      results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return results;
    } catch (error) {
      console.error('GCS 파일 목록 조회 실패:', error);
      return [];
    }
  }

  // Replit Object Storage fallback - ONLY in Replit environment, NOT on Cloud Run
  if (isCloudRun()) {
    console.error('[GCS] Cloud Run detected but GCS is not available. Check GCS_BUCKET_NAME env var.');
    return [];
  }
  
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  if (process.env.REPL_ID && privateObjectDir) {
    try {
      const { getObjectStorageClient } = await import("../replit_integrations/object_storage/objectStorage");
      const storageClient = getObjectStorageClient();
      
      // Parse the private object dir to get bucket name
      // Format: /<bucket_name>/path
      const pathParts = privateObjectDir.split('/').filter(p => p);
      if (pathParts.length < 1) {
        console.error('Invalid PRIVATE_OBJECT_DIR format');
        return [];
      }
      const bucketName = pathParts[0];
      const bucket = storageClient.bucket(bucketName);
      
      // Determine the full prefix path
      // For scenarios/, we look in the private object directory
      const basePath = pathParts.slice(1).join('/');
      const fullPrefix = basePath ? `${basePath}/${prefix}` : prefix;
      
      console.log(`📁 Replit Object Storage 파일 목록 조회: bucket=${bucketName}, prefix=${fullPrefix}`);
      
      const [files] = await bucket.getFiles({ prefix: fullPrefix });
      
      const results: { name: string; signedUrl: string; updatedAt: Date }[] = [];

      for (const file of files) {
        // Skip directories (files ending with /)
        if (file.name.endsWith('/')) continue;
        
        try {
          // Generate signed URL for the file
          const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 3600 * 1000, // 1 hour
          });
          
          const metadata = file.metadata;
          
          // Store the path relative to private object dir for consistency
          const relativePath = file.name.startsWith(basePath + '/') 
            ? file.name.substring(basePath.length + 1) 
            : file.name;
          
          results.push({
            name: relativePath,
            signedUrl: signedUrl,
            updatedAt: metadata.updated ? new Date(metadata.updated) : new Date()
          });
        } catch (signError) {
          console.error(`Signed URL 생성 실패: ${file.name}`, signError);
        }
      }

      // Sort by updatedAt descending (newest first)
      results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      console.log(`📁 Found ${results.length} files with prefix: ${prefix}`);

      return results;
    } catch (error) {
      console.error('Replit Object Storage 파일 목록 조회 실패:', error);
      return [];
    }
  }

  return [];
}
