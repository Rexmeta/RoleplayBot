import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError, SidecarUnavailableError, isSidecarAvailable } from "./objectStorage";
import { isCloudRun, streamFromGCS, isGCSAvailable, downloadBufferFromGCS, downloadBufferWithMetaFromGCS, listGCSFilesMeta } from "../../services/gcsStorage";
import { isAuthenticated } from "../../auth";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

/**
 * Write-through cache: after serving a key from GCS, copy it into Replit OS
 * in the background so future requests are served locally without GCS fallback.
 * Fire-and-forget — errors are logged but never bubble up to the caller.
 * Uses the actual contentType from GCS metadata rather than extension-based inference.
 */
async function writeThroughToReplitOS(key: string): Promise<void> {
  try {
    const svc = new ObjectStorageService();
    const alreadyExists = await svc.publicObjectExists(key).catch(() => false);
    if (alreadyExists) return;

    const result = await downloadBufferWithMetaFromGCS(key);
    if (!result) {
      console.warn(`[GCS→OS] Write-through: could not download buffer for key="${key}"`);
      return;
    }

    await svc.uploadPublicObject(key, result.buffer, result.contentType);
    console.log(`[GCS→OS] Write-through sync complete: "${key}" (${result.buffer.length} bytes, ${result.contentType} → Replit OS)`);
  } catch (err: any) {
    console.warn(`[GCS→OS] Write-through sync failed for key="${key}": ${err.message}`);
  }
}

