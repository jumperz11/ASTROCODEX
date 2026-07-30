# Astro Intelligence — first live forecast

Use the `astro-intelligence` MCP connector.

1. Call `get_astro_playbook` before reasoning.
2. Treat the evidence packet below as verified browser observations from the public X profile of `@astronomer_zero`.
3. Keep three layers distinct:
   - **Astro said**: only literal claims in the cited posts.
   - **Framework**: a rule from the playbook applied to those claims.
   - **Inference**: our probabilistic interpretation, never phrased as Astro's claim.
4. Build exactly three scenarios whose integer probabilities total 100.
5. Be especially careful with the apparent `67.7k` inconsistency. Astro literally posted `67.7k`, but the prior trim was `64k` and an independent spot snapshot was about `64.66k`. Do not silently correct his post to `64.7k`; flag the ambiguity and lower confidence.
6. This is research, not a trade instruction. Do not tell the user to buy, sell, size, or use leverage.
7. Call `save_astro_forecast` with the final forecast. Do not merely print JSON.

## Verified Astro evidence

### Position flip — Jul 29, 2026, 8:13 PM

URL: https://x.com/astronomer_zero/status/2082560085994434700

Key literal statements:

- “Fully closed shorts IV, and started flipping it into a long.”
- “For me, it is time to take a long.”
- He defines it as an intraweek long intended to complete the weekly move by clearing liquidity left during the week.
- He says the FOMC reversal remains in play and the 7% minimum drawdown is not finished, but 6.3%+ of the move down from his 66.3k short entry had already developed.
- He says violent countertrend bounces become more likely as a move nears completion.
- He targets the untouched weekly open and intrawweek liquidity, described as at least roughly a 2,000-point move.
- He says aggressive short IV is no longer beneficial to hold, but top short III still makes sense until most confluences confirm the FOMC reversal is over.
- TLDR: fully close aggressive short IV and flip into a new long.

### First trim — Jul 29, 2026, 10:51 PM

URL: https://x.com/astronomer_zero/status/2082599877545259450

Literal statement: the long was green and “64k is a good point to trim some initial profits.”

### Safe-house update — Jul 30, 2026, 9:34 AM

URL: https://x.com/astronomer_zero/status/2082761831953928345

Literal statement: “Kitty cat dashing her way to ‘the safe house’.” The attached chart was not reliably machine-readable, so do not invent a numeric safe-house level.

### Further profit lock — Jul 30, 2026, 11:52 AM

URL: https://x.com/astronomer_zero/status/2082796525126856769

Literal statement: “67.7k, another piece is gone,” followed by “Let’s indeed lock in this win.” The same post quotes the earlier 64k initial-profit trim. Treat `67.7k` exactly as posted and explicitly note the price inconsistency.

### Result / streak context — Jul 30, 2026, 12:09 PM

URL: https://x.com/astronomer_zero/status/2082800860153966927

Literal statement: the trade made five wins in a row. He notes a historical sequence of five wins, one loss, five wins, one loss, and says, “Let’s see if this run breaks the cycle.” Treat this as performance commentary, not a predictive market signal.

## Independent market context

- BTC spot snapshot during this run: approximately $64,663.
- Intraday high: approximately $65,040.
- Intraday low: approximately $63,252.
- This market snapshot is contextual inference input, not an Astro source and must not be listed in `sources`.

## Required conclusion discipline

- The original intraweek long has already been partially realized and publicly counted as a win.
- Do not describe a fresh full-size long as Astro's next move unless a new direct post says so.
- The most defensible near-term interpretation is reduced-risk management: locked profit, possible runner toward unfinished weekly liquidity, and continued retention of top short III until reversal confirmation.
- Make the invalidation observable and tied to new direct evidence: a fresh Astro post closing the runner, re-adding aggressive shorts, declaring the FOMC reversal complete, or defining a new numeric level.
- The `sources` array may contain only the exact direct Astro status URLs above.
