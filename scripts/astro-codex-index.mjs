import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const entityMap = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
};

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "astro",
  "been",
  "before",
  "but",
  "can",
  "did",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "just",
  "more",
  "not",
  "our",
  "that",
  "the",
  "their",
  "then",
  "they",
  "this",
  "was",
  "what",
  "when",
  "where",
  "which",
  "will",
  "with",
  "would",
  "you",
]);

function decodeHtml(value) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, code) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return entityMap[code.toLowerCase()] ?? entity;
    },
  );
}

function cleanHtml(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

export function parseTelegramHtml(html, sourceFile = "messages.html") {
  return html
    .split(/(?=<div class="message (?:default|service)[^"]*" id="message)/)
    .flatMap((block) => {
      if (!/^<div class="message default\b/.test(block)) return [];
      const id = block.match(/id="message(\d+)"/)?.[1];
      if (!id) return [];
      const date =
        block.match(/class="pull_right date details" title="([^"]+)"/)?.[1] ??
        "Unknown date";
      const author = cleanHtml(
        block.match(/<div class="from_name">\s*([\s\S]*?)<\/div>/)?.[1] ??
          "Astro Core Edge Codex",
      );
      const text = cleanHtml(
        block.match(/<div class="text">\s*([\s\S]*?)<\/div>/)?.[1] ?? "",
      );
      const media = [
        ...block.matchAll(
          /<(?:a|video|audio)[^>]+(?:href|src)="([^"]+)"[^>]*>/gi,
        ),
      ]
        .map((match) => decodeHtml(match[1]))
        .filter(
          (path) =>
            /^(?:photos|video_files|voice_messages|files|audio_files)\//.test(
              path,
            ) && !path.includes("_thumb."),
        );
      if (!text && media.length === 0) return [];
      return [
        {
          id: Number(id),
          ref: `${sourceFile}#message${id}`,
          date,
          author,
          text: text || "[Media-only chart or attachment]",
          media: [...new Set(media)],
        },
      ];
    });
}

export async function buildCodexIndex(archiveDirectory) {
  const sourceFiles = (await readdir(archiveDirectory))
    .filter((name) => /^messages\d*\.html$/i.test(name))
    .sort((left, right) => {
      const number = (name) =>
        Number(name.match(/\d+/)?.[0] ?? "1");
      return number(left) - number(right);
    });
  const messages = [];
  for (const sourceFile of sourceFiles) {
    const html = await readFile(join(archiveDirectory, sourceFile), "utf8");
    messages.push(...parseTelegramHtml(html, sourceFile));
  }
  const byId = new Map();
  for (const message of messages) byId.set(message.id, message);
  const entries = [...byId.values()].sort((left, right) => left.id - right.id);
  return {
    version: 1,
    title: "Astro Core Edge Codex",
    builtAt: new Date().toISOString(),
    archive: basename(archiveDirectory),
    sourceFiles,
    entryCount: entries.length,
    mediaCount: entries.reduce((total, entry) => total + entry.media.length, 0),
    entries,
  };
}

function queryTerms(query) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9]+(?:\.[0-9]+)?%?/g)
        ?.filter((term) => term.length > 2 && !stopWords.has(term)) ?? [],
    ),
  ];
}

export function searchCodex(index, query, limit = 6) {
  const normalizedQuery = query.toLowerCase().trim();
  const terms = queryTerms(query);
  if (!normalizedQuery || terms.length === 0) return [];
  const entries = Array.isArray(index?.entries) ? index.entries : [];

  return entries
    .map((entry, position) => {
      const haystack = `${entry.date} ${entry.text}`.toLowerCase();
      let score = normalizedQuery.length > 5 && haystack.includes(normalizedQuery)
        ? 12
        : 0;
      for (const term of terms) {
        const matches = haystack.split(term).length - 1;
        if (matches > 0) score += 3 + Math.min(matches, 4);
      }
      if (score === 0) return null;
      const context = entries
        .slice(Math.max(0, position - 1), Math.min(entries.length, position + 2))
        .map((item) => `[${item.ref} · ${item.date}]\n${item.text}`)
        .join("\n\n");
      return {
        id: entry.id,
        ref: entry.ref,
        date: entry.date,
        score,
        media: entry.media,
        context: context.slice(0, 4_000),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || right.id - left.id)
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)));
}

export async function searchCodexFile(indexPath, query, limit) {
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  return {
    title: index.title,
    builtAt: index.builtAt,
    entryCount: index.entryCount,
    query,
    results: searchCodex(index, query, limit),
  };
}

async function main() {
  const archiveDirectory = process.argv[2];
  const outputPath = process.argv[3];
  if (!archiveDirectory || !outputPath) {
    throw new Error(
      "Usage: node scripts/astro-codex-index.mjs ARCHIVE_DIRECTORY OUTPUT_PATH",
    );
  }
  const index = await buildCodexIndex(archiveDirectory);
  await writeFile(outputPath, `${JSON.stringify(index)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      entryCount: index.entryCount,
      mediaCount: index.mediaCount,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
