# Astro Intelligence

## Always-on architecture

The production loop runs entirely on the VPS:

- Telegram user ingestion watches exactly the two approved Astro channels
  continuously without an AI call.
- `astro-x-scout.timer` asks Grok OAuth only for new direct
  `@astronomer_zero` X posts every 30 minutes. It cannot build a forecast and
  is capped at 60 short checks per rolling day.
- `astro-scan.timer` checks market and evidence state every two minutes using
  local code. No model runs when nothing material changed.
- On a real event, the latest configured DeepSeek V4 Flash route performs
  repetitive classification, campaign linking, contradiction checks, and a
  compact Luna briefing (100/day maximum). Luna Light is the bounded fallback
  (8/day), and Luna Medium alone may rebuild the Hermes strategy thesis
  (5/day).
- `astro-deepseek-background.timer` keeps a durable internal Astro thesis
  current and steadily distills the protected 14k+ message school archive in
  cited batches. The worker is always scheduled, but skips paid calls when the
  thesis is fresh and the school queue is empty.
- The protected Astro Codex connector gives Luna Medium the archived playbook
  and historical search needed to connect the evidence.
- `astro-signal.service` serves the last validated forecast through a
  token-protected HTTPS endpoint.
- `astro-autoresearch.timer` scores market paths and Astro-behavior predictions
  as separate tracks. It runs a guarded nightly shadow experiment only after a
  track has enough frozen outcomes, uses a chronological holdout, and can never
  modify the live forecast or playbook.
- `astro-watchdog.timer` checks freshness every five minutes and invokes
  `astro-recovery.service` if the API or scan loop becomes unhealthy.

The private dashboard only reads the protected endpoint. It does not perform
research, trade execution, or background agent work. If research fails, the
last validated forecast remains available and health reports the failure.

Astro Intelligence is a private research terminal that models the public
decision process of X trader
[@astronomer_zero](https://x.com/astronomer_zero).

It does **not** claim access to Astro's private intent and it does not execute
trades. It separates direct Astro statements, versioned framework rules, and
model inference so every forecast can be audited.

## What is working

- Grok is authenticated with the user's existing `grok.com` OAuth session and
  is restricted to direct X retrieval.
- DeepSeek V4 Flash handles repetitive evidence work and compact briefings, with
  thinking disabled and a hard rolling cap. Direct DeepSeek and
  OpenRouter-compatible credentials are supported.
- Codex CLI is authenticated on the VPS. Luna Light handles only fallback
  classification; Luna Medium is reserved for material strategy work.
- A local, token-protected MCP connector exposes the Astro playbook and forecast
  store to Luna Medium, plus read-only search over the private Astro Codex index.
- DeepSeek's background thesis, school progress, evidence packet, and
  autoresearch calibration are stored as separate internal artifacts. Luna
  receives them as research context and must verify their cited sources before
  saving anything.
- Any accepted public Astro claim must cite exact
  `x.com/astronomer_zero/status/...` URLs before the connector accepts a
  forecast.
- Forecasts must contain Astro, framework, and inference evidence plus exactly
  three scenarios totaling 100%.
- The latest accepted forecast is saved to `public/forecast.json` and rendered
  by the private dashboard.
- No `XAI_API_KEY` is used or required.

## Astro Codex memory

Build the private search index from a Telegram HTML export:

```bash
npm run astro:codex:index -- /path/to/ChatExport /private/path/codex-index.json
```

On the VPS, `ASTRO_CODEX_INDEX` points to that private index. The archive and
index are never deployed with the public dashboard. Retrieved Codex messages
are historical framework context only; they cannot establish a current
position without a fresh direct X post. The nightly rebuild carries forward
older live Telegram entries after they leave the rolling ingestion window, so
the school does not forget approved messages.

The full component map, data ownership rules, schedules, failure behavior, and
long-term prediction loop are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## One-time setup

Requirements:

- Node.js `>=22.13.0`
- The `grok` CLI installed and signed in with `grok login --oauth`
- The Codex CLI installed and signed in with `codex login --device-auth`
- Optional `DEEPSEEK_API_KEY` stored only in the VPS environment file. Without
  it, Luna Light automatically handles the bounded evidence gate.

Install dependencies and register the local connector:

```bash
npm install
npm run astro:setup
```

The setup command creates private connector credentials in the gitignored
`.astro/` directory and adds the connector to the user's Grok configuration.

## Run a new forecast

The single-command workflow starts the private connector when needed, asks Grok
to research current Astro posts, validates the result, saves it, and then stops
the temporary connector:

```bash
npm run astro:run -- "What is Astro likely thinking and doing next?"
```

If Grok cannot verify direct current status URLs, the validator refuses to save
the forecast. The existing validated snapshot remains untouched.

For an interactive Grok session, keep the connector running in one terminal:

```bash
npm run astro:connector
```

Then open `grok` from this project and ask it to call
`get_astro_playbook`, research Astro's latest public X sequence, and call
`save_astro_forecast`.

## Dashboard

Run the dashboard locally:

```bash
npm run dev
```

The dashboard reads `public/forecast.json`. After a successful agent run, use
**Refresh snapshot** in the UI.

Useful checks:

```bash
npm run lint
npm test
grok mcp doctor astro-intelligence
```

## Evidence boundary

The system deliberately treats:

- **Astro said** as a literal, directly cited public post;
- **Framework** as a versioned rule extracted from the supplied archive;
- **Inference** as a probabilistic model conclusion.

Confidence measures evidence alignment, not the probability of profit. Human
judgment remains the final gate.
