import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { isCloudRun } from "../../services/gcsStorage";

/**
 * Register object storage routes for file uploads.
 *
 * IMPORTANT: These routes are for Replit Object Storage ONLY.
 * On Cloud Run/GCS, these routes return errors - use GCS Signed URLs instead.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  // Skip registration entirely on Cloud Run - these routes are Replit-only
  if (isCloudRun()) {
    console.log('[Object Storage Routes] Cloud Run detected - Replit Object Storage routes DISABLED');
    console.log('[Object Storage Routes] Use GCS Signed URLs instead of /objects/* paths');
    
    // Register error handlers for /objects/* on Cloud Run
    app.all("/objects/*", (req, res) => {
      console.error(`[Object Storage] Blocked Replit path on Cloud Run: ${req.path}`);
      return res.status(400).json({
        error: "Replit Object Storage not available on Cloud Run",
        message: "Use GCS Signed URLs instead of /objects/* paths",
        hint: "Check that your image/video URLs are GCS Signed URLs, not /objects/ paths"
      });
    });
    
    app.post("/api/uploads/request-url", (req, res) => {
      console.error('[Object Storage] Blocked Replit upload request on Cloud Run');
      return res.status(400).json({
        error: "Replit Object Storage not available on Cloud Run",
        message: "Use GCS upload endpoints instead"
      });
    });
    
    return; // Don't register Replit-specific routes
  }

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

