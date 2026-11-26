/**
 * Example server: keeps the API key server-side and exposes 3 tiny endpoints to the game page.
 *   AGENT_API_KEY=agk_live_... AGENT_API_URL=https://your-host \
 *   SCENARIO_ID=... PERSONA_ID=... npx tsx examples/agent-web-game/server.ts
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOutcome, decideOutcome, type PlayerState } from "./gameLogic";
import { AgentApiClient, AgentApiError, parseWebhook } from "../../sdk/agent-api/client";

const { AGENT_API_KEY, AGENT_API_URL, SCENARIO_ID, PERSONA_ID, WEBHOOK_SECRET } = process.env;
if (!AGENT_API_KEY || !AGENT_API_URL || !SCENARIO_ID || !PERSONA_ID) {
  console.error("Set AGENT_API_KEY, AGENT_API_URL, SCENARIO_ID and PERSONA_ID.");
  process.exit(1);
}
const client = new AgentApiClient({ apiKey: AGENT_API_KEY, baseUrl: AGENT_API_URL });
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
  });
}
function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Authoritative game state lives on the server (in-memory for this demo).
const players = new Map<string, PlayerState>();
const sessionPlayer = new Map<string, string>();
const applied = new Map<string, { outcome: string; state: PlayerState }>();
const getPlayer = (id: string): PlayerState => players.get(id) ?? { reputation: 10, gold: 40 };

/** Apply a completed result exactly once per session; the browser never sends scores. */
function applyResultOnce(sessionId: string, result: any) {
  const done = applied.get(sessionId);
  if (done) return done;
  const playerId = sessionPlayer.get(sessionId) ?? "anonymous";
  const outcome = decideOutcome(result);
  const state = applyOutcome(getPlayer(playerId), outcome);
  players.set(playerId, state);
  const entry = { outcome, state };
  applied.set(sessionId, entry);
  return entry;
}

// Completed results received by webhook (optional; the game falls back to polling).
const webhookResults = new Map<string, unknown>();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await readFile(path.join(publicDir, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/embed.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(await readFile(path.join(here, "../../sdk/agent-api/embed.js")));
    }
    // 1) Start a roleplay with the game's current situation.
    if (req.method === "POST" && url.pathname === "/api/roleplay/start") {
      const { playerId, gameContext } = JSON.parse((await readBody(req)).toString() || "{}");
      const pid = String(playerId || "anonymous");
      const out = await client.startRoleplay({
        scenarioId: SCENARIO_ID!, personaId: PERSONA_ID!,
        externalUserId: pid,
        externalSessionId: randomUUID(),
        language: "ko", gameContext: { ...gameContext, playerState: getPlayer(pid) },
      });
      sessionPlayer.set(out.sessionId, pid);
      return send(res, 201, { sessionId: out.sessionId, playUrl: out.playUrl });
    }
    // 2) Wait for the result (polling). A webhook result is used if it arrived first.
    if (req.method === "GET" && url.pathname === "/api/roleplay/result") {
      const id = url.searchParams.get("sessionId") ?? "";
      if (!sessionPlayer.has(id)) return send(res, 404, { error: "unknown_session" });
      const r: any = webhookResults.has(id)
        ? { status: "completed", result: webhookResults.get(id) }
        : await client.getResult(id);
      if (r.status === "completed" && r.result) {
        const { outcome, state } = applyResultOnce(id, r.result);
        return send(res, 200, { status: "completed", outcome, narrativeHook: r.result.narrativeHook, state });
      }
      return send(res, 200, { status: r.status, error: r.error ?? null });
    }
    // 3) Optional webhook receiver: verify against the RAW body.
    if (req.method === "POST" && url.pathname === "/webhooks/roleplay") {
      const raw = await readBody(req);
      const evt = parseWebhook<{ sessionId: string; result: unknown }>(raw, req.headers["x-webhook-signature"] as string, WEBHOOK_SECRET ?? "");
      if (evt.event === "feedback.completed") webhookResults.set(evt.data.sessionId, (evt.data.result as any)?.result ?? evt.data.result);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not_found" });
  } catch (err) {
    if (err instanceof AgentApiError) return send(res, err.status >= 500 ? 502 : err.status, { error: err.code, message: err.message });
    console.error(err);
    send(res, 400, { error: "bad_request", message: (err as Error).message });
  }
}).listen(Number(process.env.PORT) || 3100, () => console.log("Example game on http://localhost:" + (process.env.PORT || 3100)));
