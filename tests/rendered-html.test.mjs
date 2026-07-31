import assert from "node:assert/strict";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the Astro Intelligence research terminal", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Astro Intelligence<\/title>/i);
  assert.match(html, /ASTRO[\s\S]*INTELLIGENCE/);
  assert.match(html, /CURRENT ASTRO READ/);
  assert.match(html, />WAIT</);
  assert.match(html, /No fresh opportunity is confirmed yet/);
  assert.match(html, /FRESH ENTRY/);
  assert.match(html, /LIKELY NEXT · MODEL, NOT ASTRO/);
  assert.match(html, /ASTRO NEXT · MODEL/);
  assert.match(html, /PREDICTED ASTRO NEXT/);
  assert.match(html, /NEXT LEVEL/);
  assert.match(html, /READ CHANGES IF/);
  assert.match(html, /EXPECTED NEXT/);
  assert.match(html, /MOST LIKELY PATH/);
  assert.match(html, /CONFIRMS IF/);
  assert.match(html, /WRONG \/ CHANGES IF/);
  assert.match(html, /ASTRO NOW/);
  assert.match(html, /WHAT ASTRO LAST CONFIRMED/);
  assert.match(html, /POSITION NOW/);
  assert.match(html, /ASTRO PERFORMANCE/);
  assert.match(html, /TP \/ GOAL/);
  assert.match(html, /OPEN &amp; CLOSE MAP/);
  assert.match(html, /LIVE ASTRO MAP/);
  assert.match(html, />Hermes</);
  assert.match(html, /ASTRO SIGNAL/);
  assert.match(html, /Coinbase public BTC-USD feed/);
  assert.match(html, /GHOST PATH · MODEL PREDICTION/);
  assert.match(html, /OPEN \/ ADD/);
  assert.match(html, /REDUCE \/ TAKE PROFIT/);
  assert.match(html, /CLOSE \/ INVALIDATE/);
  assert.match(html, /POSITION TIMELINE/);
  assert.match(html, /Grok connected/);
  assert.match(html, /Open post/i);
  assert.match(
    html,
    /https:\/\/x\.com\/astronomer_zero\/status\/\d+/i,
  );
  assert.match(html, /Human judgment remains the final gate/);
  assert.match(html, /property="og:image"/);
  assert.doesNotMatch(html, /XAI_API_KEY/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("live signal endpoint safely falls back to the validated bundle", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/live-signal", {
      headers: { accept: "application/json" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);

  const data = await response.json();
  assert.equal(data.source, "bundled");
  assert.equal(data.checkedAt, null);
  assert.equal(data.forecast.market, "BTC");
  assert.equal(data.forecast.mode, "snapshot");
  assert.equal(data.forecast.signal.state, "wait");
  assert.equal(data.degraded, true);
});

test("history endpoint keeps the audited scorecard available when VPS history is offline", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/live-history", {
      headers: { accept: "application/json" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);

  const data = await response.json();
  assert.equal(data.trackRecord.plays[0].status, "win");
  assert.equal(data.trackRecord.plays[1].status, "open");
  assert.equal(
    data.trackRecord.plays.filter((play) => play.status === "win").length,
    1,
  );
  assert.equal(
    data.trackRecord.plays.filter((play) => play.status === "loss").length,
    0,
  );
  assert.equal(data.degraded, true);
});
