import { Router } from "express";
import multer from "multer";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { z } from "zod";

const createSchema = z.object({
  context: z.string().optional().nullable(),
  transcript: z.string().min(1, "Transcript is required"),
  score: z.number().int().min(1).max(10),
  rationale: z.string().min(1, "Rationale is required"),
  isActive: z.boolean().optional().default(true),
});

const strictScoreString = z.string().refine(
  (v) => /^\s*-?\d+\s*$/.test(v),
  { message: "Score must be a whole number (e.g. 7)" }
).transform((v) => parseInt(v.trim(), 10));

const bulkRowSchema = z.object({
  context: z.string().optional().nullable(),
  transcript: z.string().min(1, "Transcript is required"),
  score: z
    .union([z.number(), strictScoreString])
    .pipe(z.number().int().min(1, "Score must be at least 1").max(10, "Score must be at most 10")),
  rationale: z.string().min(1, "Rationale is required"),
});

const patchSchema = z.object({
  context: z.string().optional().nullable(),
  transcript: z.string().min(1).optional(),
  score: z.number().int().min(1).max(10).optional(),
  rationale: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted for multipart uploads"));
    }
  },
});

function parseCsvBuffer(buf: Buffer): Record<string, string>[] {
  const text = buf.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header row and at least one data row");

  const parseRow = (line: string): string[] => {
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === "," && !inQuote) {
        cols.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols;
  };

  const headers = parseRow(lines[0]).map((h) => h.trim().toLowerCase());
  const need = ["transcript", "score", "rationale"];
  const missing = need.filter((h) => !headers.includes(h));
  if (missing.length > 0) throw new Error(`CSV missing required columns: ${missing.join(", ")}`);

  return lines.slice(1).map((line) => {
    const cols = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i]?.trim() ?? ""; });
    return row;
  });
}

async function processBulkRows(
  dimensionId: string,
  rows: unknown[]
): Promise<{ created: number; errors: { row: number; message: string }[] }> {
  if (rows.length === 0) throw createHttpError(400, "Import data must not be empty");
  if (rows.length > 500) throw createHttpError(400, "Maximum 500 rows per import");

  const created: unknown[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = bulkRowSchema.safeParse(rows[i]);
    if (!result.success) {
      errors.push({ row: i + 1, message: result.error.errors.map((e) => e.message).join("; ") });
      continue;
    }
    const { context, transcript, score, rationale } = result.data;
    const example = await storage.createFewShotExample({
      dimensionId,
      context: context ?? null,
      transcript,
      score,
      rationale,
      isActive: true,
    });
    created.push(example);
  }

  return { created: created.length, errors };
}

export default function createFewShotExamplesRouter(isAuthenticated: any) {
  const router = Router();

  router.get(
    "/api/evaluation-dimensions/:dimensionId/few-shot-examples",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { dimensionId } = req.params;
      const dimension = await storage.getEvaluationDimension(dimensionId);
      if (!dimension) throw createHttpError(404, "Dimension not found");
      const examples = await storage.getFewShotExamplesByDimension(dimensionId);
      res.json(examples);
    })
  );

  router.post(
    "/api/evaluation-dimensions/:dimensionId/few-shot-examples",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { dimensionId } = req.params;
      const dimension = await storage.getEvaluationDimension(dimensionId);
      if (!dimension) throw createHttpError(404, "Dimension not found");
      const body = createSchema.parse(req.body);
      const example = await storage.createFewShotExample({
        dimensionId,
        context: body.context ?? null,
        transcript: body.transcript,
        score: body.score,
        rationale: body.rationale,
        isActive: body.isActive ?? true,
      });
      res.status(201).json(example);
    })
  );

  router.post(
    "/api/evaluation-dimensions/:dimensionId/few-shot-examples/bulk",
    isAuthenticated,
    isOperatorOrAdmin,
    (req, res, next) => {
      const ct = req.headers["content-type"] ?? "";
      if (ct.includes("multipart/form-data")) {
        upload.single("file")(req, res, next);
      } else {
        next();
      }
    },
    asyncHandler(async (req, res) => {
      const { dimensionId } = req.params;
      const dimension = await storage.getEvaluationDimension(dimensionId);
      if (!dimension) throw createHttpError(404, "Dimension not found");

      const ct = req.headers["content-type"] ?? "";

      let rows: unknown[];
      if (ct.includes("multipart/form-data")) {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) throw createHttpError(400, "multipart/form-data request must include a 'file' field containing a CSV");
        rows = parseCsvBuffer(file.buffer);
      } else {
        const body = req.body;
        if (!Array.isArray(body)) throw createHttpError(400, "Request body must be a JSON array");
        rows = body;
      }

      const result = await processBulkRows(dimensionId, rows);
      res.status(201).json(result);
    })
  );

  router.patch(
    "/api/few-shot-examples/:id",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const patch = patchSchema.parse(req.body);
      const updated = await storage.updateFewShotExample(id, patch);
      res.json(updated);
    })
  );

  router.delete(
    "/api/few-shot-examples/:id",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      await storage.deleteFewShotExample(req.params.id);
      res.json({ ok: true });
    })
  );

  return router;
}
