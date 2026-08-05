import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import https from "https";
import http from "http";
import { URL } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = new Set([
  "https://redditp.com",
  "https://api.redditp.com",
  "https://old.redditp.com",
  "https://pay.redditp.com",
  "https://ssl.redditp.com",
  "https://test.redditp.com",
  "https://test2.redditp.com",
  "https://www.redditp.com",
  "http://localhost:8080",
  "http://localhost:3000",
]);

const USER_AGENT =
  "web:redditp-proxy:1.0.0 (by /u/ubershmekel; https://redditp.com)";

// Reddit's OAuth app registration is gated behind an approval process as of
// late 2025 (the "Responsible Builder Policy"), so we fall back to the
// public, unauthenticated .json endpoints instead of oauth.reddit.com.
const REDDIT_HOST = "old.reddit.com";

// ── Logging ──────────────────────────────────────────────────────────────────
// Every line gets a timestamp. We log every request (no dedup/collapsing) —
// the throttle below is what keeps us from spamming Reddit's API, not the log.

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: "log" | "error", message: string): void {
  console[level](`[${timestamp()}] ${message}`);
}

// ── Outbound request throttling ─────────────────────────────────────────────
// Serialize + space out our own requests to Reddit so we don't get blocked
// for hammering their unauthenticated endpoint.

const THROTTLE_INTERVAL_MS = Number(process.env.THROTTLE_INTERVAL_MS) || 1000;
let throttleQueue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const next = throttleQueue.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, THROTTLE_INTERVAL_MS)),
  );
  throttleQueue = next;
  return next;
}

// ── Response cache ───────────────────────────────────────────────────────────
// Short-lived cache so multiple viewers hitting the same subreddit within a
// few seconds only cost us one request to Reddit.

interface CacheEntry {
  status: number;
  body: Buffer;
  expiresAt: number;
}

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 30_000;
const responseCache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return entry;
}

// ── CORS middleware ──────────────────────────────────────────────────────────

function setCorsHeaders(origin: string | undefined, res: Response): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return true;
  }
  return false;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowed = setCorsHeaders(origin, res);

  if (req.method === "OPTIONS") {
    res.sendStatus(allowed ? 204 : 403);
    return;
  }

  if (!allowed) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Proxy GET requests ending in .json to Reddit's public json endpoints.
// E.g. GET /r/aww/.json?limit=25&after=t3_abc
app.get("/*", async (req: Request, res: Response) => {
  if (!req.path.endsWith(".json")) {
    res.status(400).json({ error: "Only .json paths are proxied" });
    return;
  }

  const targetUrl = new URL(req.path, `https://${REDDIT_HOST}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "jsonp") continue;
    if (typeof value === "string") {
      targetUrl.searchParams.set(key, value);
    }
  }

  const cacheKey = targetUrl.pathname + targetUrl.search;
  const cached = getCached(cacheKey);
  if (cached) {
    res.status(cached.status);
    res.setHeader("Content-Type", "application/json");
    res.send(cached.body);
    return;
  }

  await throttle();

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  };

  let responded = false;

  const proxyReq = https.request(options, (proxyRes) => {
    if (responded) return;
    responded = true;

    const status = proxyRes.statusCode ?? 500;
    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      if (status === 200) {
        responseCache.set(cacheKey, {
          status,
          body,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      } else {
        log("error", `Reddit responded ${status} for ${cacheKey}`);
      }
      res.status(status);
      res.setHeader("Content-Type", "application/json");
      res.send(body);
    });
  });

  proxyReq.on("error", (err) => {
    if (responded) return;
    responded = true;
    log("error", `Proxy request error: ${err.message}`);
    res.status(502).json({ error: "Failed to reach Reddit" });
  });

  proxyReq.setTimeout(10_000, () => {
    if (responded) return;
    responded = true;
    proxyReq.destroy();
    log("error", `Reddit request timed out for ${cacheKey}`);
    res.status(504).json({ error: "Reddit API timed out" });
  });

  proxyReq.end();
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer(app);
server.listen(PORT, () => {
  log("log", `redditp-api proxy listening on http://localhost:${PORT}`);
});
