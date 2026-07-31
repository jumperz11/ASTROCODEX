import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const destinationChatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(process.cwd(), ".astro-runtime");
const sourcePath = join(stateDirectory, "telegram-source.json");
const mediaDirectory = join(stateDirectory, "telegram-media");
const allowedChats = new Set(
  (process.env.ASTRO_TELEGRAM_SOURCE_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const api = botToken ? `https://api.telegram.org/bot${botToken}` : "";

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram ingestion.");
}

async function readState() {
  try {
    return JSON.parse(await readFile(sourcePath, "utf8"));
  } catch {
    return {
      version: 1,
      offset: 0,
      updatedAt: null,
      discoveredChats: [],
      messages: [],
    };
  }
}

async function writeState(value) {
  const temporary = `${sourcePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, sourcePath);
}

async function telegram(method, body = {}) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload?.description || `Telegram ${method} returned HTTP ${response.status}.`,
    );
  }
  return payload.result;
}

function updateMessage(update) {
  return (
    update.channel_post ??
    update.edited_channel_post ??
    update.message ??
    update.edited_message ??
    null
  );
}

function chatRecord(chat) {
  return {
    id: String(chat.id),
    title:
      chat.title ||
      [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
      chat.username ||
      "Untitled Telegram chat",
    username: chat.username ?? null,
    type: chat.type,
    allowed: allowedChats.has(String(chat.id)),
    lastSeenAt: new Date().toISOString(),
  };
}

async function savePhoto(message, id) {
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
  if (!photo?.file_id) return null;
  try {
    const file = await telegram("getFile", { file_id: photo.file_id });
    if (!file?.file_path) return null;
    const extension = file.file_path.split(".").at(-1) || "jpg";
    const safeName = `${id.replaceAll(":", "-")}.${extension}`;
    const destination = join(mediaDirectory, safeName);
    const response = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 12_000_000) return null;
    await writeFile(destination, bytes, { mode: 0o600 });
    return destination;
  } catch {
    return null;
  }
}

async function applyUpdates(state, updates) {
  const discovered = new Map(
    (state.discoveredChats || []).map((chat) => [String(chat.id), chat]),
  );
  const messages = Array.isArray(state.messages) ? [...state.messages] : [];
  const known = new Map(messages.map((message) => [message.id, message]));
  let newestAcceptedAt = state.newestAcceptedAt ?? null;

  for (const update of updates) {
    state.offset = Math.max(Number(state.offset || 0), update.update_id + 1);
    const message = updateMessage(update);
    if (!message?.chat?.id) continue;
    const chat = chatRecord(message.chat);
    discovered.set(chat.id, {
      ...discovered.get(chat.id),
      ...chat,
    });
    if (
      chat.id === destinationChatId ||
      !allowedChats.has(chat.id)
    ) {
      continue;
    }
    const id = `telegram:${chat.id}:${message.message_id}`;
    const mediaPath = await savePhoto(message, id);
    const record = {
      id,
      chatId: chat.id,
      chatTitle: chat.title,
      chatUsername: chat.username,
      messageId: message.message_id,
      threadId: message.message_thread_id ?? null,
      postedAt: new Date(Number(message.date) * 1000).toISOString(),
      editedAt: message.edit_date
        ? new Date(Number(message.edit_date) * 1000).toISOString()
        : null,
      text: String(message.text || message.caption || "").slice(0, 12_000),
      mediaPath,
      sourceKind: message.sender_chat ? "channel" : "group",
    };
    known.set(id, record);
    newestAcceptedAt = record.editedAt || record.postedAt;
  }

  return {
    version: 1,
    offset: state.offset,
    updatedAt: new Date().toISOString(),
    newestAcceptedAt,
    allowlist: [...allowedChats],
    discoveredChats: [...discovered.values()].sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
    messages: [...known.values()]
      .sort((left, right) => left.postedAt.localeCompare(right.postedAt))
      .slice(-5000),
  };
}

await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
let state = await readState();
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

while (!stopping) {
  try {
    const updates = await telegram("getUpdates", {
      offset: Number(state.offset || 0),
      timeout: 25,
      allowed_updates: [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
      ],
    });
    if (updates.length > 0) {
      state = await applyUpdates(state, updates);
      await writeState(state);
    } else if (!state.updatedAt) {
      state = { ...state, updatedAt: new Date().toISOString() };
      await writeState(state);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Telegram ingestion error"}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
