import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeBudget,
  inspectBudget,
  recentAttempts,
} from "../scripts/provider-budget.mjs";
import { parseScoutOutput } from "../scripts/x-scout-parser.mjs";

test("provider budget keeps only the rolling 24 hour window", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const attempts = recentAttempts(
    [
      "2026-07-31T11:59:59.000Z",
      "2026-07-31T12:00:00.000Z",
      "2026-08-01T11:59:59.000Z",
      "not-a-date",
    ],
    now,
  );
  assert.deepEqual(attempts, [
    "2026-07-31T12:00:00.000Z",
    "2026-08-01T11:59:59.000Z",
  ]);
});

test("provider budget refuses calls after the cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astro-budget-"));
  const path = join(directory, "budget.json");
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  assert.equal((await consumeBudget(path, 2, now)).accepted, true);
  assert.equal((await consumeBudget(path, 2, now + 1_000)).accepted, true);
  assert.equal((await consumeBudget(path, 2, now + 2_000)).accepted, false);
  const budget = await inspectBudget(path, 2, now + 2_000);
  assert.equal(budget.used, 2);
  assert.equal(budget.remaining, 0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).attempts.length, 2);
});

test("Grok scout accepts only direct AstronomerZero status URLs", () => {
  const parsed = parseScoutOutput(`\`\`\`json
{
  "newestStatusId": "123",
  "posts": [
    {
      "url": "https://x.com/astronomer_zero/status/123",
      "postedAt": "2026-08-01T10:00:00Z",
      "text": "new direct evidence",
      "threadUrls": [
        "https://x.com/astronomer_zero/status/124",
        "https://x.com/someone_else/status/999"
      ]
    },
    {
      "url": "https://x.com/someone_else/status/999",
      "text": "reject me"
    }
  ],
  "note": "checked"
}
\`\`\``);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.posts[0].statusId, "123");
  assert.deepEqual(parsed.posts[0].threadUrls, [
    "https://x.com/astronomer_zero/status/124",
  ]);
});
