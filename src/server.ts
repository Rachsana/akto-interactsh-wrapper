import express from "express";
import { SessionManager } from "./session/manager";
import { buildApiRouter } from "./routes/api";

const PORT = process.env.PORT ?? "8080";
const INTERACTSH_BINARY = process.env.INTERACTSH_BINARY ?? "interactsh-client";
// Omit INTERACTSH_SERVER_URL to let the CLI use its own default public server.
const INTERACTSH_SERVER_URL = process.env.INTERACTSH_SERVER_URL;
const SESSION_TTL_MS = 60 * 60 * 1000; // evict sessions unqueried for over an hour

const manager = new SessionManager(INTERACTSH_BINARY, INTERACTSH_SERVER_URL, SESSION_TTL_MS);

const app = express();
app.use("/api", buildApiRouter(manager));
app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(Number(PORT), () => {
  console.log(`interactsh-wrapper listening on :${PORT} (binary: ${INTERACTSH_BINARY})`);
});
