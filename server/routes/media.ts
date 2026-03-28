import { Router, Request, Response, NextFunction } from "express";
import { isGCSAvailable, getSignedUrl, checkFileExists } from "../services/gcsStorage";
import { asyncHandler, createHttpError } from "./routerHelpers";

const router = Router();

const ALLOWED_PREFIXES = ["scenarios/", "videos/", "personas/", "uploads/"];

const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  const { isAuthenticated: authCheck } = await import("../auth");
  return authCheck(req, res, next);
};

router.get("/signed-url", isAuthenticated, asyncHandler(async (req, res) => {
  if (!isGCSAvailable()) {
    throw createHttpError(503, "GCS not available in this environment");
  }

  const objectPath = String(req.query.path || "");

  if (!objectPath) {
    throw createHttpError(400, "Missing path parameter");
  }

  if (objectPath.includes("..")) {
    throw createHttpError(400, "Invalid path");
  }

  const isAllowed = ALLOWED_PREFIXES.some(prefix => objectPath.startsWith(prefix));
  if (!isAllowed) {
    throw createHttpError(403, "Forbidden path");
  }

  const { url, expiresIn } = await getSignedUrl(objectPath);

  res.json({ url, expiresIn });
}));

router.get("/exists", isAuthenticated, asyncHandler(async (req, res) => {
  if (!isGCSAvailable()) {
    throw createHttpError(503, "GCS not available in this environment");
  }

  const objectPath = String(req.query.path || "");

  if (!objectPath || objectPath.includes("..")) {
    throw createHttpError(400, "Invalid path");
  }

  const isAllowed = ALLOWED_PREFIXES.some(prefix => objectPath.startsWith(prefix));
  if (!isAllowed) {
    throw createHttpError(403, "Forbidden path");
  }

  const exists = await checkFileExists(objectPath);
  res.json({ exists });
}));

export default router;
