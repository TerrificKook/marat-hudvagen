"use strict";

// Pure Node regression test; no browser, network, cookies or production events.
// Run: node tests/analytics-routing.cjs [path/to/consent-metrika.js]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, "../site-final/consent-metrika.js"), "utf8");
const listeners = {};
const calls = [];
const now = Date.now();
let choice = "allow";
const location = new URL("https://www.hudwagen.ru/");
const sandbox = {
  URL, URLSearchParams, location,
  localStorage: { getItem: () => JSON.stringify({ status: choice, version: 2, at: now, until: now + 60000 }) },
  sessionStorage: { getItem: () => null },
  document: { readyState: "loading", cookie: "", addEventListener: (name, handler) => { listeners[name] = handler; } },
  window: { addEventListener() {}, ym: (...args) => calls.push(args) }
};
// Expose closure helpers only inside this test, leaving production code unchanged.
const instrumented = source.replace(/\}\)\(\);\s*$/, "window.test = { safeUrl, activate() { active = true; } }; })();");
assert.notEqual(instrumented, source);
vm.runInNewContext(instrumented, sandbox);
const api = sandbox.window.test;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function safe(query) { location.search = query; return api.safeUrl(); }
function click(href, photo = false) {
  calls.length = 0;
  const link = { href: new URL(href, location).href, getAttribute: () => href, matches: selector => photo && selector === "[data-photo]" };
  listeners.click({ target: { closest: () => link } });
  return calls.map(call => ({ name: call[2], detail: call[3] }));
}

check("root URL remains canonical", () => assert.equal(safe(""), "https://www.hudwagen.ru/"));
check("known preview version is allowed and omitted from hit", () => assert.equal(safe("?v=20261004"), "https://www.hudwagen.ru/"));
check("advertising attribution survives preview version", () => {
  const url = new URL(safe("?v=20261004&utm_source=yandex&utm_medium=cpc&utm_campaign=hudwagen_search_oct&utm_content=core&yclid=1234567890123456789"));
  assert.equal(url.searchParams.get("utm_campaign"), "hudwagen_search_oct");
  assert.equal(url.searchParams.get("yclid"), "1234567890123456789");
  assert.equal(url.searchParams.has("v"), false);
});
for (const query of ["?v=anything", "?v=79636981001", "?v=private@example.test", "?v=20261004&email=private@example.test", "?v=20261004&v=unknown", "?utm_term=private@example.test", "?utm_term=79636981001"]) {
  check(`unsafe query blocked: ${query}`, () => assert.equal(safe(query), null));
}
check("click before activation sends no goal", () => assert.equal(click("https://t.me/Art_mmm_mmm").length, 0));
api.activate();
for (const [href, channel] of [["tel:+79636981001", "phone"], ["mailto:mmm_mmm@mail.ru", "email"], ["https://t.me/+79636981001", "telegram"], ["https://telegram.me/+79636981001/", "telegram"], ["https://max.ru/u/example", "max"]]) {
  check(`contact goal: ${channel}`, () => {
    const goals = click(href);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].name, "contact_click");
    assert.equal(goals[0].detail.channel, channel);
  });
}
for (const href of ["https://t.me/Art_mmm_mmm", "https://t.me/ART_MMM_MMM/?start=video"]) {
  check(`video is never a contact: ${href}`, () => {
    const goals = click(href);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].name, "video_open");
    assert.equal(goals[0].detail.type, "telegram_channel");
  });
}
for (const href of ["https://t.me/another_channel", "https://t.me.evil.test/Art_mmm_mmm", "#terms"]) {
  check(`unrelated link sends no goal: ${href}`, () => assert.equal(click(href).length, 0));
}
check("gallery retains its own goal", () => assert.equal(click("/site-final/assets/van-city-1280.webp", true)[0].name, "content_open"));
choice = "deny";
check("denial blocks video and contact goals", () => {
  assert.equal(click("https://t.me/Art_mmm_mmm").length, 0);
  assert.equal(click("tel:+79636981001").length, 0);
});
console.log(`${passed} checks passed; no network requests or real events sent.`);
