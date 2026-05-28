import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { isSystemAdmin, isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { insertStorePackSchema, insertStoreEntitlementSchema } from "@shared/schema";
import { optionalAuth } from "../auth";
import { getUncachableStripeClient } from "../stripeClient";

export default function createStoreRouter(isAuthenticated: any) {
  const router = Router();

  // ─── Pack listing (public catalog) ────────────────────────────────────────

  // Public catalog endpoints — optional auth to provide entitlement context when logged in
  router.get("/packs", optionalAuth, asyncHandler(async (req: any, res) => {
    const packs = await storage.getActiveStorePacks();
    const user = req.user;
    const orgId = user?.assignedOrganizationId ?? user?.organizationId ?? null;

    const entitlementFlags = await Promise.all(
      packs.map(pack => storage.isOrgEntitledToPack(orgId, pack.id))
    );

    const packsWithStatus = packs.map((pack, i) => ({
      ...pack,
      isEntitled: entitlementFlags[i],
    }));

    res.json(packsWithStatus);
  }));

  router.get("/packs/:id", optionalAuth, asyncHandler(async (req: any, res) => {
    const pack = await storage.getStorePack(req.params.id);
    if (!pack || !pack.isActive) throw createHttpError(404, "Pack not found");

    const user = req.user;
    const orgId = user?.assignedOrganizationId ?? user?.organizationId ?? null;
    const isEntitled = await storage.isOrgEntitledToPack(orgId, pack.id);

    const allScenarios = await fileManager.getAllScenarios();
    const packScenarios = allScenarios
      .filter((s: any) => s.storePackId === pack.id && s.storeListed && !s.isDeleted)
      .map((s: any) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        difficulty: s.difficulty,
        image: s.image,
        estimatedTime: s.estimatedTime,
      }));

    const personas = await storage.getAllMbtiPersonas();
    const packPersonas = (personas as any[])
      .filter((p: any) => p.storePackId === pack.id && p.storeListed)
      .map((p: any) => ({
        id: p.id,
        mbti: p.mbti,
        gender: p.gender,
        communicationStyle: p.communicationStyle,
      }));

    res.json({ ...pack, isEntitled, scenarios: packScenarios, personas: packPersonas });
  }));

  // ─── Admin pack management ─────────────────────────────────────────────────

  router.get("/admin/packs", isAuthenticated, isSystemAdmin, asyncHandler(async (_req, res) => {
    const packs = await storage.getAllStorePacks();
    res.json(packs);
  }));

  router.post("/admin/packs", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const parsed = insertStorePackSchema.safeParse(req.body);
    if (!parsed.success) throw createHttpError(400, parsed.error.message);
    const pack = await storage.createStorePack(parsed.data);
    res.status(201).json(pack);
  }));

  router.put("/admin/packs/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const existing = await storage.getStorePack(req.params.id);
    if (!existing) throw createHttpError(404, "Pack not found");
    const pack = await storage.updateStorePack(req.params.id, req.body);
    res.json(pack);
  }));

  router.delete("/admin/packs/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const existing = await storage.getStorePack(req.params.id);
    if (!existing) throw createHttpError(404, "Pack not found");
    await storage.deleteStorePack(req.params.id);
    res.json({ success: true });
  }));

  // ─── Entitlements ──────────────────────────────────────────────────────────

  router.get("/entitlements", isAuthenticated, isSystemAdmin, asyncHandler(async (_req, res) => {
    const entitlements = await storage.getAllStoreEntitlements();
    res.json(entitlements);
  }));

  router.post("/entitlements", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { orgId, packId } = req.body;
    if (!orgId || !packId) throw createHttpError(400, "orgId and packId are required");

    const pack = await storage.getStorePack(packId);
    if (!pack) throw createHttpError(404, "Pack not found");

    const entitlement = await storage.grantEntitlement({
      orgId,
      packId,
      unlockedBy: req.user?.id ?? null,
    });
    res.status(201).json(entitlement);
  }));

  router.delete("/entitlements", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { orgId, packId } = req.body;
    if (!orgId || !packId) throw createHttpError(400, "orgId and packId are required");
    await storage.revokeEntitlement(orgId, packId);
    res.json({ success: true });
  }));

  router.delete("/admin/entitlements/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const entitlement = await storage.getEntitlementById(req.params.id);
    if (!entitlement) throw createHttpError(404, "Entitlement not found");

    const issueRefund = req.query.refund === "true";
    let stripeRefundId: string | null = null;

    if (issueRefund && entitlement.stripeChargeId) {
      try {
        const stripe = await getUncachableStripeClient();
        const refund = await stripe.refunds.create({ charge: entitlement.stripeChargeId });
        stripeRefundId = refund.id;
      } catch (err: any) {
        throw createHttpError(502, `Stripe refund failed: ${err?.message ?? "unknown error"}`);
      }
    }

    await storage.revokeEntitlementById(req.params.id);
    res.json({ success: true, stripeRefundId });
  }));

  // ─── Stripe checkout ───────────────────────────────────────────────────────

  router.post("/packs/:id/checkout", isAuthenticated, asyncHandler(async (req: any, res) => {
    const pack = await storage.getStorePack(req.params.id);
    if (!pack || !pack.isActive) throw createHttpError(404, "Pack not found");
    if (pack.priceUsd <= 0) throw createHttpError(400, "This pack is free — no checkout needed");

    const user = req.user;
    const orgId = user?.assignedOrganizationId ?? user?.organizationId ?? null;
    if (!orgId) throw createHttpError(400, "No organization associated with your account");

    const alreadyEntitled = await storage.isOrgEntitledToPack(orgId, pack.id);
    if (alreadyEntitled) throw createHttpError(400, "Your organization already has access to this pack");

    const stripe = await getUncachableStripeClient();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(pack.priceUsd * 100),
          product_data: {
            name: pack.name,
            description: pack.description || undefined,
          },
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${baseUrl}/store?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/store?payment=cancelled`,
      metadata: {
        packId: pack.id,
        orgId,
        unlockedBy: user?.id ?? '',
      },
    });

    res.json({ url: session.url });
  }));

  // ─── My library (org-scoped entitlements) ─────────────────────────────────

  router.get("/my-library", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = user?.assignedOrganizationId ?? user?.organizationId ?? null;
    if (!orgId) return res.json([]);

    const [entitlements, packs] = await Promise.all([
      storage.getStoreEntitlementsForOrg(orgId),
      storage.getActiveStorePacks(),
    ]);
    const entitlementFlags = await Promise.all(packs.map(pack => storage.isOrgEntitledToPack(orgId, pack.id)));

    const library = packs.map((pack, i) => ({
      ...pack,
      isEntitled: entitlementFlags[i],
      unlockedAt: (entitlements as any[]).find((e: any) => e.packId === pack.id)?.unlockedAt ?? null,
    }));

    res.json(library);
  }));

  // ─── Store revenue analytics ───────────────────────────────────────────────

  router.get("/admin/revenue", isAuthenticated, isSystemAdmin, asyncHandler(async (_req, res) => {
    const summary = await storage.getStoreRevenueSummary();
    res.json(summary);
  }));

  return router;
}
