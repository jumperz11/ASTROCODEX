const DIRECT_POSITION_PATTERN =
  /\b(?:shorts?|longs?|entry|entered|open(?:ed)?|close(?:d)?|trim(?:med)?|profit(?:s)?|tp\s*\d*|take\s+profit|target(?:s)?|stop(?:-loss)?|invalidation|new\s+lows?|lower|higher|reclaim|break(?:out|down)|holding|not\s+long(?:ing)?|expect(?:ing)?\s+new\s+lows?)\b/i;

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isDirectAstroUrl(value) {
  return /^https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+$/.test(
    String(value || ""),
  );
}

function compactPost(post) {
  const url = String(post?.url || "").trim();
  const text = typeof post?.text === "string" ? post.text.trim() : "";
  if (!isDirectAstroUrl(url) || !text) return null;
  return { url, postedAt: post?.postedAt ?? null, text };
}

/**
 * Finds direct Astro position/management evidence newer than the accepted
 * forecast. This is a review trigger only; it never creates a signal.
 */
export function directEvidenceReview(source, forecast) {
  const acceptedForecastMs = timestampMs(forecast?.generatedAt);
  const posts = (Array.isArray(source?.posts) ? source.posts : [])
    .map(compactPost)
    .filter(Boolean);
  const newerPosts = posts.filter((post) => {
    const postedMs = timestampMs(post.postedAt);
    return (
      postedMs !== null &&
      (acceptedForecastMs === null || postedMs > acceptedForecastMs)
    );
  });
  const matchedPosts = newerPosts.filter((post) =>
    DIRECT_POSITION_PATTERN.test(post.text),
  );
  return {
    needed: matchedPosts.length > 0,
    latestPostAt:
      newerPosts
        .map((post) => timestampMs(post.postedAt))
        .filter((value) => value !== null)
        .sort((left, right) => right - left)
        .at(0) ?? null,
    urls: matchedPosts.map((post) => post.url),
    posts: matchedPosts,
  };
}

/**
 * DeepSeek is a classifier, not the source of truth. If it describes a new
 * direct position but returns material=false, force a bounded Luna review.
 * The review can still keep the accepted forecast unchanged.
 */
export function enforceDirectReview(gate, review) {
  if (!gate || gate.material || !review?.needed) return gate;
  const evidenceRefs = [
    ...(Array.isArray(gate.evidenceRefs) ? gate.evidenceRefs : []),
    ...(Array.isArray(review.urls) ? review.urls : []),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const facts = Array.isArray(gate.lunaBrief?.facts)
    ? gate.lunaBrief.facts
    : [];
  return {
    ...gate,
    material: true,
    severity: gate.severity === "high" ? "high" : "medium",
    category:
      gate.category && gate.category !== "no_change"
        ? gate.category
        : "position",
    reason:
      "New direct Astro position evidence is newer than the accepted forecast; a deeper review is required.",
    evidenceRefs,
    needsXSearch: false,
    mediumReason:
      "Compare the new direct Astro position/management posts with the accepted forecast before deciding whether the saved plan changes.",
    brief: {
      ...gate.brief,
      changed: "New direct Astro position or management evidence requires review.",
    },
    lunaBrief: {
      ...gate.lunaBrief,
      facts: [
        ...facts,
        "Direct Astro position evidence is newer than the accepted forecast.",
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 8),
    },
  };
}

