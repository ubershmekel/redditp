import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import https from "https";
import http from "http";
import { URL } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Reddit app credentials — register at https://www.reddit.com/prefs/apps
// Set these in the environment before starting the server.
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID ?? "";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET ?? "";

if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
  console.error(
    "ERROR: REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in server/.env\n" +
      "Register a 'script' app at https://www.reddit.com/prefs/apps",
  );
  process.exit(1);
}

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

// ── OAuth token cache ────────────────────────────────────────────────────────

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // ms since epoch
}

let cachedToken: OAuthToken | null = null;

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(
    `${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`,
  ).toString("base64");

  const raw = await httpsPost(
    "https://www.reddit.com/api/v1/access_token",
    "grant_type=client_credentials",
    {
      Authorization: `Basic ${credentials}`,
      "User-Agent": USER_AGENT,
    },
  );

  const parsed = JSON.parse(raw) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!parsed.access_token) {
    throw new Error(`Reddit OAuth failed: ${parsed.error ?? raw}`);
  }

  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: now + (parsed.expires_in ?? 3600) * 1000,
  };

  return cachedToken.accessToken;
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

// Proxy GET requests ending in .json to oauth.reddit.com using app-only OAuth.
// E.g. GET /r/aww/.json?limit=25&after=t3_abc
app.get("/*", async (req: Request, res: Response) => {
  if (!req.path.endsWith(".json")) {
    res.status(400).json({ error: "Only .json paths are proxied" });
    return;
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("OAuth error:", (err as Error).message);
    res.status(502).json({ error: "Could not obtain Reddit OAuth token" });
    return;
  }

  // Forward query params except jsonp=
  const targetUrl = new URL(req.path, "https://oauth.reddit.com");
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "jsonp") continue;
    if (typeof value === "string") {
      targetUrl.searchParams.set(key, value);
    }
  }

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    method: "GET",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  };

  let responded = false;

  const proxyReq = https.request(options, (proxyRes) => {
    if (responded) return;
    responded = true;

    const status = proxyRes.statusCode ?? 500;
    res.status(status);
    res.setHeader("Content-Type", "application/json");
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    if (responded) return;
    responded = true;
    console.error("Proxy request error:", err.message);
    res.status(502).json({ error: "Failed to reach Reddit API" });
  });

  proxyReq.setTimeout(10_000, () => {
    if (responded) return;
    responded = true;
    proxyReq.destroy();
    res.status(504).json({ error: "Reddit API timed out" });
  });

  proxyReq.end();
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`redditp-api proxy listening on http://localhost:${PORT}`);
});
