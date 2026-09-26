// Rather than reimplementing interact.sh's registration/polling/decryption
// protocol from scratch, this wrapper drives the official `interactsh-client`
// CLI binary as a subprocess (one per session) and parses its stdout. That
// binary already handles registration, keeping the session alive, polling,
// and decrypting interactions — we just need to read its output.
//
// Each call to newSession() spawns a fresh `interactsh-client` process, which
// allocates its own unique subdomain. We key sessions by that subdomain
// (exactly what getInteractions() expects as input), and keep parsing that
// process's stdout for the lifetime of the session to accumulate
// interactions in memory.
import { spawn, ChildProcessByStdio } from "child_process";
import { Readable } from "stream";
import readline from "readline";
import { Interaction } from "../types";

// Matches the "[INF] <subdomain>.oast.xxx" banner line interactsh-client
// prints right after "[INF] Listing N payload(s) for OOB Testing" — see the
// sample output in the assignment doc.
const DOMAIN_ANNOUNCE_RE = /^\[INF]\s+([a-z0-9]+\.[a-z0-9.-]+)\s*$/i;

// Matches lines like:
//   [<id>] Received DNS interaction (A) from 172.253.226.100 at 2026-09-26 12:26
//   [<id>] Received HTTP interaction from 43.22.22.50 at 2026-09-26 12:26
const INTERACTION_RE =
  /^\[([a-z0-9]+)]\s+Received\s+(\w+)\s+interaction(?:\s*\(([^)]+)\))?\s+from\s+([\d.]+)\s+at\s+(.+)$/i;

// spawn(..., { stdio: ["ignore", "pipe", "pipe"] }) gives stdin: null, so the
// correct process type is ChildProcessByStdio<null, Readable, Readable> —
// NOT ChildProcessWithoutNullStreams (that requires a writable stdin).
type SpawnedProc = ChildProcessByStdio<null, Readable, Readable>;

interface Session {
  url: string;
  proc: SpawnedProc;
  createdAt: Date;
  lastSeen: Date;
  interactions: Interaction[];
}

export class SessionNotFoundError extends Error {
  constructor() {
    super("no active session for the given URL");
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(
    private binaryPath: string,
    private serverUrl: string | undefined,
    private ttlMs: number
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  /** Spawns a new interactsh-client process and resolves once it reports its domain. */
  async newSession(timeoutMs = 15_000): Promise<string> {
    const args = ["-n", "1"];
    if (this.serverUrl) {
      args.push("-server", this.serverUrl);
    }

    const proc: SpawnedProc = spawn(this.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish();
        reject(new Error("timed out waiting for interactsh-client to report a domain"));
      }, timeoutMs);

      const rl = readline.createInterface({ input: proc.stdout });

      const onLine = (line: string) => {
        const m = DOMAIN_ANNOUNCE_RE.exec(line.trim());
        if (m) {
          finish();
          resolve(m[1]);
        }
      };
      const onError = (err: Error) => {
        finish();
        reject(err);
      };
      const onExit = (code: number | null) => {
        finish();
        reject(new Error(`interactsh-client exited early (code ${code})`));
      };

      function finish() {
        clearTimeout(timer);
        rl.off("line", onLine);
        proc.off("error", onError);
        proc.off("exit", onExit);
      }

      rl.on("line", onLine);
      proc.once("error", onError);
      proc.once("exit", onExit);
    });

    const session: Session = {
      url,
      proc,
      createdAt: new Date(),
      lastSeen: new Date(),
      interactions: [],
    };
    this.sessions.set(url, session);
    this.attachInteractionParser(session);
    return url;
  }

  private attachInteractionParser(session: Session) {
    const rl = readline.createInterface({ input: session.proc.stdout });
    rl.on("line", (line) => {
      const m = INTERACTION_RE.exec(line.trim());
      if (!m) return;
      const [, , protocol, qtype, callerIp, timestampRaw] = m;
      const parsed = new Date(timestampRaw);
      session.interactions.push({
        protocol,
        qtype,
        callerIp,
        timestampRaw,
        timestamp: isNaN(parsed.getTime()) ? undefined : parsed.toISOString(),
      });
    });
  }

  /** Returns collected interactions for a session, optionally filtered to [from, to]. */
  getInteractions(url: string, from?: Date, to?: Date): Interaction[] {
    const session = this.sessions.get(url);
    if (!session) throw new SessionNotFoundError();
    session.lastSeen = new Date();

    return session.interactions.filter((i) => {
      if (!i.timestamp) return true; // keep entries we couldn't parse a timestamp for
      const t = new Date(i.timestamp);
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }

  activeSessions(): string[] {
    return [...this.sessions.keys()];
  }

  private cleanup() {
    const now = Date.now();
    for (const [url, session] of this.sessions) {
      if (now - session.lastSeen.getTime() > this.ttlMs) {
        session.proc.kill();
        this.sessions.delete(url);
      }
    }
  }
}
