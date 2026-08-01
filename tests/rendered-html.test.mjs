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
  assert.match(html, /Astro Intelligence/i);
  assert.match(html, /YOUR CLEAR READ/);
  assert.match(html, /ASTRO · CONFIRMED/);
  assert.match(html, />WAIT</);
  assert.match(html, /NO · EXISTING POSITION/);
  assert.match(html, /HERMES · MODEL/);
  assert.match(html, /LEVELS/);
  assert.match(html, /RIGHT NOW/);
  assert.match(html, />Chart</);
  assert.match(html, />Live</);
  assert.match(html, />History</);
  assert.match(html, /LATEST UPDATE/);
  assert.match(html, /Source ↗/i);
  assert.match(
    html,
    /https:\/\/x\.com\/astronomer_zero\/status\/\d+/i,
  );
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
