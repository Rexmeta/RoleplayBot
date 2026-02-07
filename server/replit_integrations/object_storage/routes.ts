import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError, SidecarUnavailableError, isSidecarAvailable } from "./objectStorage";
import { isCloudRun, streamFromGCS, isGCSAvailable } from "../../services/gcsStorage";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

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
        console.log(`[Object Storage] Serving key="${key}" via sidecar`);
        const svc = new ObjectStorageService();
        const file = await svc.searchPublicObject(key);
        if (!file) {
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
