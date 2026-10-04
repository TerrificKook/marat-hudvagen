"use strict";

// Owner approved activation on 2026-10-03; visitor consent is still required.
(() => {
  const config = { enabled: true, counterId: 113163390, hosts: ["www.hudwagen.ru", "hudwagen.ru"], notice: "/site-final/analytics-consent.html", contactGoal: "contact_click", videoGoal: "video_open", contentGoal: "content_open", contentPaths: [] };
  if (!config.enabled || !Number.isSafeInteger(config.counterId) ||
      !config.hosts.includes(location.hostname)) return;

  const key = "site_analytics_choice_v2";
  const optOutKey = "site_analytics_optout_v2";
  const version = 2;
  const lifetime = 180 * 24 * 60 * 60 * 1000; // Project setting, not a legal retention period.
  const disableKey = `disableYaCounter${config.counterId}`;
  const safePath = /^\/[a-z0-9/_.-]*$/i.test(location.pathname) &&
    !/\d{7,}/.test(location.pathname) ? location.pathname : null;
  let active = false;
  let started = false;
  let revoked = false;
  let panel;
  let script;
  let inputObserver;
  let expiryTimer;
  let loadTimer;
  let initialized = false;
  let statusText = "Аналитика выключена до вашего разрешения.";
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(key) : null;

  function setStatus(text) {
    statusText = text;
    const status = panel?.querySelector(".analytics-status");
    if (status && status.textContent !== text) status.textContent = text;
  }

  function fallbackDenied() {
    try {
      const until = Number(sessionStorage.getItem(optOutKey));
      if (until > Date.now() && until - Date.now() <= lifetime) return true;
      if (until) sessionStorage.removeItem(optOutKey);
    } catch { /* unavailable */ }
    try { return document.cookie.split(";").some(part => part.trim() === `${optOutKey}=1`); }
    catch { return false; }
  }

  function setFallbackDenied() {
    try { sessionStorage.setItem(optOutKey, String(Date.now() + lifetime)); } catch { /* unavailable */ }
    try { document.cookie = `${optOutKey}=1; Max-Age=${lifetime / 1000}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; }
    catch { /* unavailable */ }
  }

  function clearFallbackDenied() {
    try { sessionStorage.removeItem(optOutKey); } catch { /* unavailable */ }
    try { document.cookie = `${optOutKey}=; Max-Age=0; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; }
    catch { /* unavailable */ }
  }

  function readChoice() {
    if (fallbackDenied()) return "deny";
    try {
      const choice = JSON.parse(localStorage.getItem(key));
      if (!choice || choice.version !== version ||
          !["allow", "deny"].includes(choice.status) ||
          !Number.isFinite(choice.at) || !Number.isFinite(choice.until) ||
          choice.at > Date.now() || choice.until <= Date.now() ||
          choice.until - choice.at > lifetime) return null;
      return choice.status;
    } catch { return null; }
  }

  function saveChoice(status) {
    try {
      const at = Date.now();
      localStorage.setItem(key, JSON.stringify({ status, version, at, until: at + lifetime }));
      return JSON.parse(localStorage.getItem(key))?.status === status;
    } catch { return false; }
  }

  function cleanCookies() {
    try {
      const names = document.cookie.split(";").map(item => item.trim().split("=")[0]);
      const domains = [null, location.hostname];
      const parts = location.hostname.split(".");
      if (parts.length > 2) domains.push(parts.slice(1).join("."));
      for (const name of names) {
        if (!/^_ym_(?:uid|d|isad|visorc(?:_\d+)?|metrika_enabled|retryReqs)$/.test(name)) continue;
        for (const domain of domains) {
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
        }
      }
    } catch { /* HttpOnly and third-party cookies cannot be cleared here. */ }
  }

  function safeUrl() {
    if (!safePath) return null;
    const url = new URL(safePath, location.origin);
    const input = new URLSearchParams(location.search);
    // Fail closed on unknown query parameters: Metrika and Webvisor may inspect location.href.
    for (const [name, value] of input) {
      if (name === "_ym_debug" && value === "2") {
        // Official debugger flag is safe; omit it from the recorded page URL.
        continue;
      } else if (name === "v" && value === "20261004") {
        // Known public preview version only; never accept arbitrary values here.
        // Keep the recorded URL canonical while preserving advertising attribution.
        continue;
      } else if (name === "yclid" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
        url.searchParams.append(name, value);
      } else if (/^utm_(source|medium|campaign|content|term)$/.test(name) &&
          value.length <= 100 && /^[\p{L}\p{N} _.,:+/-]+$/u.test(value) &&
          !/@|\+?\d[\d .()-]{7,}/.test(value)) {
        url.searchParams.append(name, value);
      } else return null;
    }
    return url.href;
  }

  function safeReferrer() {
    try {
      const ref = new URL(document.referrer);
      return /^https?:$/.test(ref.protocol) ? ref.origin + "/" : undefined;
    } catch { return undefined; }
  }

  function safeTitle() {
    const title = document.title.trim().slice(0, 120);
    return /@|\+?\d[\d .()-]{7,}/.test(title) ? "Страница сайта" : title;
  }

  function protectInputs(root = document) {
    if (root.nodeType === 1 && root.matches("input, textarea, select, [contenteditable]")) {
      root.classList.add("ym-disable-keys", "ym-hide-content");
    }
    root.querySelectorAll?.("input, textarea, select, [contenteditable]").forEach(element => {
      element.classList.add("ym-disable-keys", "ym-hide-content");
    });
    document.querySelectorAll("#promptResult, .site-search-results, [data-analytics-private]").forEach(element => {
      element.classList.add("ym-hide-content");
    });
  }

  function stop(broadcast = true, persistDeny = true) {
    if (revoked) return;
    active = false;
    revoked = true;
    window[disableKey] = true;
    if (persistDeny) setFallbackDenied();
    if (broadcast) channel?.postMessage("deny");
    clearTimeout(expiryTimer);
    clearTimeout(loadTimer);
    setStatus("Аналитика выключена.");
    if (script && !script.dataset.loaded) script.remove();
    inputObserver?.disconnect();
    // Yandex documents destruct for an already initialized counter.
    try { if (started && typeof window.ym === "function") window.ym(config.counterId, "destruct"); }
    catch { /* The disable flag remains set if the tag is unavailable. */ }
    if (window.ym?.a) window.ym.a = window.ym.a.filter(args => args[0] !== config.counterId);
    cleanCookies();
  }

  function start() {
    if (started || revoked || readChoice() !== "allow") return;
    const url = safeUrl();
    if (!url) {
      setStatus("На этом адресе аналитика не запускается: дополнительные параметры не разрешены. Для проверки откройте главную без параметров.");
      return; // Unknown/sensitive query values may be read by the library itself.
    }
    protectInputs();
    inputObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) protectInputs(node);
    });
    inputObserver.observe(document.documentElement, { childList: true, subtree: true });
    started = true;
    setStatus("Разрешение сохранено. Метрика загружается.");
    window[disableKey] = false;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://mc.yandex.ru/metrika/tag.js?id=${config.counterId}`;
    document.addEventListener(`yacounter${config.counterId}inited`, () => {
      if (revoked) return;
      initialized = true;
      clearTimeout(loadTimer);
      setStatus("Счётчик запущен. Получение данных проверяется в кабинете Метрики.");
    }, { once: true });
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      if (!revoked && !initialized) setStatus("Библиотека Метрики загружена. Запуск счётчика ещё не подтверждён.");
    });
    script.addEventListener("error", () => {
      clearTimeout(loadTimer);
      if (!revoked) setStatus("Метрика не загрузилась. Возможна блокировка браузером или сетью. Разрешение сохранено.");
    });
    loadTimer = setTimeout(() => {
      if (!revoked && !initialized) setStatus("Запуск Метрики не подтверждён. Разрешение сохранено.");
    }, 12000);
    document.head.appendChild(script);
    window.ym(config.counterId, "init", {
      ssr: true, triggerEvent: true, defer: true, webvisor: true, clickmap: true, trackLinks: true,
      accurateTrackBounce: true, disableYtm: true, ecommerce: false, sendTitle: false,
      url, referrer: safeReferrer()
    });
    window.ym(config.counterId, "hit", url, { referer: safeReferrer(), title: safeTitle() });
    active = true;
    scheduleExpiry();
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    try {
      const choice = JSON.parse(localStorage.getItem(key));
      const delay = Math.max(1, Math.min(choice.until - Date.now(), 2147483647));
      expiryTimer = setTimeout(() => {
        if (readChoice() !== "allow") { stop(false, false); showPanel(); }
        else scheduleExpiry();
      }, delay);
    } catch { stop(false, false); showPanel(); }
  }

  function showPanel() {
    if (panel) { panel.hidden = false; panel.querySelector("button").focus(); return; }
    const style = document.createElement("style");
    style.textContent = `.analytics-choice{position:fixed;z-index:9999;inset:auto 12px 12px;max-width:560px;margin:auto;padding:18px;border:1px solid #777;border-radius:12px;background:#fff;color:#222;box-shadow:0 8px 32px #0003;font:16px/1.45 system-ui,sans-serif}.analytics-choice p{margin:0 0 12px}.analytics-choice a{color:#174e9c;text-decoration:underline}.analytics-choice-actions{display:flex;flex-wrap:wrap;gap:9px}.analytics-choice button,.analytics-settings{font:inherit;cursor:pointer}.analytics-choice button{padding:9px 12px;border:1px solid #444;border-radius:7px;background:#fff;color:#222}.analytics-choice button:focus-visible,.analytics-choice a:focus-visible,.analytics-settings:focus-visible{outline:3px solid #174e9c;outline-offset:2px}@media(max-width:480px){.analytics-choice{font-size:14px;inset:auto 8px 8px}}`;
    if (document.querySelector(".contact-dock")) style.textContent += "@media(max-width:700px){.analytics-choice{bottom:76px}}";
    document.head.appendChild(style);
    panel = document.createElement("section");
    panel.className = "analytics-choice";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Выбор аналитики");
    panel.innerHTML = `<p>Разрешаете Яндекс Метрику для анализа посещений, рекламы, кликов, прокрутки и записи действий без ввода текста? До выбора она не загружается. <a href="${config.notice}">Условия и текст согласия</a>.</p><div class="analytics-choice-actions"><button type="button" data-choice="allow">Разрешить аналитику</button><button type="button" data-choice="deny">Без аналитики</button></div><p class="analytics-status" role="status"></p><p class="analytics-error" hidden role="status">Не удалось сохранить выбор. На этой странице аналитика выключена; перед следующим посещением проверьте выбор снова.</p>`;
    setStatus(statusText);
    panel.addEventListener("click", event => {
      const button = event.target.closest("button[data-choice]");
      if (!button) return;
      const choice = button.dataset.choice;
      if (choice === "deny") stop(); // Revoke first, even if localStorage.setItem throws.
      if (!saveChoice(choice)) {
        panel.querySelector(".analytics-error").hidden = false;
        return; // Never reload into a stale stored "allow".
      }
      panel.querySelector(".analytics-error").hidden = true;
      panel.hidden = true;
      if (choice === "allow") {
        clearFallbackDenied();
        if (started || revoked) location.reload();
        else start();
      } else if (started) location.reload();
    });
    document.body.appendChild(panel);
  }

  function channelOf(link) {
    const href = (link.getAttribute("href") || "").trim();
    if (/^tel:/i.test(href)) return "phone";
    if (/^mailto:/i.test(href)) return "email";
    try {
      const url = new URL(href, location.href);
      if ((url.hostname === "t.me" || url.hostname === "telegram.me") &&
          url.pathname.replace(/\/$/, "") === "/+79636981001") return "telegram";
      if (url.hostname === "max.ru") return "max";
    } catch { /* No contact link. */ }
    return null;
  }

  function isVideoLink(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      return (url.hostname === "t.me" || url.hostname === "telegram.me") &&
        url.pathname.replace(/\/$/, "").toLowerCase() === "/art_mmm_mmm";
    } catch { return false; }
  }

  document.addEventListener("click", event => {
    if (!active || readChoice() !== "allow") return;
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const channel = channelOf(link);
    if (channel && config.contactGoal) {
      window.ym(config.counterId, "reachGoal", config.contactGoal, { channel, page: safePath });
    } else if (isVideoLink(link) && config.videoGoal) {
      window.ym(config.counterId, "reachGoal", config.videoGoal, { type: "telegram_channel", page: safePath });
    } else if (!channel && config.contentGoal) {
      const target = new URL(link.href);
      const path = target.pathname;
      if (link.matches("[data-photo]") && /hudwagen\.ru$/.test(location.hostname)) {
        window.ym(config.counterId, "reachGoal", config.contentGoal, { type: "gallery", page: safePath });
      } else if (target.origin === location.origin && path !== safePath &&
          config.contentPaths.some(prefix => path.startsWith(prefix))) {
        window.ym(config.counterId, "reachGoal", config.contentGoal, { type: "page", path });
      }
    }
  });

  function ready() {
    const choice = readChoice();
    if (choice === "deny") setStatus("Аналитика выключена.");
    window[disableKey] = choice !== "allow";
    const footer = document.querySelector("footer, .footer-note, .privacy-footer") || document.body;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "analytics-settings";
    button.textContent = "Настройки аналитики";
    button.addEventListener("click", showPanel);
    footer.appendChild(button);
    if (choice === "allow") start();
    else if (choice === null) showPanel();
  }
  window.addEventListener("storage", event => {
    if (event.key !== key) return;
    if (readChoice() !== "allow") { stop(false, readChoice() === "deny"); if (readChoice() === null) showPanel(); }
    else if (!started) start();
  });
  if (channel) channel.onmessage = event => {
    if (event.data === "deny") stop(false);
  };
  document.addEventListener("visibilitychange", () => {
    if (active && readChoice() !== "allow") { stop(false, readChoice() === "deny"); showPanel(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
