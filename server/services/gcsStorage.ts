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

  const gcsPath = `gcs://${objectPath}`;
  console.log(`📁 GCS 비공개 업로드 완료: ${gcsPath}`);
  return gcsPath;
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
