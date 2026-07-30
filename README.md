# Astro Intelligence

Astro Intelligence is a private research terminal that models the public
decision process of X trader
[@astronomer_zero](https://x.com/astronomer_zero).

It does **not** claim access to Astro's private intent and it does not execute
trades. It separates direct Astro statements, versioned framework rules, and
model inference so every forecast can be audited.

## What is working

- Grok is authenticated with the user's existing `grok.com` OAuth session.
- A local, token-protected MCP connector exposes the Astro playbook and forecast
  store to Grok.
- Grok must cite exact
  `x.com/astronomer_zero/status/...` URLs before the connector accepts a
  forecast.
- Forecasts must contain Astro, framework, and inference evidence plus exactly
  three scenarios totaling 100%.
- The latest accepted forecast is saved to `public/forecast.json` and rendered
  by the private dashboard.
- No `XAI_API_KEY` is used or required.

## One-time setup

Requirements:

- Node.js `>=22.13.0`
- The `grok` CLI installed and signed in with `grok login --oauth`

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
