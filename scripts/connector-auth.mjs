import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const stateDirectory = join(projectRoot, ".astro");
const credentialsPath = join(stateDirectory, "connector.json");

function validCredentials(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.ownerCode === "string" &&
    value.ownerCode.length >= 12 &&
    typeof value.accessToken === "string" &&
    value.accessToken.length >= 32
  );
}

export async function ensureConnectorCredentials() {
  try {
    const stored = JSON.parse(await readFile(credentialsPath, "utf8"));
    if (validCredentials(stored)) return stored;
  } catch {
    // First run, or an invalid local file: create fresh private credentials.
  }

  const credentials = {
    ownerCode: randomBytes(12).toString("base64url"),
    accessToken: randomBytes(32).toString("base64url"),
  };
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    credentialsPath,
    `${JSON.stringify(credentials, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(credentialsPath, 0o600);
  return credentials;
}