export function registerObjectStorageRoutes(app: Express): void {
  // ── /objects?key= query-based serving (works on BOTH environments) ──
  app.get("/objects", async (req, res) => {
    const rawKey = String(req.query.key || "");
    if (!rawKey) {
      return res.status(400).json({ error: "Missing 'key' query parameter" });
    }

    const key = decodeURIComponent(rawKey).split("?")[0];

    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Invalid key" });
    }

    if (isCloudRun()) {
      await streamFromGCS(key, res);
    } else {
      try {
        const svc = new ObjectStorageService();
        const file = await svc.searchPublicObject(key);
        if (!file) {
          if (isGCSAvailable()) {
            console.log(`[Object Storage] Replit OS miss → GCS fallback for key="${key}"`);
            const served = await streamFromGCS(key, res);
            if (served) {
              writeThroughToReplitOS(key).catch(() => {});
            }
            return;
          }
          console.warn(`[Object Storage] Key not found: "${key}"`);
          return res.status(404).json({ error: "Object not found", key });
        }
        await svc.downloadObject(file, res);
      } catch (error) {
        if (error instanceof SidecarUnavailableError) {
          console.error(`[Object Storage] Sidecar unavailable for key="${key}":`, error.message);
          return res.status(503).json({
            error: "Storage service temporarily unavailable",
            message: "The file storage backend is not reachable. Please try again later.",
            key,
          });
        }
        console.error(`[Object Storage] GET /objects?key=${key} error:`, error);
        return res.status(500).json({ error: "Failed to serve object" });
      }
    }
  });

  app.head("/objects", async (req, res) => {
    const rawKey = String(req.query.key || "");
    if (!rawKey) {
      return res.status(400).json({ error: "Missing 'key' query parameter" });
    }

    const key = decodeURIComponent(rawKey).split("?")[0];

    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Invalid key" });
    }

    if (isCloudRun()) {
      await streamFromGCS(key, res, true);
    } else {
      try {
        const svc = new ObjectStorageService();
        const file = await svc.searchPublicObject(key);
        if (!file) {
          if (isGCSAvailable()) {
            console.log(`[Object Storage] Replit OS miss → GCS fallback (HEAD) for key="${key}"`);
            return await streamFromGCS(key, res, true);
          }
          return res.status(404).json({ error: "Object not found", key });
        }
        const [metadata] = await file.getMetadata();
        res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
        if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.status(200).end();
      } catch (error) {
        if (error instanceof SidecarUnavailableError) {
          console.error(`[Object Storage] Sidecar unavailable (HEAD) key="${key}":`, error.message);
          return res.status(503).end();
        }
        console.error("[Object Storage] HEAD /objects?key= error:", error);
        return res.status(500).json({ error: "Failed to serve object" });
      }
    }
  });

  app.get("/api/storage/health", async (_req, res) => {
    const available = await isSidecarAvailable();
    const envInfo: Record<string, any> = {
      sidecar: available ? "connected" : "unavailable",
      environment: isCloudRun() ? "cloud_run" : "replit",
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || "(not set)",
      replId: process.env.REPL_ID ? "SET" : "NOT SET",
      replitDeployment: process.env.REPLIT_DEPLOYMENT || "(not set)",
      publicSearchPaths: process.env.PUBLIC_OBJECT_SEARCH_PATHS ? "SET" : "NOT SET",
      privateObjectDir: process.env.PRIVATE_OBJECT_DIR ? "SET" : "NOT SET",
    };

    if (available && !isCloudRun()) {
      try {
        const svc = new ObjectStorageService();
        const paths = svc.getPublicObjectSearchPaths();
        envInfo.searchPaths = paths;

        const testKey = "scenarios/test-probe.webp";
        const testResult = await svc.searchPublicObject(testKey);
        envInfo.probeResult = testResult ? "found" : "not_found (expected for test file)";
        envInfo.storageAccessible = true;
      } catch (err: any) {
        envInfo.storageAccessible = false;
        envInfo.storageError = err.message;
      }
    }

    res.json(envInfo);
  });

  app.get("/api/storage/test-image", async (req, res) => {
    const key = String(req.query.key || "");
    if (!key) {
      return res.status(400).json({ error: "Usage: /api/storage/test-image?key=scenarios/filename.webp" });
    }

    const result: Record<string, any> = { key, steps: [] };

    try {
      result.steps.push("1. checking sidecar health...");
      const available = await isSidecarAvailable();
      result.sidecarAvailable = available;

      if (!available) {
        result.steps.push("FAILED: sidecar not available");
        return res.json(result);
      }

      result.steps.push("2. creating ObjectStorageService...");
      const svc = new ObjectStorageService();
      const paths = svc.getPublicObjectSearchPaths();
      result.searchPaths = paths;

      result.steps.push(`3. searching for key in ${paths.length} search path(s)...`);
      const file = await svc.searchPublicObject(key);
      result.fileFound = !!file;

      if (file) {
        result.steps.push("4. getting file metadata...");
        const [metadata] = await file.getMetadata();
        result.metadata = {
          contentType: metadata.contentType,
          size: metadata.size,
          updated: metadata.updated,
        };
        result.steps.push("SUCCESS: file is accessible");
      } else {
        result.steps.push("FAILED: file not found in any search path");
      }
    } catch (err: any) {
      result.error = err.message;
      result.errorName = err.name;
      result.steps.push(`ERROR: ${err.name}: ${err.message}`);
    }

    res.json(result);
  });

  // ── Admin: GCS → Replit OS bulk sync ──

  function requireAdminRole(req: any, res: any, next: any) {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }
    next();
  }

  /**
   * POST /api/admin/storage/sync-gcs-to-replit
   * Body: { prefixes?: string[] }  (default: ["scenarios/videos/"])
   *
   * Lists all GCS objects under the given prefixes, checks each against
   * Replit OS, and copies any that are missing.  Returns a summary of what
   * was synced so operators can audit the log.
   */
  app.post("/api/admin/storage/sync-gcs-to-replit", isAuthenticated, requireAdminRole, async (req, res) => {
    if (isCloudRun()) {
      return res.status(400).json({ error: "Sync not applicable on Cloud Run (GCS is primary storage there)" });
    }
    if (!isGCSAvailable()) {
      return res.status(400).json({ error: "GCS is not available — set GCS_BUCKET_NAME and credentials first" });
    }

    const prefixes: string[] = Array.isArray(req.body?.prefixes)
      ? req.body.prefixes.filter((p: any) => typeof p === 'string')
      : ['scenarios/videos/'];

    const report: { synced: string[]; skipped: string[]; failed: string[] } = {
      synced: [],
      skipped: [],
      failed: [],
    };

    let svc: ObjectStorageService | null = null;
    try {
      svc = new ObjectStorageService();
    } catch (err: any) {
      return res.status(503).json({ error: `Replit Object Storage unavailable: ${err.message}` });
    }

    for (const prefix of prefixes) {
      const files = await listGCSFilesMeta(prefix);
      console.log(`[GCS→OS Sync] Found ${files.length} GCS object(s) under prefix "${prefix}"`);

      for (const gcsFile of files) {
        const key = gcsFile.name;
        try {
          const exists = await svc!.publicObjectExists(key).catch(() => false);
          if (exists) {
            report.skipped.push(key);
            continue;
          }

          const buffer = await downloadBufferFromGCS(key);
          if (!buffer) {
            console.warn(`[GCS→OS Sync] Could not download "${key}" from GCS`);
            report.failed.push(key);
            continue;
          }

          await svc!.uploadPublicObject(key, buffer, gcsFile.contentType);
          console.log(`[GCS→OS Sync] ✓ Synced "${key}" (${buffer.length} bytes)`);
          report.synced.push(key);
        } catch (err: any) {
          console.error(`[GCS→OS Sync] ✗ Failed "${key}": ${err.message}`);
          report.failed.push(key);
        }
      }
    }

    console.log(`[GCS→OS Sync] Complete — synced: ${report.synced.length}, skipped: ${report.skipped.length}, failed: ${report.failed.length}`);
    res.json({
      message: "GCS → Replit OS sync complete",
      prefixes,
      syncedCount: report.synced.length,
      skippedCount: report.skipped.length,
      failedCount: report.failed.length,
      synced: report.synced,
      skipped: report.skipped,
      failed: report.failed,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/admin/storage/sync-gcs-to-replit?prefix=scenarios/videos/
   * Dry-run: lists what would be synced without actually copying anything.
   */
  app.get("/api/admin/storage/sync-gcs-to-replit", isAuthenticated, requireAdminRole, async (req, res) => {
    if (isCloudRun()) {
      return res.status(400).json({ error: "Sync not applicable on Cloud Run" });
    }

    const prefix = String(req.query.prefix || 'scenarios/videos/');

    let svc: ObjectStorageService | null = null;
    try {
      svc = new ObjectStorageService();
    } catch (err: any) {
      return res.status(503).json({ error: `Replit Object Storage unavailable: ${err.message}` });
    }

    const gcsFiles = isGCSAvailable() ? await listGCSFilesMeta(prefix) : [];
    const results = await Promise.allSettled(
      gcsFiles.map(async (f) => {
        const inReplitOS = await svc!.publicObjectExists(f.name).catch(() => false);
        return { key: f.name, sizeBytes: f.size, contentType: f.contentType, inReplitOS };
      })
    );

    const items = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    res.json({
      prefix,
      gcsTotal: gcsFiles.length,
      inReplitOS: items.filter((i) => i.inReplitOS).length,
      missing: items.filter((i) => !i.inReplitOS).length,
      items,
      timestamp: new Date().toISOString(),
    });
  });

  // ── /api/objects/resolve – legacy UUID resolver ──
  app.get("/api/objects/resolve", async (req, res) => {
    const id = String(req.query.id || "");
    if (!id) {
      return res.status(400).json({ error: "Missing 'id' query parameter" });
    }

    try {
      const { storage } = await import("../../storage");

      const allScenarios = await storage.getAllScenarios();
      for (const s of allScenarios) {
        if (s.image && s.image.includes(id) && !s.image.startsWith("/objects/uploads/")) {
          return res.redirect(302, `/objects?key=${encodeURIComponent(s.image)}`);
        }
        if ((s as any).introVideoUrl && (s as any).introVideoUrl.includes(id) && !(s as any).introVideoUrl.startsWith("/objects/uploads/")) {
          return res.redirect(302, `/objects?key=${encodeURIComponent((s as any).introVideoUrl)}`);
        }
      }

      return res.status(404).json({
        error: "Could not resolve legacy UUID",
        id,
        hint: "This upload may no longer exist. The system now uses key-based storage paths."
      });
    } catch (error) {
      console.error("[Object Storage] /api/objects/resolve error:", error);
      return res.status(500).json({ error: "Failed to resolve object" });
    }
  });

  // ── Cloud Run: /objects/* path-based serving from GCS ──
  if (isCloudRun()) {
    console.log('[Object Storage Routes] Cloud Run detected - serving /objects/* from GCS');
    
    if (!GCS_BUCKET_NAME) {
      console.error('[Object Storage Routes] WARNING: GCS_BUCKET_NAME not set!');
    } else {
      console.log(`[Object Storage Routes] GCS bucket: ${GCS_BUCKET_NAME}`);
    }
    
    app.get("/objects/*", async (req, res) => {
      console.log(`[Object Storage] GET from GCS: ${req.path}`);
      await streamFromGCS(req.path, res);
    });
    
    app.head("/objects/*", async (req, res) => {
      console.log(`[Object Storage] HEAD from GCS: ${req.path}`);
      await streamFromGCS(req.path, res, true);
    });
    
    app.post("/api/uploads/request-url", (req, res) => {
      return res.status(400).json({
        error: "Presigned URLs not available on Cloud Run",
        message: "File uploads are handled server-side on Cloud Run.",
      });
    });
    
    return;
  }

  // ── Replit: sidecar-based Object Storage ──
  const objectStorageService = new ObjectStorageService();

  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      });
    } catch (error) {
      if (error instanceof SidecarUnavailableError) {
        console.error("[Object Storage] Sidecar unavailable for upload URL:", error.message);
        return res.status(503).json({ error: "Storage service temporarily unavailable" });
      }
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof SidecarUnavailableError) {
        console.error("[Object Storage] Sidecar unavailable for path:", req.path, error.message);
        return res.status(503).json({ error: "Storage service temporarily unavailable" });
      }
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
