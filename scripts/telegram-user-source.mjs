import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TelegramClient, utils } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const mode = process.argv[2] || "ingest";
const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(process.cwd(), ".astro-runtime");
const sessionPath =
  process.env.ASTRO_TELEGRAM_USER_SESSION_PATH?.trim() ||
  join(stateDirectory, "telegram-user.session");
const sourcePath =
  process.env.ASTRO_TELEGRAM_SOURCE_PATH?.trim() ||
  join(stateDirectory, "telegram-source.json");
const mediaDirectory = join(stateDirectory, "telegram-media");
const sourceSelectors = (process.env.ASTRO_TELEGRAM_USER_SOURCE_CHATS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(apiId) || !apiHash) {
  throw new Error(
    "TELEGRAM_API_ID and TELEGRAM_API_HASH are required. Create them at my.telegram.org.",
  );
}

async function readText(path, fallback = "") {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return fallback;
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeAtomic(path, value, mode = 0o600) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode });
  await rename(temporary, path);
}

function peerId(entity) {
  try {
    return String(utils.getPeerId(entity));
  } catch {
    return entity?.id === undefined ? "" : String(entity.id);
  }
}

function dialogRecord(dialog) {
  const entity = dialog.entity;
  return {
    id: peerId(entity),
    title: dialog.title || entity?.title || "Untitled Telegram chat",
    username: entity?.username || null,
    type: entity?.className || "Telegram chat",
    entity,
  };
}

function selectorMatches(dialog, selector) {
  const normalized = selector.toLowerCase().replace(/^@/, "");
  const rawId = dialog.entity?.id === undefined ? "" : String(dialog.entity.id);
  return (
    dialog.id === selector ||
    rawId === selector ||
    dialog.username?.toLowerCase() === normalized ||
    dialog.title.toLowerCase() === normalized
  );
}

async function connectedClient() {
  const session = new StringSession(await readText(sessionPath));
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });
  await client.connect();
  return client;
}

async function login() {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const client = await connectedClient();
  if (!(await client.checkAuthorization())) {
    const terminal = createInterface({ input, output });
    try {
      await client.start({
        phoneNumber: async () =>
          (await terminal.question("Telegram phone number (with +country code): ")).trim(),
        phoneCode: async () =>
          (await terminal.question("Telegram login code: ")).trim(),
        password: async () =>
          (await terminal.question("Telegram 2FA password (if enabled): ")).trim(),
        onError: (error) => {
          process.stderr.write(`${error.message}\n`);
        },
      });
    } finally {
      terminal.close();
    }
  }
  await writeAtomic(sessionPath, `${client.session.save()}\n`);
  const me = await client.getMe();
  process.stdout.write(
    `Telegram user session saved securely for ${me?.username ? `@${me.username}` : "the signed-in account"}.\n`,
  );
  await client.disconnect();
}

async function listDialogs() {
  const client = await connectedClient();
  if (!(await client.checkAuthorization())) {
    throw new Error("Telegram user session is not authorized. Run telegram:user:login first.");
  }
  const dialogs = await client.getDialogs({ limit: 500 });
  const rows = dialogs
    .map(dialogRecord)
    .filter((dialog) => dialog.title || dialog.username)
    .sort((left, right) => left.title.localeCompare(right.title));
  for (const row of rows) {
    process.stdout.write(
      `${row.id}\t${row.username ? `@${row.username}` : "-"}\t${row.title}\n`,
    );
  }
  await client.disconnect();
}

async function downloadChart(client, message, id) {
  if (!message?.photo) return null;
  try {
    const bytes = await client.downloadMedia(message, {});
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 12_000_000) {
      return null;
    }
    const path = join(mediaDirectory, `${id.replaceAll(":", "-")}.jpg`);
    await writeFile(path, bytes, { mode: 0o600 });
    return path;
  } catch {
    return null;
  }
}

function messageDate(message) {
  if (message?.date instanceof Date) return message.date.toISOString();
  const seconds = Number(message?.date || 0);
  return new Date(seconds > 10_000_000_000 ? seconds : seconds * 1000).toISOString();
}

async function ingestOnce(client) {
  const dialogs = (await client.getDialogs({ limit: 500 })).map(dialogRecord);
  const selected = dialogs.filter((dialog) =>
    sourceSelectors.some((selector) => selectorMatches(dialog, selector)),
  );
  if (selected.length !== sourceSelectors.length) {
    const found = new Set(
      sourceSelectors.filter((selector) =>
        selected.some((dialog) => selectorMatches(dialog, selector)),
      ),
    );
    const missing = sourceSelectors.filter((selector) => !found.has(selector));
    throw new Error(
      `Telegram sources not found: ${missing.join(", ")}. Run telegram:user:list and configure exact IDs.`,
    );
  }

  const state = await readJson(sourcePath, {
    version: 2,
    updatedAt: null,
    newestAcceptedAt: null,
    discoveredChats: [],
    messages: [],
  });
  const known = new Map(
    (Array.isArray(state.messages) ? state.messages : []).map((message) => [
      message.id,
      message,
    ]),
  );
  let newestAcceptedAt = state.newestAcceptedAt || null;

  for (const dialog of selected) {
    const messages = await client.getMessages(dialog.entity, { limit: 100 });
    for (const message of [...messages].reverse()) {
      if (!message?.id || (!message.message && !message.photo)) continue;
      const id = `telegram-user:${dialog.id}:${message.id}`;
      const existing = known.get(id);
      const postedAt = messageDate(message);
      const mediaPath =
        existing?.mediaPath || (await downloadChart(client, message, id));
      known.set(id, {
        id,
        chatId: dialog.id,
        chatTitle: dialog.title,
        chatUsername: dialog.username,
        messageId: message.id,
        postedAt,
        editedAt: message.editDate ? messageDate({ date: message.editDate }) : null,
        text: String(message.message || "").slice(0, 12_000),
        mediaPath,
        sourceKind: "user-session",
      });
      if (!newestAcceptedAt || postedAt > newestAcceptedAt) {
        newestAcceptedAt = postedAt;
      }
    }
  }

  await writeAtomic(
    sourcePath,
    `${JSON.stringify(
      {
        version: 2,
        mode: "telegram-user-read-only",
        updatedAt: new Date().toISOString(),
        newestAcceptedAt,
        allowlist: selected.map((dialog) => dialog.id),
        discoveredChats: selected.map((dialog) => ({
          id: dialog.id,
          title: dialog.title,
          username: dialog.username,
          type: dialog.type,
          allowed: true,
          lastSeenAt: new Date().toISOString(),
        })),
        messages: [...known.values()]
          .sort((left, right) => left.postedAt.localeCompare(right.postedAt))
          .slice(-5000),
      },
      null,
      2,
    )}\n`,
  );
}

async function ingest() {
  if (sourceSelectors.length !== 2) {
    throw new Error(
      "ASTRO_TELEGRAM_USER_SOURCE_CHATS must contain exactly the two approved Astro chat IDs.",
    );
  }
  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  const client = await connectedClient();
  if (!(await client.checkAuthorization())) {
    throw new Error("Telegram user session is not authorized. Run telegram:user:login first.");
  }
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      await ingestOnce(client);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Telegram user ingestion error"}\n`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  await client.disconnect();
}

if (mode === "login") await login();
else if (mode === "list") await listDialogs();
else if (mode === "ingest") await ingest();
else throw new Error(`Unknown mode: ${mode}`);
