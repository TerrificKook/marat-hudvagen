"use strict";

// Run: node tests/consent-metrika.cjs path/to/consent-metrika.js
// Requires playwright (or PLAYWRIGHT_MODULE pointing to its package directory).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const modulePath = path.resolve(process.argv[2] || "consent-metrika.js");
const source = fs.readFileSync(modulePath, "utf8");
const declaration = source.match(/const config = (\{[^\r\n]+\});/);
assert(declaration, "Site configuration is present");
const config = vm.runInNewContext(`(${declaration[1]})`);
assert.equal(config.enabled, false, "Production release gate remains off");
const testSource = source.replace("enabled: false", "enabled: true");
const origin = `https://${config.hosts[0]}`;
const indexUrl = `${origin}/`;
const goalPath = config.contentPaths[0] || "/site-final/gallery.html";
const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Проверка сайта</title><script src="/test-consent.js" defer></script></head><body><a id="contact" href="tel:+74950000000" onclick="event.preventDefault()">Позвонить</a><a id="content" href="${goalPath}" ${config.contentPaths.length ? "" : "data-photo"} onclick="event.preventDefault()">Материал</a><input id="private" value="private-sentinel@example.test"><footer></footer></body></html>`;
const fakeTag = `(() => { const prior = window.ym; const queued = prior && prior.a || []; window.__ymCalls = window.__ymCalls || []; window.ym = (...args) => window.__ymCalls.push(args); for (const args of queued) window.ym(...args); })();`;
let passed = 0;
let failed = 0;
let browser;

function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log(`PASS ${name}`); }, error => {
    failed++; console.error(`FAIL ${name}: ${error.message}`);
  });
}

async function setup(options = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", ...options });
  const requests = [];
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "mc.yandex.ru") {
      requests.push(request.url());
      if (options.delayTag) await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ status: 200, contentType: "application/javascript", body: fakeTag });
    }
    if (url.hostname === config.hosts[0]) {
      if (url.pathname === "/test-consent.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: testSource });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture });
    }
    return route.abort();
  });
  const page = await context.newPage();
  return { context, page, requests };
}

async function calls(page, kind) {
  return page.evaluate(kind => (window.__ymCalls || []).filter(call => call[1] === kind), kind);
}

async function allow(page) {
  await page.getByRole("button", { name: "Разрешить аналитику" }).click();
  await page.waitForFunction(() => (window.__ymCalls || []).some(call => call[1] === "hit"));
}

(async () => {
  try { browser = await chromium.launch({ channel: "chrome", headless: true }); }
  catch { browser = await chromium.launch({ headless: true }); }

  await check("before choice and denial: zero tag requests", async () => {
    const { context, page, requests } = await setup();
    await page.goto(indexUrl);
    assert.equal(requests.length, 0);
    await page.getByRole("button", { name: "Без аналитики" }).click();
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(id => window[`disableYaCounter${id}`], config.counterId), true);
    await context.close();
  });

  await check("allow: one init and hit, masked input, real goal IDs", async () => {
    const { context, page, requests } = await setup();
    await page.goto(indexUrl);
    await allow(page);
    assert.equal(requests.length, 1);
    assert.equal((await calls(page, "init")).length, 1);
    assert.equal((await calls(page, "hit")).length, 1);
    assert.equal((await calls(page, "init"))[0][0], config.counterId);
    assert.equal(await page.locator("#private").evaluate(el => el.classList.contains("ym-disable-keys") && el.classList.contains("ym-hide-content")), true);
    await page.locator("#contact").click();
    if (config.contactGoal) assert.equal((await calls(page, "reachGoal"))[0][2], config.contactGoal);
    else assert.equal((await calls(page, "reachGoal")).length, 0);
    await page.locator("#content").click();
    assert.equal((await calls(page, "reachGoal")).at(-1)[2], config.contentGoal);
    await page.evaluate(() => {
      const input = document.createElement("textarea");
      input.id = "late-private";
      document.body.appendChild(input);
    });
    await page.waitForFunction(() => document.querySelector("#late-private")?.classList.contains("ym-disable-keys"));
    await context.close();
  });

  await check("allowed UTM and yclid survive sanitized hit", async () => {
    const { context, page } = await setup();
    await page.goto(`${indexUrl}?utm_source=%D1%8F%D0%BD%D0%B4%D0%B5%D0%BA%D1%81&utm_medium=cpc&yclid=abc-123`);
    await allow(page);
    const hit = (await calls(page, "hit"))[0];
    assert.match(hit[2], /utm_source=%D1%8F/);
    assert.match(hit[2], /yclid=abc-123/);
    await context.close();
  });

  await check("unknown or personal query: no tag request", async () => {
    const { context, page, requests } = await setup();
    await page.goto(`${indexUrl}?email=private-sentinel%40example.test`);
    await page.getByRole("button", { name: "Разрешить аналитику" }).click();
    assert.equal(requests.length, 0);
    await context.close();
  });

  await check("failed localStorage write after allow stops live counter", async () => {
    const { context, page, requests } = await setup();
    await page.goto(indexUrl);
    await allow(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "site_analytics_choice_v2") throw new Error("storage failed");
        return original.call(this, key, value);
      };
    });
    await page.getByRole("button", { name: "Настройки аналитики" }).click();
    await page.getByRole("button", { name: "Без аналитики" }).click();
    assert.equal(await page.evaluate(id => window[`disableYaCounter${id}`], config.counterId), true);
    assert.equal((await calls(page, "destruct")).length, 1);
    const count = (await calls(page, "reachGoal")).length;
    await page.locator("#contact").click();
    assert.equal((await calls(page, "reachGoal")).length, count);
    await page.reload();
    assert.equal(requests.length, 1);
    await context.close();
  });

  await check("cross-tab revoke calls destruct in both tabs", async () => {
    const { context, page } = await setup();
    await page.goto(indexUrl);
    await allow(page);
    const other = await context.newPage();
    await other.goto(indexUrl);
    await other.waitForFunction(() => (window.__ymCalls || []).some(call => call[1] === "hit"));
    await page.getByRole("button", { name: "Настройки аналитики" }).click();
    await page.getByRole("button", { name: "Без аналитики" }).click();
    await other.waitForFunction(id => window[`disableYaCounter${id}`] === true, config.counterId);
    assert.equal((await calls(other, "destruct")).length, 1);
    await context.close();
  });

  await check("expired or older consent requires a new choice", async () => {
    const { context, page, requests } = await setup();
    await page.addInitScript(() => localStorage.setItem("site_analytics_choice_v2", JSON.stringify({ status: "allow", version: 1, at: Date.now() - 1000, until: Date.now() + 100000 })));
    await page.goto(indexUrl);
    assert.equal(requests.length, 0);
    await page.getByRole("button", { name: "Разрешить аналитику" }).waitFor();
    await context.close();
  });

  await check("mobile consent and contact remain operable", async () => {
    const { context, page } = await setup({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.goto(indexUrl);
    assert.equal(await page.locator("#contact").isVisible(), true);
    await page.getByRole("button", { name: "Без аналитики" }).click();
    assert.equal(await page.locator("#contact").isVisible(), true);
    await context.close();
  });

  await check("without JavaScript, contact is still visible", async () => {
    const { context, page, requests } = await setup({ javaScriptEnabled: false });
    await page.goto(indexUrl);
    assert.equal(await page.locator("#contact").isVisible(), true);
    assert.equal(requests.length, 0);
    await context.close();
  });

  await browser.close();
  console.log(`RESULT ${path.basename(modulePath)} ${passed} passed, ${failed} failed; transport mocked, no real delivery asserted`);
  if (failed) process.exitCode = 1;
})().catch(async error => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
