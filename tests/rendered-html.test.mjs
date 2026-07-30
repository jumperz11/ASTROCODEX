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
  assert.match(html, /LIKELY NEXT MOVE/);
  assert.match(html, /ASTRO STACK/);
  assert.match(html, /What is Astro thinking\?/);
  assert.match(html, /Human judgment remains the final gate/);
  assert.match(html, /property="og:image"/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("returns a safe timestamped fallback when no Grok key is configured", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/astro-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What is Astro likely thinking right now?",
      }),
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

  const report = await response.json();
  assert.equal(report.mode, "demo");
  assert.equal(report.stanceTone, "long");
  assert.equal(report.confidence, 72);
  assert.equal(
    report.scenarios.reduce((sum, item) => sum + item.probability, 0),
    100,
  );
  assert.match(report.caveat, /not Astro’s private intent/i);
  assert.ok(report.evidence.some((item) => item.type === "astro"));
  assert.ok(report.evidence.some((item) => item.type === "framework"));
  assert.ok(report.evidence.some((item) => item.type === "inference"));
});
