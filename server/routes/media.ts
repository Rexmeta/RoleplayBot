import { Router, Request, Response, NextFunction } from "express";
import { isGCSAvailable, getSignedUrl, checkFileExists } from "../services/gcsStorage";

const router = Router();

const ALLOWED_PREFIXES = ["scenarios/", "videos/", "personas/", "uploads/"];

const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  const { isAuthenticated: authCheck } = await import("../auth");
  return authCheck(req, res, next);
};

router.get("/signed-url", isAuthenticated, async (req, res) => {
  try {
    if (!isGCSAvailable()) {
      return res.status(503).json({ error: "GCS not available in this environment" });
    }

    const objectPath = String(req.query.path || "");
    
    if (!objectPath) {
      return res.status(400).json({ error: "Missing path parameter" });
    }

    if (objectPath.includes("..")) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const isAllowed = ALLOWED_PREFIXES.some(prefix => objectPath.startsWith(prefix));
    if (!isAllowed) {
      return res.status(403).json({ error: "Forbidden path" });
    }

    const { url, expiresIn } = await getSignedUrl(objectPath);
    
    res.json({ url, expiresIn });
  } catch (error: any) {
    if (error.message === "File not found") {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Signed URL error:", error);
    res.status(500).json({ error: "Failed to sign url" });
  }
});

router.get("/exists", isAuthenticated, async (req, res) => {
  try {
    if (!isGCSAvailable()) {
      return res.status(503).json({ error: "GCS not available in this environment" });
    }

    const objectPath = String(req.query.path || "");
    
    if (!objectPath || objectPath.includes("..")) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const isAllowed = ALLOWED_PREFIXES.some(prefix => objectPath.startsWith(prefix));
    if (!isAllowed) {
      return res.status(403).json({ error: "Forbidden path" });
    }

    const exists = await checkFileExists(objectPath);
    res.json({ exists });
  } catch (error) {
    console.error("File exists check error:", error);
    res.status(500).json({ error: "Failed to check file" });
  }
});

export default router;
