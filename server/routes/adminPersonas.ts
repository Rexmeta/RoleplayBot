import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { transformPersonasMedia, transformPersonaMedia } from "../services/gcsStorage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createAdminPersonasRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const [personas, allLocaleRows] = await Promise.all([
      fileManager.getAllMBTIPersonas(),
      storage.getAllPersonaTranslationLocales(),
    ]);

    const localeMap = new Map<string, Array<{ locale: string; isMachineTranslated: boolean; isReviewed: boolean }>>();
    for (const row of allLocaleRows) {
      if (!localeMap.has(row.personaId)) localeMap.set(row.personaId, []);
      localeMap.get(row.personaId)!.push({ locale: row.locale, isMachineTranslated: row.isMachineTranslated, isReviewed: row.isReviewed });
    }

    const personasWithLocales = (personas as any[]).map(p => ({
      ...p,
      _translationLocales: localeMap.get(p.id) || [],
    }));

    const transformedPersonas = await transformPersonasMedia(personasWithLocales);
    res.json(transformedPersonas);
  }));

  router.post("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const persona = await fileManager.createMBTIPersona(req.body);
    const transformedPersona = await transformPersonaMedia(persona);
    res.json(transformedPersona);
  }));

  router.put("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const persona = await fileManager.updateMBTIPersona(req.params.id, req.body);
    const transformedPersona = await transformPersonaMedia(persona);
    res.json(transformedPersona);
  }));

  router.delete("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const personaId = req.params.id;

    const scenarios = await fileManager.getAllScenarios();
    const connectedScenarios = (scenarios as any[]).filter(scenario =>
      scenario.personas.includes(personaId)
    );

    if (connectedScenarios.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete persona with connected scenarios"), {
        connectedScenarios: connectedScenarios.map(s => ({ id: s.id, title: s.title }))
      });
    }

    await fileManager.deleteMBTIPersona(personaId);
    res.json({ success: true });
  }));

  return router;
}
