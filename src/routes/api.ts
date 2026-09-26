import { Router } from "express";
import { SessionManager, SessionNotFoundError } from "../session/manager";

export function buildApiRouter(manager: SessionManager): Router {
  const router = Router();

  // POST /api/getURL — allocate a new interactsh session, return its URL.
  // GET is also accepted for easy testing in a browser.
  const getURLHandler: import("express").RequestHandler = async (_req, res) => {
    try {
      const url = await manager.newSession();
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  };
  router.post("/getURL", getURLHandler);
  router.get("/getURL", getURLHandler);

  // GET /api/getInteractions?url=<url>&from=<ISO-8601>&to=<ISO-8601>
  router.get("/getInteractions", (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";
    if (!url) {
      res.status(400).json({ error: "missing required query param: url" });
      return;
    }

    let from: Date | undefined;
    let to: Date | undefined;
    const parseParam = (name: "from" | "to"): Date | undefined => {
      const raw = req.query[name];
      if (typeof raw !== "string" || raw === "") return undefined;
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        throw new Error(`invalid '${name}' timestamp, expected ISO-8601 (e.g. 2026-09-26T10:00:00Z)`);
      }
      return d;
    };

    try {
      from = parseParam("from");
      to = parseParam("to");
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    try {
      const interactions = manager.getInteractions(url, from, to);
      res.json({ url, count: interactions.length, interactions });
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
