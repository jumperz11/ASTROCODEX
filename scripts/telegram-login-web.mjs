import { createServer } from "node:http";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import QRCode from "qrcode";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
const stateDirectory =
  process.env.ASTRO_STATE_DIR?.trim() || join(process.cwd(), ".astro-runtime");
const sessionPath = join(stateDirectory, "telegram-user.session");
const port = Number.parseInt(process.env.ASTRO_TELEGRAM_LOGIN_PORT || "8792", 10);

if (!Number.isInteger(apiId) || !apiHash) {
  throw new Error("Telegram application credentials are missing.");
}

let qrImage = null;
let status = "Preparing secure Telegram login…";
let passwordResolver = null;
let submittedPassword = null;

async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function page() {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="cache-control" content="no-store">
<title>Connect Telegram</title>
<style>
body{margin:0;background:#090b0e;color:#f5f2ea;font:16px system-ui;display:grid;min-height:100vh;place-items:center}
main{width:min(92vw,430px);background:#11151a;border:1px solid #2a3038;border-radius:22px;padding:24px;box-sizing:border-box}
h1{font-size:25px;margin:0 0 8px}p{color:#aeb5c0;line-height:1.45}img{display:block;width:100%;background:white;border-radius:14px;margin:18px 0}
label{display:block;font-size:13px;color:#aeb5c0;margin:18px 0 7px}input,button{width:100%;box-sizing:border-box;border-radius:11px;padding:14px;font:inherit}
input{background:#090b0e;color:white;border:1px solid #343b46}button{margin-top:10px;border:0;background:#ffb000;color:#090b0e;font-weight:800}
small{display:block;margin-top:14px;color:#707985}.status{color:#52e6a7;font-weight:700}
</style>
<main>
  <h1>Connect Telegram</h1>
  <p>In Telegram: Settings → Devices → Link Desktop Device, then scan this QR.</p>
  <img id="qr" src="/telegram-login/qr?t=${Date.now()}" alt="Telegram login QR">
  <form method="post" action="/telegram-login/password">
    <label>Telegram two-step-verification password</label>
    <input name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Finish secure login</button>
  </form>
  <p class="status">${status}</p>
  <small>The password is held only in memory for this one login and is never written to disk.</small>
</main>
<script>
setInterval(()=>{document.querySelector("#qr").src="/telegram-login/qr?t="+Date.now()},5000);
setInterval(()=>fetch("/telegram-login/status",{cache:"no-store"}).then(r=>r.text()).then(t=>{
 document.querySelector(".status").textContent=t;
 if(t.includes("Connected")) document.querySelector("form").remove();
}),3000);
</script>
</html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET" && request.url?.startsWith("/telegram-login/qr")) {
    if (!qrImage) {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end("QR is still preparing. Refresh in a few seconds.");
      return;
    }
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(qrImage);
    return;
  }
  if (request.method === "GET" && request.url === "/telegram-login/status") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status);
    return;
  }
  if (request.method === "POST" && request.url === "/telegram-login/password") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_048) break;
    }
    const password = new URLSearchParams(body).get("password") || "";
    if (!password) {
      response.writeHead(400);
      response.end("Password is required.");
      return;
    }
    submittedPassword = password;
    passwordResolver?.(password);
    passwordResolver = null;
    response.writeHead(303, { Location: "/telegram-login" });
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/telegram-login") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page());
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
server.listen(port, "127.0.0.1");

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
  autoReconnect: true,
});
await client.connect();
try {
  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async ({ token }) => {
        qrImage = await QRCode.toBuffer(
          `tg://login?token=${token.toString("base64url")}`,
          { errorCorrectionLevel: "M", margin: 2, width: 720 },
        );
        status = "QR ready. Scan it, then enter your two-step password.";
      },
      password: async () => {
        status = "QR accepted. Enter your two-step password below.";
        if (submittedPassword) {
          const password = submittedPassword;
          submittedPassword = null;
          return password;
        }
        return await new Promise((resolve) => {
          passwordResolver = resolve;
        });
      },
      onError: (error) => {
        status = `Login not complete: ${error.message}`;
      },
    },
  );
  await writeAtomic(sessionPath, `${client.session.save()}\n`);
  status = "Connected. You can close this page.";
  qrImage = null;
  process.stdout.write("TELEGRAM_SESSION_SAVED\n");
} finally {
  await client.disconnect();
}

setTimeout(() => server.close(), 300_000).unref();
