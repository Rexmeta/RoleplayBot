import { Storage } from "@google-cloud/storage";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { scenarios, mbtiPersonas } from "../../shared/schema";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const GCS_SERVICE_ACCOUNT_KEY = process.env.GCS_SERVICE_ACCOUNT_KEY;

if (!GCS_BUCKET_NAME) {
  console.error("❌ GCS_BUCKET_NAME is not set. Cannot sync to GCS.");
  process.exit(1);
}

function getGCSClient(): Storage {
  if (GCS_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials = JSON.parse(GCS_SERVICE_ACCOUNT_KEY);
      return new Storage({ projectId: credentials.project_id, credentials });
    } catch {
      console.error("Failed to parse GCS_SERVICE_ACCOUNT_KEY, using default credentials");
    }
  }
  return new Storage();
}

async function getReplitOSClient() {
  try {
    const module = await import("../replit_integrations/object_storage");
    return module.getObjectStorageClient();
  } catch {
    console.error("❌ Replit Object Storage not available");
    return null;
  }
}

function getReplitSearchPaths(): { bucketName: string; objectPrefix: string }[] {
  const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
  return pathsStr
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const fullPath = p.startsWith("/") ? p.slice(1) : p;
      const parts = fullPath.split("/");
      return {
        bucketName: parts[0],
        objectPrefix: parts.slice(1).join("/"),
      };
    });
}

async function downloadFromReplitOS(replitClient: any, objectKey: string): Promise<Buffer | null> {
  const searchPaths = getReplitSearchPaths();

  for (const { bucketName, objectPrefix } of searchPaths) {
    const objectName = objectPrefix ? `${objectPrefix}/${objectKey}` : objectKey;
    try {
      const file = replitClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        const [buffer] = await file.download();
        return buffer;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function checkGCSExists(gcsStorage: Storage, objectKey: string): Promise<boolean> {
  try {
    const file = gcsStorage.bucket(GCS_BUCKET_NAME!).file(objectKey);
    const [exists] = await file.exists();
    return exists;
  } catch {
    return false;
  }
}

async function uploadToGCS(gcsStorage: Storage, buffer: Buffer, objectKey: string, contentType: string): Promise<boolean> {
  try {
    const file = gcsStorage.bucket(GCS_BUCKET_NAME!).file(objectKey);
    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: { cacheControl: "public, max-age=31536000" },
    });
    return true;
  } catch (error) {
    console.error(`  ❌ Upload failed: ${objectKey}`, error);
    return false;
  }
}

function getContentType(key: string): string {
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".webm")) return "video/webm";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function isValidMediaKey(key: string | null | undefined): key is string {
  if (!key) return false;
  if (key.startsWith("http://") || key.startsWith("https://")) return false;
  if (key.startsWith("/objects/uploads/")) return false;
  if (key.startsWith("data:")) return false;
  const validPrefixes = ["scenarios/", "videos/", "personas/", "uploads/"];
  return validPrefixes.some((prefix) => key.startsWith(prefix));
}

function createDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  return { db: drizzle(pool), pool };
}

async function collectMediaKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const { db, pool } = createDb();

  console.log("📋 Collecting media keys from database...");

  try {
    const allScenarios = await db.select().from(scenarios);
    console.log(`  Found ${allScenarios.length} scenarios`);

    for (const s of allScenarios) {
      const imageKey = s.image?.split("?")[0];
      if (isValidMediaKey(imageKey)) keys.add(imageKey);

      const videoKey = (s as any).introVideoUrl?.split("?")[0];
      if (isValidMediaKey(videoKey)) keys.add(videoKey);
    }

    const allPersonas = await db.select().from(mbtiPersonas);
    console.log(`  Found ${allPersonas.length} personas`);

    for (const p of allPersonas) {
      const images = p.images as any;
      if (!images) continue;

      for (const gender of ["male", "female"]) {
        const genderData = images[gender];
        if (!genderData?.expressions) continue;
        for (const [, path] of Object.entries(genderData.expressions)) {
          const key = (path as string)?.split("?")[0];
          if (isValidMediaKey(key)) keys.add(key);
        }
      }
    }

    console.log(`  Total unique media keys: ${keys.size}`);
  } finally {
    await pool.end();
  }
  return keys;
}

async function syncToGCS() {
  console.log("🚀 Starting Replit Object Storage → GCS sync");
  console.log(`   Target bucket: ${GCS_BUCKET_NAME}`);
  console.log("");

  const gcsStorage = getGCSClient();
  const replitClient = await getReplitOSClient();

  if (!replitClient) {
    console.error("❌ Cannot initialize Replit Object Storage client. Exiting.");
    process.exit(1);
  }

  const [bucketExists] = await gcsStorage.bucket(GCS_BUCKET_NAME!).exists();
  if (!bucketExists) {
    console.error(`❌ GCS bucket "${GCS_BUCKET_NAME}" does not exist or is not accessible.`);
    process.exit(1);
  }
  console.log(`✅ GCS bucket "${GCS_BUCKET_NAME}" is accessible`);

  const mediaKeys = await collectMediaKeys();

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;
  const total = mediaKeys.size;
  let processed = 0;

  for (const key of mediaKeys) {
    processed++;
    const progress = `[${processed}/${total}]`;

    const existsInGCS = await checkGCSExists(gcsStorage, key);
    if (existsInGCS) {
      skipped++;
      continue;
    }

    const buffer = await downloadFromReplitOS(replitClient, key);
    if (!buffer) {
      console.log(`${progress} ⚠️  Not found in Replit OS: ${key}`);
      notFound++;
      continue;
    }

    const contentType = getContentType(key);
    const success = await uploadToGCS(gcsStorage, buffer, key, contentType);
    if (success) {
      console.log(`${progress} ✅ Synced: ${key} (${(buffer.length / 1024).toFixed(0)}KB)`);
      synced++;
    } else {
      failed++;
    }
  }

  console.log("");
  console.log("========================================");
  console.log("📊 Sync Summary");
  console.log("========================================");
  console.log(`  Total keys:     ${total}`);
  console.log(`  Already in GCS: ${skipped}`);
  console.log(`  Synced:         ${synced}`);
  console.log(`  Not found:      ${notFound}`);
  console.log(`  Failed:         ${failed}`);
  console.log("========================================");

  return { total, synced, skipped, notFound, failed };
}

export { syncToGCS, collectMediaKeys, downloadFromReplitOS, checkGCSExists, getGCSClient, getReplitOSClient };

const isMainModule = process.argv[1]?.includes("syncToGCS");
if (isMainModule) {
  syncToGCS()
    .then((result) => {
      if (result.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Sync failed:", error);
      process.exit(1);
    });
}
