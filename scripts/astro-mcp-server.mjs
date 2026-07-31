import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { readForecast, saveForecast } from "./forecast-store.mjs";
import { searchCodexFile } from "./astro-codex-index.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const playbookPath = join(projectRoot, "prompts", "astro-live-analysis.md");
const codexIndexPath =
  process.env.ASTRO_CODEX_INDEX?.trim() ||
  join(projectRoot, ".astro", "codex-index.json");
const host = "127.0.0.1";
const port = Number.parseInt(process.env.ASTRO_MCP_PORT || "4318", 10);
const ownerCode = process.env.ASTRO_OWNER_CODE;
const staticAccessToken = process.env.ASTRO_STATIC_ACCESS_TOKEN;
const publicBase = new URL(
  process.env.ASTRO_PUBLIC_URL || `http://${host}:${port}`,
);
const mcpUrl = new URL("/mcp", publicBase);
const scopes = ["astro:read", "astro:write"];

if (!ownerCode || ownerCode.length < 12) {
  throw new Error(
    "ASTRO_OWNER_CODE must be set to a private value of at least 12 characters.",
  );
}

function secureEquals(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

class InMemoryClientsStore {
  clients = new Map();

  async getClient(clientId) {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata) {
    this.clients.set(clientMetadata.client_id, clientMetadata);
    return clientMetadata;
  }
}

class OwnerCodeOAuthProvider {
  clientsStore = new InMemoryClientsStore();
  pending = new Map();
  codes = new Map();
  tokens = new Map();
  refreshTokens = new Map();

  async authorize(client, params, response) {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const requestId = randomUUID();
    this.pending.set(requestId, { client, params, expiresAt: Date.now() + 300_000 });
    const clientName = escapeHtml(client.client_name || "Grok");

    response.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize Astro Intelligence</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090a0b; color: #f3efe6; }
      main { width: min(440px, calc(100% - 40px)); padding: 34px; border: 1px solid #34302a; border-radius: 20px; background: #121313; box-shadow: 0 24px 80px #0008; }
      small { color: #d8a84c; letter-spacing: .16em; font-weight: 700; }
      h1 { font-size: 28px; margin: 12px 0; }
      p { color: #aaa69e; line-height: 1.55; }
      ul { color: #d8d3ca; line-height: 1.7; padding-left: 20px; }
      label { display: block; margin: 24px 0 8px; font-size: 13px; color: #cbc5ba; }
      input { box-sizing: border-box; width: 100%; padding: 13px 14px; border: 1px solid #484239; border-radius: 10px; background: #0b0c0c; color: white; font: inherit; }
      button { width: 100%; margin-top: 14px; padding: 13px; border: 0; border-radius: 10px; background: #d8a84c; color: #17130d; font: inherit; font-weight: 800; cursor: pointer; }
      footer { margin-top: 18px; color: #77736d; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <small>OWNER AUTHORIZATION</small>
      <h1>Connect ${clientName}?</h1>
      <p>This grants only the Astro Intelligence connector tools:</p>
      <ul>
        <li>Read the versioned Astro playbook</li>
        <li>Search the private Astro Core Edge Codex</li>
        <li>Read and save a validated forecast</li>
      </ul>
      <form method="post" action="/approve">
        <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
        <label for="owner_code">Owner access code</label>
        <input id="owner_code" name="owner_code" type="password" autocomplete="one-time-code" required autofocus>
        <button type="submit">Authorize connector</button>
      </form>
      <footer>No trading or account-execution permissions are exposed.</footer>
    </main>
  </body>
</html>`);
  }

  approve(requestId, suppliedCode, response) {
    const pending = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (
      !pending ||
      pending.expiresAt < Date.now() ||
      !secureEquals(suppliedCode, ownerCode)
    ) {
      response
        .status(401)
        .type("html")
        .send("<h1>Authorization denied</h1><p>The access code is invalid or expired.</p>");
      return;
    }

    const code = randomUUID();
    this.codes.set(code, pending);
    const target = new URL(pending.params.redirectUri);
    target.searchParams.set("code", code);
    if (pending.params.state !== undefined) {
      target.searchParams.set("state", pending.params.state);
    }
    response.redirect(target.toString());
  }

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error("Invalid authorization code");
    return data.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode) {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error("Invalid authorization code");
    if (data.client.client_id !== client.client_id) {
      throw new Error("Authorization code client mismatch");
    }
    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, data.params.scopes, data.params.resource);
  }

  async exchangeRefreshToken(client, refreshToken, requestedScopes, resource) {
    const stored = this.refreshTokens.get(refreshToken);
    if (!stored || stored.clientId !== client.client_id) {
      throw new Error("Invalid refresh token");
    }
    this.refreshTokens.delete(refreshToken);
    return this.issueTokens(
      client.client_id,
      requestedScopes?.length ? requestedScopes : stored.scopes,
      resource || stored.resource,
    );
  }

  issueTokens(clientId, requestedScopes = [], resource) {
    const grantedScopes = requestedScopes.filter((scope) => scopes.includes(scope));
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 3_600_000;
    this.tokens.set(accessToken, {
      clientId,
      scopes: grantedScopes,
      resource,
      expiresAt,
    });
    this.refreshTokens.set(refreshToken, {
      clientId,
      scopes: grantedScopes,
      resource,
    });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: grantedScopes.join(" "),
    };
  }

  async verifyAccessToken(token) {
    if (
      staticAccessToken &&
      staticAccessToken.length >= 32 &&
      secureEquals(token, staticAccessToken)
    ) {
      return {
        token,
        clientId: "astro-owner",
        scopes,
        expiresAt: Math.floor(Date.now() / 1000) + 86_400,
        resource: mcpUrl.href,
      };
    }

    const data = this.tokens.get(token);
    if (!data || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource,
    };
  }
}

const provider = new OwnerCodeOAuthProvider();
const oauthRouter = mcpAuthRouter({
  provider,
  issuerUrl: publicBase,
  baseUrl: publicBase,
  scopesSupported: scopes,
  resourceName: "Astro Intelligence",
  resourceServerUrl: mcpUrl,
});

const evidenceSchema = z.object({
  type: z.enum(["astro", "framework", "inference"]),
  label: z.string().min(1),
  detail: z.string().min(1),
  source: z.string(),
  time: z.string().min(1),
});

const scenarioSchema = z.object({
  name: z.string().min(1),
  probability: z.number().int().min(0).max(100),
  description: z.string().min(1),
  trigger: z.string().min(1),
});

const auditedPlaySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    direction: z.enum(["LONG", "SHORT"]),
    status: z.enum(["win", "loss", "open", "unscored"]),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
    entry: z.string().min(1),
    targets: z.string().min(1),
    result: z.string().min(1),
    why: z.string().min(1),
    sources: z
      .array(
        z.object({
          label: z.string().min(1),
          url: z
            .string()
            .url()
            .regex(
              /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/astronomer_zero\/status\/\d+/,
            ),
        }),
      )
      .min(1),
  })
  .superRefine((play, context) => {
    const resolved = play.status === "win" || play.status === "loss";
    if (resolved && !play.closedAt) {
      context.addIssue({
        code: "custom",
        message: "A resolved audited play requires closedAt.",
      });
    }
    if (resolved && play.sources.length < 2) {
      context.addIssue({
        code: "custom",
        message: "A resolved audited play requires at least two direct sources.",
      });
    }
    if (play.status === "open" && play.closedAt) {
      context.addIssue({
        code: "custom",
        message: "An open audited play cannot have closedAt.",
      });
    }
  });

const forecastSchema = z.object({
  market: z.string().min(1),
  stance: z.string().min(1),
  stanceTone: z.enum(["long", "short", "neutral"]),
  confidence: z.number().int().min(0).max(100),
  headline: z.string().min(1),
  summary: z.string().min(1),
  nextMove: z.string().min(1),
  invalidation: z.string().min(1),
  waitFor: z.string().min(1),
  decision: z.object({
    position: z.string().min(1),
    status: z.string().min(1),
    lookingFor: z.string().min(1),
    playbookMove: z.string().min(1),
    risk: z.string().min(1),
  }),
  signal: z.object({
    state: z.enum([
      "wait",
      "long",
      "short",
      "take_profit",
      "exit",
      "conflict",
    ]),
    plainSummary: z.string().min(1),
    astroMayDo: z.string().min(1),
    readerStep: z.string().min(1),
    changesWhen: z.string().min(1),
  }),
  execution: z.object({
    entry: z.object({
      state: z.string().min(1),
      level: z.string().min(1),
      condition: z.string().min(1),
    }),
    takeProfit: z.object({
      state: z.string().min(1),
      level: z.string().min(1),
      condition: z.string().min(1),
    }),
    exit: z.object({
      state: z.string().min(1),
      level: z.string().min(1),
      condition: z.string().min(1),
    }),
  }),
  thesis: z.object({
    horizon: z.string().min(1),
    regime: z.string().min(1),
    astroConfirmed: z.string().min(1),
    modelRead: z.string().min(1),
    nextTrigger: z.string().min(1),
    failure: z.string().min(1),
  }),
  thesisLevels: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        kind: z.enum(["watch", "upside", "downside"]),
        reason: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
  bias: z.object({
    cyclical: z.string().min(1),
    weekly: z.string().min(1),
    swing: z.string().min(1),
  }),
  framework: z.object({
    phase: z.string().min(1),
    typeA: z.string().min(1),
    sentiment: z.string().min(1),
    score: z.string().min(1),
  }),
  levels: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        kind: z.enum(["entry", "trim", "risk"]),
      }),
    )
    .min(1),
  evidence: z.array(evidenceSchema).min(3),
  scenarios: z.array(scenarioSchema).length(3),
  sources: z
    .array(
      z.object({
        label: z.string().min(1),
        url: z.string().url(),
      }),
    )
    .min(1),
  trackRecord: z
    .object({
      reviewedAt: z.string().datetime(),
      method: z.string().min(1),
      astroClaim: z.object({
        label: z.string().min(1),
        detail: z.string().min(1),
      }),
      plays: z.array(auditedPlaySchema).max(200),
    })
    .optional(),
  caveat: z.string().min(1),
});

function createAstroServer() {
  const server = new McpServer(
    {
      name: "astro-intelligence",
      version: "0.2.0",
      websiteUrl: "https://astro-intelligence.locked-in-yolo.chatgpt.site",
    },
    {
      instructions:
        "Use this server only for research about public posts by @astronomer_zero. Call get_astro_playbook and search_astro_codex before analysis. Search X yourself, cite exact direct status URLs, then call save_astro_forecast. Never issue an autonomous trade.",
    },
  );

  server.registerTool(
    "get_astro_playbook",
    {
      title: "Read Astro playbook",
      description:
        "Returns the versioned decision rules and strict evidence discipline extracted from Astro's archive. Call this before forming a forecast.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: await readFile(playbookPath, "utf8"),
        },
      ],
    }),
  );

  server.registerTool(
    "search_astro_codex",
    {
      title: "Search Astro Core Edge Codex",
      description:
        "Searches the private Telegram archive for historical Astro rules, terminology, setups, and execution examples. Results are framework context, never proof of a current position.",
      inputSchema: {
        query: z.string().min(3).max(500),
        limit: z.number().int().min(1).max(12).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, limit }) => {
      try {
        const result = await searchCodexFile(codexIndexPath, query, limit ?? 6);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: {
            entryCount: result.entryCount,
            resultCount: result.results.length,
          },
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "The Astro Codex index is unavailable. Do not invent archive context.",
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_latest_forecast",
    {
      title: "Read latest Astro forecast",
      description:
        "Returns the most recently validated forecast, or reports that none has been saved.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const forecast = await readForecast();
      return {
        content: [
          {
            type: "text",
            text: forecast
              ? JSON.stringify(forecast, null, 2)
              : "No validated forecast has been saved yet.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "save_astro_forecast",
    {
      title: "Save validated Astro forecast",
      description:
        "Validates and saves one timestamped research forecast. Use only after searching current @astronomer_zero posts. Direct Astro evidence and every source must cite an exact x.com/astronomer_zero/status/... URL. Scenario probabilities must total 100.",
      inputSchema: { forecast: forecastSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ forecast }) => {
      try {
        const saved = await saveForecast(forecast);
        return {
          content: [
            {
              type: "text",
              text: `Forecast accepted at ${saved.generatedAt}. The private dashboard can now refresh it.`,
            },
          ],
          structuredContent: {
            accepted: true,
            generatedAt: saved.generatedAt,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "Forecast validation failed.",
            },
          ],
        };
      }
    },
  );

  return server;
}

const app = createMcpExpressApp({
  host,
  allowedHosts: ["127.0.0.1", "localhost", publicBase.host],
});
app.use(express.urlencoded({ extended: false }));
app.post("/approve", (request, response) => {
  provider.approve(
    String(request.body.request_id || ""),
    String(request.body.owner_code || ""),
    response,
  );
});
app.use(oauthRouter);

const bearerAuth = requireBearerAuth({
  verifier: provider,
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
});

app.post("/mcp", bearerAuth, async (request, response) => {
  const server = createAstroServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch {
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal connector error",
        },
        id: null,
      });
    }
  } finally {
    response.on("close", () => {
      transport.close();
      server.close();
    });
  }
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    name: "astro-intelligence",
    auth: staticAccessToken
      ? "bearer-token-and-oauth-owner-code"
      : "oauth-owner-code",
  });
});
app.get("/mcp", bearerAuth, (_request, response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});
app.delete("/mcp", bearerAuth, (_request, response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.listen(port, host, () => {
  process.stdout.write(`Astro MCP ready at ${publicBase.href}\n`);
  process.stdout.write(`MCP endpoint: ${mcpUrl.href}\n`);
});
