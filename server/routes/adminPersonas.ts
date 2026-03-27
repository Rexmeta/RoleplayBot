import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { transformPersonasMedia, transformPersonaMedia } from "../services/gcsStorage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";

export default function createAdminPersonasRouter(isAuthenticated: any) {
  const router = Router();

  // 페르소나 관리 API
  router.get("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const personas = await fileManager.getAllMBTIPersonas();
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersonas = await transformPersonasMedia(personas);
      res.json(transformedPersonas);
    } catch (error) {
      console.error("Error getting MBTI personas:", error);
      res.status(500).json({ error: "Failed to get MBTI personas" });
    }
  });

  router.post("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const persona = await fileManager.createMBTIPersona(req.body);
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersona = await transformPersonaMedia(persona);
      res.json(transformedPersona);
    } catch (error) {
      console.error("Error creating MBTI persona:", error);
      res.status(500).json({ error: "Failed to create MBTI persona" });
    }
  });

  router.put("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const persona = await fileManager.updateMBTIPersona(req.params.id, req.body);
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersona = await transformPersonaMedia(persona);
      res.json(transformedPersona);
    } catch (error) {
      console.error("Error updating MBTI persona:", error);
      res.status(500).json({ error: "Failed to update MBTI persona" });
    }
  });

  router.delete("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const personaId = req.params.id;
      
      // 연결된 시나리오 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = (scenarios as any[]).filter(scenario => 
        scenario.personas.includes(personaId)
      );
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete persona with connected scenarios",
          connectedScenarios: connectedScenarios.map(s => ({ id: s.id, title: s.title }))
        });
      }
      
      await fileManager.deleteMBTIPersona(personaId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting persona:", error);
      res.status(500).json({ error: "Failed to delete persona" });
    }
  });

  return router;
}
