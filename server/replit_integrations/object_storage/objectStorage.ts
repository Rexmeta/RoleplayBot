import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const SIDECAR_HEALTH_CHECK_INTERVAL_MS = 30_000;
const SIDECAR_OPERATION_TIMEOUT_MS = 10_000;
const SIDECAR_MAX_RETRIES = 2;

function isCloudRunEnv(): boolean {
  const hasKService = !!process.env.K_SERVICE || !!process.env.K_REVISION;
  const isReplit = !!process.env.REPL_ID;
  return hasKService && !isReplit;
}

let objectStorageClient: Storage | null = null;
let sidecarAvailable: boolean | null = null;
let lastHealthCheck = 0;

async function checkSidecarHealth(): Promise<boolean> {
  const now = Date.now();
  if (sidecarAvailable !== null && now - lastHealthCheck < SIDECAR_HEALTH_CHECK_INTERVAL_MS) {
    return sidecarAvailable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    sidecarAvailable = res.status < 500;
    lastHealthCheck = now;
    if (!sidecarAvailable) {
      console.warn(`[ObjectStorage] Sidecar health check failed: HTTP ${res.status}`);
    }
  } catch (err: any) {
    sidecarAvailable = false;
    lastHealthCheck = now;
    console.warn(`[ObjectStorage] Sidecar unreachable: ${err.code || err.message}`);
  }

  return sidecarAvailable;
}

export async function isSidecarAvailable(): Promise<boolean> {
  if (isCloudRunEnv()) return false;
  return checkSidecarHealth();
}

export function resetSidecarStatus(): void {
  sidecarAvailable = null;
  lastHealthCheck = 0;
  objectStorageClient = null;
}

function getObjectStorageClient(): Storage {
  if (isCloudRunEnv()) {
    throw new Error(
      "Replit Object Storage is not available on Cloud Run. " +
      "Use GCS (Google Cloud Storage) directly instead. " +
      "Set GCS_BUCKET_NAME environment variable."
    );
  }
  
  if (!objectStorageClient) {
    objectStorageClient = new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
  }
  
  return objectStorageClient;
}

export { getObjectStorageClient };

export class SidecarUnavailableError extends Error {
  constructor(detail?: string) {
    super(`Replit Object Storage sidecar is unavailable${detail ? ': ' + detail : ''}`);
    this.name = "SidecarUnavailableError";
    Object.setPrototypeOf(this, SidecarUnavailableError.prototype);
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= SIDECAR_MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${SIDECAR_OPERATION_TIMEOUT_MS}ms`)), SIDECAR_OPERATION_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (err: any) {
      lastError = err;
      const isConnectionError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'EPIPE' ||
        err.message?.includes('Timeout after') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('socket hang up');

      if (isConnectionError) {
        resetSidecarStatus();
        if (attempt < SIDECAR_MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 3000);
          console.warn(`[ObjectStorage] ${label} attempt ${attempt + 1} failed (${err.code || err.message}), retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new SidecarUnavailableError(err.message);
      }

      throw err;
    }
  }
  throw lastError;
}

export class ObjectStorageService {
  constructor() {
    if (isCloudRunEnv()) {
      console.error('[ObjectStorageService] BLOCKED: Cannot use Replit Object Storage on Cloud Run');
      throw new Error(
        "ObjectStorageService is not available on Cloud Run. " +
        "Use GCS storage functions from gcsStorage.ts instead."
      );
    }
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    const available = await checkSidecarHealth();
    if (!available) {
      throw new SidecarUnavailableError('health check failed before search');
    }

    return withRetry(async () => {
      for (const searchPath of this.getPublicObjectSearchPaths()) {
        const fullPath = `${searchPath}/${filePath}`;
        const { bucketName, objectName } = parseObjectPath(fullPath);
        const bucket = getObjectStorageClient().bucket(bucketName);
        const file = bucket.file(objectName);
        const [exists] = await file.exists();
        if (exists) {
          return file;
        }
      }
      return null;
    }, `searchPublicObject(${filePath})`);
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await withRetry(
        () => file.getMetadata(),
        'getMetadata'
      );
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("[ObjectStorage] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("[ObjectStorage] Download error:", error);
      if (!res.headersSent) {
        if (error instanceof SidecarUnavailableError) {
          res.status(503).json({ error: "Storage service temporarily unavailable" });
        } else {
          res.status(500).json({ error: "Error downloading file" });
        }
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);

    return withRetry(async () => {
      const bucket = getObjectStorageClient().bucket(bucketName);
      const objectFile = bucket.file(objectName);
      const [exists] = await objectFile.exists();
      if (!exists) {
        throw new ObjectNotFoundError();
      }
      return objectFile;
    }, `getObjectEntityFile(${objectPath})`);
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  return withRetry(async () => {
    const request = {
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
    const response = await fetch(
      `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to sign object URL, errorcode: ${response.status}, ` +
          `make sure you're running on Replit`
      );
    }

    const { signed_url: signedURL } = await response.json();
    return signedURL;
  }, `signObjectURL(${objectName})`);
}
