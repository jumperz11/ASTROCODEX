export function parseScoutOutput(output) {
  const candidates = [
    output.trim(),
    output.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim(),
    output.match(/(\{[\s\S]*\})/)?.[1]?.trim(),
  ].filter(Boolean);
  let parsed = null;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Grok X scout did not return valid JSON.");
  }
  const posts = (Array.isArray(parsed.posts) ? parsed.posts : [])
    .filter(
      (post) =>
        post &&
        typeof post === "object" &&
        /^https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+$/.test(
          String(post.url || ""),
        ),
    )
    .map((post) => ({
      url: String(post.url),
      statusId: String(post.url).split("/").at(-1),
      postedAt:
        typeof post.postedAt === "string" && post.postedAt.trim()
          ? post.postedAt
          : null,
      text:
        typeof post.text === "string"
          ? post.text.trim().slice(0, 4_000)
          : "",
      threadUrls: (Array.isArray(post.threadUrls) ? post.threadUrls : [])
        .map(String)
        .filter((url) =>
          /^https:\/\/(?:www\.)?x\.com\/astronomer_zero\/status\/\d+$/.test(url),
        )
        .slice(0, 12),
    }))
    .slice(0, 8);
  return {
    posts,
    newestStatusId:
      posts[0]?.statusId ||
      (typeof parsed.newestStatusId === "string"
        ? parsed.newestStatusId
        : null),
    note:
      typeof parsed.note === "string"
        ? parsed.note.trim().slice(0, 1_000)
        : "",
  };
}
