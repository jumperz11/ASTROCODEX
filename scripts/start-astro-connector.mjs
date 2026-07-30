import { spawn } from "node:child_process";
import { once } from "node:events";
import { ensureConnectorCredentials } from "./connector-auth.mjs";

const { ownerCode, accessToken } = await ensureConnectorCredentials();
const server = spawn("node", ["scripts/astro-mcp-server.mjs"], {
  env: {
    ...process.env,
    ASTRO_OWNER_CODE: ownerCode,
    ASTRO_STATIC_ACCESS_TOKEN: accessToken,
    ASTRO_PUBLIC_URL: "http://127.0.0.1:4318",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

function stop(signal = "SIGTERM") {
  if (!server.killed) server.kill(signal);
}

process.stdout.write("Starting the private local Astro connector.\n");
process.stdout.write("Run `npm run astro:setup` once to register it with Grok.\n");
process.stdout.write("Keep this process running while Grok uses the connector.\n\n");

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const [code] = await once(server, "exit");
process.exitCode = code || 0;
