import { Storage } from "@google-cloud/storage";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";

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
  contentType: string
): Promise<string> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  await file.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectPath}`;
  console.log(`📁 GCS 업로드 완료: ${publicUrl}`);
  
  return publicUrl;
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
