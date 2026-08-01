import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  lessonFingerprint,
  lessonSourceReviewHash,
} from "./deepseek-thesis.mjs";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function compactText(value, fallback, limit) {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function normalizeLearningReviewState(value = {}) {
  return {
    version: 1,
    updateOffset: Number.isInteger(value?.updateOffset)
      ? value.updateOffset
      : 0,
    decisions:
      value?.decisions && typeof value.decisions === "object"
        ? value.decisions
        : {},
    posts:
      value?.posts && typeof value.posts === "object" ? value.posts : {},
    checkedAt: value?.checkedAt ?? null,
    error: value?.error ?? null,
  };
}

export function reviewableLessonCandidates(thesis, reviewState) {
  const state = normalizeLearningReviewState(reviewState);
  const seen = new Set();
  return (Array.isArray(thesis?.lessonCandidates)
    ? thesis.lessonCandidates
    : []
  )
    .map((candidate) => {
      const fingerprint =
        candidate?.fingerprint || lessonFingerprint(candidate);
      return { ...candidate, fingerprint };
    })
    .filter((candidate) => {
      if (
        !candidate.rule ||
        candidate.review?.verdict !== "supported" ||
        !candidate.review?.supportedRefs?.length ||
        state.decisions[candidate.fingerprint] ||
        seen.has(candidate.fingerprint)
      ) {
        return false;
      }
      seen.add(candidate.fingerprint);
      return true;
    })
    .sort(
      (left, right) =>
        new Date(left.candidateAt || 0).getTime() -
        new Date(right.candidateAt || 0).getTime(),
    );
}

export function activeReviewPost(reviewState) {
  const state = normalizeLearningReviewState(reviewState);
  return Object.values(state.posts).find(
    (post) => post?.status === "pending",
  ) ?? null;
}

export function renderLessonReview(candidate) {
  return [
    "🧠 HERMES LEARNING REVIEW",
    "",
    `CATEGORY · ${compactText(candidate.category, "setup", 40).toUpperCase()}`,
    "",
    "PROPOSED RULE",
    compactText(candidate.rule, "Unknown", 700),
    "",
    "USE IT WHEN",
    compactText(candidate.when, "Unknown", 500),
    "",
    "EXPECTED SEQUENCE",
    compactText(candidate.sequence, "Unknown", 700),
    "",
    "DO NOT USE IT WHEN",
    compactText(candidate.failsWhen, "Unknown", 500),
    "",
    `SOURCE CHECK · ${candidate.review?.supportedRefs?.length || 0} item(s) verified`,
    compactText(
      candidate.review?.reason,
      "DeepSeek found direct source support.",
      500,
    ),
    "",
    "Approve only if this is a reusable Astro habit—not just a one-off trade.",
  ].join("\n").slice(0, 3900);
}

export function callbackData(action, fingerprint) {
  return `learn:${action}:${String(fingerprint).slice(0, 24)}`;
}

export function parseLearningCallback(value) {
  const match = /^learn:(approve|reject):([a-f0-9]{16,24})$/.exec(
    String(value || ""),
  );
  return match ? { action: match[1], fingerprintPrefix: match[2] } : null;
}

function candidateByPrefix(thesis, fingerprintPrefix) {
  const matches = (Array.isArray(thesis?.lessonCandidates)
    ? thesis.lessonCandidates
    : []
  )
    .map((candidate) => ({
      ...candidate,
      fingerprint: candidate?.fingerprint || lessonFingerprint(candidate),
    }))
    .filter((candidate) =>
      candidate.fingerprint.startsWith(fingerprintPrefix),
    );
  return matches.length === 1 ? matches[0] : null;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

async function run() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const threadId = Number.parseInt(
    process.env.TELEGRAM_LEARNING_THREAD_ID || "",
    10,
  );
  const reviewerId = Number.parseInt(
    process.env.TELEGRAM_REVIEWER_USER_ID || "",
    10,
  );
  const stateDirectory =
    process.env.ASTRO_STATE_DIR?.trim() || "/var/lib/astro-signal";
  const thesisPath = join(stateDirectory, "deepseek-thesis.json");
  const statePath = join(stateDirectory, "learning-review.json");

  if (
    !botToken ||
    !chatId ||
    !Number.isInteger(threadId) ||
    threadId <= 0 ||
    !Number.isInteger(reviewerId)
  ) {
    throw new Error(
      "Telegram learning review requires bot, chat, thread, and reviewer IDs.",
    );
  }

  const api = `https://api.telegram.org/bot${botToken}`;
  const telegram = async (method, body = {}) => {
    const response = await fetch(`${api}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(
        `Telegram ${method} failed (${response.status}): ${payload?.description || "unknown error"}`,
      );
    }
    return payload.result;
  };

  let state = normalizeLearningReviewState(
    await readJson(statePath, {}),
  );

  while (true) {
    try {
      const thesis = await readJson(thesisPath, {});
      const updates = await telegram("getUpdates", {
        offset: state.updateOffset,
        timeout: 25,
        allowed_updates: ["callback_query"],
      });

      for (const update of updates) {
        state.updateOffset = Math.max(
          state.updateOffset,
          Number(update.update_id) + 1,
        );
        const callback = update.callback_query;
        const parsed = parseLearningCallback(callback?.data);
        if (!parsed) continue;

        if (Number(callback?.from?.id) !== reviewerId) {
          await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Only the configured owner can review Hermes lessons.",
            show_alert: true,
          });
          continue;
        }

        const candidate = candidateByPrefix(
          thesis,
          parsed.fingerprintPrefix,
        );
        if (!candidate) {
          await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This lesson is no longer available.",
            show_alert: true,
          });
          continue;
        }

        const status =
          parsed.action === "approve" ? "approved" : "rejected";
        const decidedAt = new Date().toISOString();
        state.decisions[candidate.fingerprint] = {
          status,
          reviewerId,
          decidedAt,
          sourceReviewHash: lessonSourceReviewHash(candidate.review),
        };
        const existingPost = state.posts[candidate.fingerprint];
        if (existingPost) {
          state.posts[candidate.fingerprint] = {
            ...existingPost,
            status,
            decidedAt,
          };
        }
        await writeJsonAtomic(statePath, {
          ...state,
          checkedAt: decidedAt,
          error: null,
        });
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text:
            status === "approved"
              ? "Approved. Hermes will use this in future predictions."
              : "Rejected. This will not enter Hermes memory.",
        });
        await telegram("editMessageText", {
          chat_id: chatId,
          message_id: callback.message?.message_id,
          text: `${renderLessonReview(candidate)}\n\n${
            status === "approved" ? "✅ APPROVED BY YOU" : "❌ REJECTED BY YOU"
          }`,
          reply_markup: { inline_keyboard: [] },
        });
      }

      if (!activeReviewPost(state)) {
        const candidate = reviewableLessonCandidates(thesis, state)[0];
        if (candidate) {
          const text = renderLessonReview(candidate);
          const message = await telegram("sendMessage", {
            chat_id: chatId,
            message_thread_id: threadId,
            text,
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Approve",
                    callback_data: callbackData(
                      "approve",
                      candidate.fingerprint,
                    ),
                  },
                  {
                    text: "❌ Reject",
                    callback_data: callbackData(
                      "reject",
                      candidate.fingerprint,
                    ),
                  },
                ],
              ],
            },
          });
          state.posts[candidate.fingerprint] = {
            fingerprint: candidate.fingerprint,
            messageId: message.message_id,
            threadId,
            text,
            status: "pending",
            postedAt: new Date().toISOString(),
          };
        }
      }

      state.checkedAt = new Date().toISOString();
      state.error = null;
      await writeJsonAtomic(statePath, state);
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : "Unknown review worker error.";
      state.checkedAt = new Date().toISOString();
      await writeJsonAtomic(statePath, state);
      await sleep(5_000);
    }
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : error}\n`,
    );
    process.exitCode = 1;
  });
}
