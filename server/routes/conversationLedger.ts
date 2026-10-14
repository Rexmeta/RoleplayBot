import { Router } from "express";
import { asyncHandler, createHttpError, verifyPersonaRunOwnership } from "./routerHelpers";
import { applyLedgerCommand, readLedgerProjection, readLedgerSnapshot } from "../services/conversationLedger/service";
import { LedgerError } from "../services/conversationLedger/policy";

/** No enrollment endpoint: live/legacy traffic cannot opt itself into an unfinished rollout. */
export function createConversationLedgerRouter(isAuthenticated: any) {
  const router = Router({ mergeParams: true });
  const handle = async (operation: () => Promise<unknown>) => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof LedgerError) throw createHttpError(error.status, error.code);
      throw error;
    }
  };

  router.get("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    await verifyPersonaRunOwnership(req.params.id, req.user.id, req.user.role);
    const raw = req.query.after ?? "0";
    if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) throw createHttpError(400, "invalid_ledger_cursor");
    res.json(await handle(() => readLedgerProjection(req.params.id, Number(raw))));
  }));
  router.get("/snapshots/:snapshotId", isAuthenticated, asyncHandler(async (req: any, res) => {
    await verifyPersonaRunOwnership(req.params.id, req.user.id, req.user.role);
    res.json(await handle(() => readLedgerSnapshot(req.params.id, req.params.snapshotId)));
  }));
  router.post("/commands", isAuthenticated, asyncHandler(async (req: any, res) => {
    // Operators/admins may read, but may not write to another user's ledger.
    await verifyPersonaRunOwnership(req.params.id, req.user.id);
    const ack = await handle(() => applyLedgerCommand(req.params.id, req.body, "client"));
    res.json({ type: "ledger.ack", ack }); // applyLedgerCommand has already committed.
  }));
  return router;
}
