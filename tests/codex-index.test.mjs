import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTelegramHtml,
  searchCodex,
} from "../scripts/astro-codex-index.mjs";

const fixture = `
<div class="message default clearfix" id="message101">
  <div class="body">
    <div class="pull_right date details" title="30.04.2026 11:06:45 UTC+01:00">11:06</div>
    <div class="from_name">Astro Core Edge Codex</div>
    <div class="text">Every capitulation is followed by a strong bounce,<br>then a retest.</div>
  </div>
</div>
<div class="message service" id="message102"><div class="body details">Pinned</div></div>
<div class="message default clearfix" id="message103">
  <div class="body">
    <div class="pull_right date details" title="30.04.2026 11:10:26 UTC+01:00">11:10</div>
    <div class="from_name">Astro Core Edge Codex</div>
    <div class="media_wrap"><a href="photos/chart.jpg"><img src="photos/chart_thumb.jpg"></a></div>
    <div class="text">Type A is the retest setup.</div>
  </div>
</div>`;

test("Telegram Astro Codex parser preserves text, dates, and full media", () => {
  const entries = parseTelegramHtml(fixture, "messages4.html");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 101);
  assert.match(entries[0].text, /strong bounce,\nthen a retest/);
  assert.equal(entries[1].ref, "messages4.html#message103");
  assert.deepEqual(entries[1].media, ["photos/chart.jpg"]);
});

test("Astro Codex search returns relevant context without inventing matches", () => {
  const entries = parseTelegramHtml(fixture, "messages4.html");
  const index = { entries };
  const results = searchCodex(index, "Type A retest capitulation", 2);
  assert.equal(results.length, 2);
  assert.match(results[0].context, /retest/i);
  assert.deepEqual(searchCodex(index, "unrelated banana phrase", 5), []);
});
