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
  assert.match(html, /ASTRO POSITION/);
  assert.match(html, /SIMPLE NEXT MOVE/);
  assert.match(html, /WHAT YOU DO/);
  assert.match(html, />WAIT</);
  assert.match(html, /No fresh opportunity is confirmed yet/);
  assert.match(html, /LATEST ASTRO UPDATE/);
  assert.match(html, /OUR OPPORTUNITY/);
  assert.match(html, /ACTIVATES WHEN/);
  assert.match(html, /Previous moves/);
  assert.match(html, /YOUR MOVE/);
  assert.match(html, /WATCH PRICE/);
  assert.match(html, /READ CHANGES IF/);
  assert.match(html, /OPEN &amp; CLOSE MAP/);
  assert.match(html, /LIVE ASTRO MAP/);
  assert.match(html, /ASTRO SIGNAL/);
  assert.match(html, /Coinbase public BTC-USD feed/);
  assert.match(html, /OPEN \/ ADD/);
  assert.match(html, /REDUCE \/ TAKE PROFIT/);
  assert.match(html, /CLOSE \/ INVALIDATE/);
  assert.match(html, /POSITION TIMELINE/);
  assert.match(html, /Grok connected/);
  assert.match(html, /Open latest Astro post/i);
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
  assert.equal(data.forecast.mode, "live");
});
