import assert from "node:assert/strict";
import test from "node:test";

import {
  directEvidenceReview,
  enforceDirectReview,
} from "../scripts/source-review.mjs";

const forecast = { generatedAt: "2026-08-01T13:06:14.360Z" };

test("direct Astro position evidence newer than the forecast requires review", () => {
  const review = directEvidenceReview(
    {
      posts: [
        {
          url: "https://x.com/astronomer_zero/status/2083899453057249491",
          postedAt: "2026-08-02T12:55:21.000Z",
          text: "$btc The cat is back on the run towards lower.",
        },
        {
          url: "https://x.com/astronomer_zero/status/2083886395052183862",
          postedAt: "2026-08-02T12:03:27.000Z",
          text: "$btc shorts VI. Shaved some initial profits. Still expecting new lows.",
        },
      ],
    },
    forecast,
  );
  assert.equal(review.needed, true);
  assert.deepEqual(review.urls, [
    "https://x.com/astronomer_zero/status/2083899453057249491",
    "https://x.com/astronomer_zero/status/2083886395052183862",
  ]);
});

test("ordinary new commentary does not force a deeper review", () => {
  const review = directEvidenceReview(
    {
      posts: [
        {
          url: "https://x.com/astronomer_zero/status/2084000000000000000",
          postedAt: "2026-08-02T12:55:21.000Z",
          text: "Good morning everyone.",
        },
      ],
    },
    forecast,
  );
  assert.equal(review.needed, false);
});

test("a contradictory no-change gate is upgraded to a bounded review", () => {
  const gate = enforceDirectReview(
    {
      material: false,
      severity: "none",
      category: "no_change",
      reason: "Nothing material",
      evidenceRefs: [],
      needsXSearch: false,
      mediumReason: "No review",
      brief: {
        astroNow: "Short bias",
        changed: "Nothing material",
        nextTrigger: "Close",
        contradiction: "None",
        levels: [],
      },
      campaign: {
        state: "open",
        direction: "short",
        entry: "Unknown",
        targets: ["new lows"],
        invalidation: "Unknown",
        sourceRefs: [],
      },
      lunaBrief: { facts: [], question: "Review", counterCase: "Bounce" },
    },
    {
      needed: true,
      urls: ["https://x.com/astronomer_zero/status/2083899453057249491"],
    },
  );
  assert.equal(gate.material, true);
  assert.equal(gate.category, "position");
  assert.equal(gate.evidenceRefs.length, 1);
  assert.match(gate.brief.changed, /requires review/i);
});
