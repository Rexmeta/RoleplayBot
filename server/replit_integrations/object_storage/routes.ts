import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { isCloudRun, streamFromGCS, isGCSAvailable } from "../../services/gcsStorage";

const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

/**
 * Register object storage routes for file uploads.
 *
 * DUAL ENVIRONMENT SUPPORT:
 * - Replit: Uses Replit Object Storage (127.0.0.1:1106 sidecar)
 * - Cloud Run: Serves files directly from GCS bucket via streamFromGCS
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 */
export function registerObjectStorageRoutes(app: Express): void {
  // Cloud Run: Serve /objects/* from GCS instead of Replit sidecar
  if (isCloudRun()) {
    console.log('[Object Storage Routes] Cloud Run detected - serving /objects/* from GCS');
    
    if (!GCS_BUCKET_NAME) {
      console.error('[Object Storage Routes] WARNING: GCS_BUCKET_NAME not set!');
      console.error('[Object Storage Routes] /objects/* requests will fail');
    } else {
      console.log(`[Object Storage Routes] GCS bucket: ${GCS_BUCKET_NAME}`);
    }
    
    // Serve objects from GCS on Cloud Run using the shared streaming function
    // Support both GET and HEAD for media playback compatibility
    app.get("/objects/*", async (req, res) => {
      console.log(`[Object Storage] GET from GCS: ${req.path}`);
      await streamFromGCS(req.path, res);
    });
    
    app.head("/objects/*", async (req, res) => {
      // HEAD request - return metadata only without streaming content
      console.log(`[Object Storage] HEAD from GCS: ${req.path}`);
      await streamFromGCS(req.path, res, true); // headOnly = true
    });
    
    // Upload endpoint - presigned URLs are Replit-specific
    // On Cloud Run, uploads go through server-side routes (e.g., image generation, MediaStorageService)
    app.post("/api/uploads/request-url", (req, res) => {
      console.log('[Object Storage] Upload request on Cloud Run - presigned URLs not available');
      return res.status(400).json({
        error: "Presigned URLs not available on Cloud Run",
        message: "File uploads are handled server-side on Cloud Run. Use the appropriate API endpoint for your upload type.",
        hint: "For images, the server generates and uploads them directly via the image generation API."
      });
    });
    
    return; // Don't register Replit-specific routes
  }

  // Replit: Use the sidecar-based Object Storage
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * This serves files from object storage. For public files, no auth needed.
   * For protected files, add authentication middleware and ACL checks.
   */
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

