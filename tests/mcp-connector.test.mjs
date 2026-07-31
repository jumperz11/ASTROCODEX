import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { validateForecast } from "../scripts/forecast-store.mjs";

const port = 4321;
const baseUrl = `http://127.0.0.1:${port}`;
const ownerCode = "test-owner-code-1234";
const staticAccessToken = "test-static-access-token-abcdefghijklmnopqrstuvwxyz";
let connector;

async function waitForConnector() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Connector did not start.");
}

test.before(async () => {
  connector = spawn(
    process.execPath,
    ["scripts/astro-mcp-server.mjs"],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        ASTRO_OWNER_CODE: ownerCode,
        ASTRO_STATIC_ACCESS_TOKEN: staticAccessToken,
        ASTRO_MCP_PORT: String(port),
        ASTRO_PUBLIC_URL: baseUrl,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  await waitForConnector();
});

test.after(async () => {
  if (connector && connector.exitCode === null) {
    connector.kill("SIGTERM");
    await once(connector, "exit");
  }
});

test("OAuth owner approval protects MCP discovery", async () => {
  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "astro-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate") ?? "",
    /oauth-protected-resource/i,
  );

  const staticInitialization = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${staticAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "astro-static-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(staticInitialization.status, 200);
  const staticResult = await staticInitialization.json();
  assert.equal(staticResult.result.serverInfo.name, "astro-intelligence");

  const redirectUri = "http://127.0.0.1:4999/callback";
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Astro connector test",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.ok(registration.ok);
  const client = await registration.json();
  assert.equal(typeof client.client_id, "string");

  const verifier = "astro-connector-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authorizeUrl = new URL("/authorize", baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "owner-test",
    scope: "astro:read astro:write",
    resource: `${baseUrl}/mcp`,
  }).toString();

  const authorize = await fetch(authorizeUrl);
  assert.equal(authorize.status, 200);
  const consentHtml = await authorize.text();
  assert.match(consentHtml, /Authorize Astro Intelligence/);
  const requestId = consentHtml.match(
    /name="request_id" value="([^"]+)"/,
  )?.[1];
  assert.ok(requestId);

  const approval = await fetch(`${baseUrl}/approve`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      request_id: requestId,
      owner_code: ownerCode,
    }),
  });
  assert.equal(approval.status, 302);
  const callback = new URL(approval.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), "owner-test");
  const authorizationCode = callback.searchParams.get("code");
  assert.ok(authorizationCode);

  const tokenResponse = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${baseUrl}/mcp`,
    }),
  });
  assert.ok(tokenResponse.ok);
  const token = await tokenResponse.json();
  assert.equal(token.token_type, "bearer");
  assert.equal(typeof token.access_token, "string");

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "astro-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(initialized.status, 200);
  const initialization = await initialized.json();
  assert.equal(initialization.result.serverInfo.name, "astro-intelligence");
});

test("forecast gate requires direct sources and balanced scenarios", () => {
  const valid = {
    market: "BTC / USD",
    stance: "Neutral pending confirmation",
    stanceTone: "neutral",
    confidence: 55,
    headline: "Wait for confirmation",
    summary: "Astro published a conditional thesis.",
    nextMove: "Most likely he waits for the stated trigger.",
    invalidation: "A confirmed structure failure.",
    waitFor: "A new chart update.",
    decision: {
      position: "Flat / waiting",
      status: "No confirmed live position",
      lookingFor: "A direct structure update",
      playbookMove: "Wait for confirmation",
      risk: "A new thesis supersedes this read",
    },
    signal: {
      state: "wait",
      plainSummary: "There is no confirmed new trade.",
      astroMayDo: "He may keep waiting for confirmation.",
      readerStep: "Wait for a new direct Astro post.",
      changesWhen: "Astro posts a confirmed new move.",
    },
    execution: {
      entry: {
        state: "WAIT",
        level: "Not public",
        condition: "Wait for a direct entry.",
      },
      takeProfit: {
        state: "MANAGE",
        level: "Not public",
        condition: "Wait for a direct trim.",
      },
      exit: {
        state: "CONDITIONAL",
        level: "Not public",
        condition: "Close only when the public thesis changes.",
      },
    },
    thesis: {
      horizon: "Next public update",
      regime: "Range",
      astroConfirmed: "Astro published a conditional thesis.",
      modelRead: "Waiting remains more likely than adding.",
      nextTrigger: "A direct structure update.",
      failure: "A new thesis supersedes this read.",
    },
    thesisLevels: [
      {
        label: "Weekly open watch",
        value: "65k",
        kind: "watch",
        reason: "Framework watch area, not an Astro entry.",
      },
    ],
    bias: {
      cyclical: "Range",
      weekly: "Range",
      swing: "Neutral",
    },
    framework: {
      phase: "Range",
      typeA: "Insufficient inputs",
      sentiment: "Confirmatory only",
      score: "Partial",
    },
    levels: [{ label: "Risk", value: "Not public", kind: "risk" }],
    evidence: [
      {
        type: "astro",
        label: "Direct post",
        detail: "Conditional public thesis.",
        source:
          "https://x.com/astronomer_zero/status/2082560085994434700",
        time: "Latest",
      },
      {
        type: "framework",
        label: "Framework",
        detail: "Direction before execution.",
        source: "Archive",
        time: "Versioned rule",
      },
      {
        type: "inference",
        label: "Inference",
        detail: "Waiting is more likely than adding.",
        source: "Synthesis",
        time: "Current",
      },
    ],
    scenarios: [
      {
        name: "Wait",
        probability: 50,
        description: "No action.",
        trigger: "No confirmation",
      },
      {
        name: "Continue",
        probability: 30,
        description: "Thesis continues.",
        trigger: "Confirmation",
      },
      {
        name: "Fail",
        probability: 20,
        description: "Thesis fails.",
        trigger: "Invalidation",
      },
    ],
    sources: [
      {
        label: "Direct post",
        url: "https://x.com/astronomer_zero/status/2082560085994434700",
      },
    ],
    trackRecord: {
      reviewedAt: "2026-07-30T23:35:00.000Z",
      method: "Only frozen, resolved public plays count.",
      astroClaim: {
        label: "Astro says 5 wins",
        detail: "Self-reported and separate from the audited score.",
      },
      plays: [
        {
          id: "long-v",
          name: "Long V",
          direction: "LONG",
          status: "win",
          openedAt: "2026-07-29T20:13:00.000Z",
          closedAt: "2026-07-30T23:35:00.000Z",
          entry: "~63.45k",
          targets: "64k then 64.7k",
          result: "Right",
          why: "Entry preceded the documented targets.",
          sources: [
            {
              label: "Entry",
              url: "https://x.com/astronomer_zero/status/2082560085994434700",
            },
            {
              label: "Result",
              url: "https://x.com/astronomer_zero/status/2082796525126856769",
            },
          ],
        },
      ],
    },
    caveat: "Research only; not financial advice.",
  };

  const accepted = validateForecast(valid);
  assert.equal(accepted.mode, "live");
  assert.match(accepted.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.throws(
    () =>
      validateForecast({
        ...valid,
        sources: [
          {
            label: "Profile only",
            url: "https://x.com/astronomer_zero",
          },
        ],
      }),
    /direct @astronomer_zero status URL/,
  );
  assert.throws(
    () =>
      validateForecast({
        ...valid,
        signal: { ...valid.signal, state: "guess" },
      }),
    /signal state is invalid/,
  );
  assert.throws(
    () =>
      validateForecast({
        ...valid,
        trackRecord: {
          ...valid.trackRecord,
          plays: [
            {
              ...valid.trackRecord.plays[0],
              closedAt: null,
            },
          ],
        },
      }),
    /invalid audited play/,
  );
});
