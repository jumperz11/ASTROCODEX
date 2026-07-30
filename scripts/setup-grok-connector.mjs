import { spawn } from "node:child_process";
import { once } from "node:events";
import { ensureConnectorCredentials } from "./connector-auth.mjs";

const { accessToken } = await ensureConnectorCredentials();
const child = spawn(
  "grok",
  [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "http",
    "astro-intelligence",
    "http://127.0.0.1:4318/mcp",
    "--header",
    `Authorization: Bearer ${accessToken}`,
  ],
  { stdio: "inherit" },
);
const [code] = await once(child, "exit");
if (code !== 0) {
  process.exitCode = code || 1;
} else {
  process.stdout.write(
    "Grok is configured for the local Astro Intelligence connector.\n",
  );
}
