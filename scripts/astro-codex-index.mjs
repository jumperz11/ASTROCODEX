import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

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

export function parseTelegramHtml(
  html,
  sourceFile = "messages.html",
  mediaPrefix = "",
  sourceName = "Astro Core Edge Codex",
) {
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
            /^(?:photos|images|video_files|voice_messages|files|audio_files)\//.test(
              path,
            ) && !path.includes("_thumb."),
        )
        .map((path) => (mediaPrefix ? join(mediaPrefix, path) : path));
      if (!text && media.length === 0) return [];
      return [
        {
          id: Number(id),
          ref: `${sourceFile}#message${id}`,
          source: sourceName,
          date,
          author,
          text: text || "[Media-only chart or attachment]",
          media: [...new Set(media)],
        },
      ];
    });
}

async function telegramSourceFiles(archiveDirectory, directory = archiveDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await telegramSourceFiles(archiveDirectory, absolutePath)));
    } else if (/^messages\d*\.html$/i.test(entry.name)) {
      files.push(relative(archiveDirectory, absolutePath));
    }
  }
  return files;
}

function sourceFileNumber(name) {
  return Number(basename(name).match(/\d+/)?.[0] ?? "1");
}

function messageFingerprint(message) {
  return createHash("sha256")
    .update(
      [
        message.date,
        message.author,
        message.text.replace(/\s+/g, " ").trim(),
        message.media.map((path) => basename(path)).join(","),
      ].join("\u0000"),
    )
    .digest("hex");
}

export async function buildCodexIndex(archiveDirectory, liveSourcePath = null) {
  const sourceFiles = (await telegramSourceFiles(archiveDirectory))
    .sort((left, right) => {
      const leftDirectory = dirname(left);
      const rightDirectory = dirname(right);
      return (
        leftDirectory.localeCompare(rightDirectory) ||
        sourceFileNumber(left) - sourceFileNumber(right)
      );
    });
  const messages = [];
  for (const sourceFile of sourceFiles) {
    const html = await readFile(join(archiveDirectory, sourceFile), "utf8");
    const mediaPrefix = dirname(sourceFile) === "." ? "" : dirname(sourceFile);
    const sourceName =
      mediaPrefix || basename(archiveDirectory) || "Astro Telegram archive";
    messages.push(
      ...parseTelegramHtml(html, sourceFile, mediaPrefix, sourceName),
    );
  }
  if (liveSourcePath) {
    try {
      const liveSource = JSON.parse(await readFile(liveSourcePath, "utf8"));
      for (const message of liveSource.messages ?? []) {
        if (!message?.chatTitle || !message?.postedAt) continue;
        const text = String(message.text || "").trim();
        const media = message.mediaPath ? [String(message.mediaPath)] : [];
        if (!text && media.length === 0) continue;
        messages.push({
          id: Number(message.messageId || 0),
          ref: `telegram-live:${message.chatId}:${message.messageId}`,
          source: String(message.chatTitle),
          date: String(message.editedAt || message.postedAt),
          author: "AstronomerZero",
          text: text || "[Media-only live chart or attachment]",
          media,
        });
      }
    } catch {
      // A missing live ledger must not prevent the protected archive rebuild.
    }
  }
  const byFingerprint = new Map();
  for (const message of messages) {
    const fingerprint = messageFingerprint(message);
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, {
        ...message,
        sources: [message.source],
      });
    } else if (!existing.sources.includes(message.source)) {
      existing.sources.push(message.source);
    }
  }
  const entries = [...byFingerprint.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) || left.id - right.id,
  );
  const archiveSources = [
    ...new Set(entries.flatMap((entry) => entry.sources)),
  ].sort();
  return {
    version: 1,
    title: "Astro Core Edge Codex",
    builtAt: new Date().toISOString(),
    archive: basename(archiveDirectory),
    archiveSources,
    sourceFiles,
    liveSourcePath,
    duplicateCount: messages.length - entries.length,
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
      const haystack =
        `${entry.source} ${entry.sources?.join(" ") || ""} ${entry.date} ${entry.text}`.toLowerCase();
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
        .map(
          (item) =>
            `[${item.source} · ${item.ref} · ${item.date}]\n${item.text}`,
        )
        .join("\n\n");
      return {
        id: entry.id,
        ref: entry.ref,
        source: entry.source,
        sources: entry.sources,
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
  const liveSourcePath = process.argv[4];
  if (!archiveDirectory || !outputPath) {
    throw new Error(
      "Usage: node scripts/astro-codex-index.mjs ARCHIVE_DIRECTORY OUTPUT_PATH",
    );
  }
  const index = await buildCodexIndex(archiveDirectory, liveSourcePath);
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
