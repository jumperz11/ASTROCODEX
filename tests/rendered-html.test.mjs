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
  assert.match(html, /OPEN &amp; CLOSE MAP/);
  assert.match(html, /OPEN \/ ADD/);
  assert.match(html, /REDUCE \/ TAKE PROFIT/);
  assert.match(html, /CLOSE \/ INVALIDATE/);
  assert.match(html, /Reduced long \/ runner/i);
  assert.match(html, /POSITION TIMELINE/);
  assert.match(html, /Grok connected/);
  assert.match(html, /Astro closed short IV/i);
  assert.match(html, /64K confirmed · 67\.7K flagged/i);
  assert.match(html, /Human judgment remains the final gate/);
  assert.match(html, /property="og:image"/);
  assert.doesNotMatch(html, /XAI_API_KEY/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});
