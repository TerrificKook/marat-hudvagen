"use strict";

// Set enabled only after the counter, operator and public notice have been verified.
(() => {
  const config = { enabled: false, counterId: null, hosts: ["www.hudwagen.ru", "hudwagen.ru"], notice: "/site-final/privacy.html" };
  if (!config.enabled || !Number.isSafeInteger(config.counterId) ||
      !config.hosts.includes(location.hostname)) return;

  const key = "site_analytics_choice_v1";
  const version = 1;
  const lifetime = 180 * 24 * 60 * 60 * 1000; // Project choice: ask again after 180 days.
  const disableKey = `disableYaCounter${config.counterId}`;
  const safePath = /^\/[a-z0-9/_.-]*$/i.test(location.pathname) &&
    !/\d{7,}/.test(location.pathname) ? location.pathname : "/";
  let active = false;
  let started = false;
  let panel;

  function readChoice() {
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
      return localStorage.getItem(key) !== null;
    } catch { return false; }
  }

  function clearAccessibleMetrikaCookies() {
    for (const name of ["_ym_uid", "_ym_d", "_ym_isad", "_ym_visorc", "_ym_metrika_enabled"]) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${location.hostname}; SameSite=Lax`;
    }
  }

  function safeUrl() {
    const url = new URL(safePath, location.origin);
    const input = new URLSearchParams(location.search);
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const value = input.get(name);
      if (value && /^[a-zA-Z0-9_ .-]{1,64}$/.test(value) &&
          !/\d[\d .-]{7,}/.test(value)) url.searchParams.set(name, value);
    }
    return url.href;
  }

  function safeReferrer() {
    try {
      const ref = new URL(document.referrer);
      return /^https?:$/.test(ref.protocol) ? ref.origin + "/" : "/";
    } catch { return "/"; }
  }

  function start() {
    if (started || readChoice() !== "allow") return;
    started = true;
    window[disableKey] = false;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    const script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://mc.yandex.ru/metrika/tag.js?id=${config.counterId}`;
    document.head.appendChild(script);
    window.ym(config.counterId, "init", {
      defer: true, webvisor: false, clickmap: false, trackLinks: false,
      accurateTrackBounce: false, disableYtm: true, ecommerce: false, sendTitle: false
    });
    window.ym(config.counterId, "hit", safeUrl(), { referer: safeReferrer(), title: "" });
    active = true;
  }

  function showPanel() {
    if (panel) { panel.hidden = false; panel.querySelector("button").focus(); return; }
    const style = document.createElement("style");
    style.textContent = `.analytics-choice{position:fixed;z-index:9999;inset:auto 12px 12px;max-width:560px;margin:auto;padding:18px;border:1px solid #777;border-radius:12px;background:#fff;color:#222;box-shadow:0 8px 32px #0003;font:16px/1.45 system-ui,sans-serif}.analytics-choice p{margin:0 0 12px}.analytics-choice a{color:#174e9c;text-decoration:underline}.analytics-choice-actions{display:flex;flex-wrap:wrap;gap:9px}.analytics-choice button,.analytics-settings{font:inherit;cursor:pointer}.analytics-choice button{padding:9px 12px;border:1px solid #444;border-radius:7px;background:#fff;color:#222}.analytics-choice button:focus-visible,.analytics-choice a:focus-visible,.analytics-settings:focus-visible{outline:3px solid #174e9c;outline-offset:2px}@media(max-width:480px){.analytics-choice{font-size:14px;inset:auto 8px 8px}}`;
    document.head.appendChild(style);
    panel = document.createElement("section");
    panel.className = "analytics-choice";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Выбор аналитики");
    panel.innerHTML = `<p>Разрешаете Яндекс Метрику для статистики посещений и источников? До вашего выбора она не загружается. <a href="${config.notice}">Условия и текст согласия</a>.</p><div class="analytics-choice-actions"><button type="button" data-choice="allow">Разрешить аналитику</button><button type="button" data-choice="deny">Без аналитики</button></div><p class="analytics-error" hidden role="status">Не удалось сохранить выбор. Аналитика остаётся выключенной.</p>`;
    panel.addEventListener("click", event => {
      const button = event.target.closest("button[data-choice]");
      if (!button) return;
      const choice = button.dataset.choice;
      if (!saveChoice(choice)) {
        panel.querySelector(".analytics-error").hidden = false;
        return;
      }
      panel.hidden = true;
      if (choice === "allow") start();
      else if (started) {
        window[disableKey] = true;
        active = false;
        clearAccessibleMetrikaCookies();
        location.reload();
      }
    });
    document.body.appendChild(panel);
  }

  function channelOf(link) {
    const href = (link.getAttribute("href") || "").trim();
    if (/^tel:/i.test(href)) return "phone";
    if (/^mailto:/i.test(href)) return "email";
    try {
      const url = new URL(href, location.href);
      if (url.hostname === "t.me" || url.hostname === "telegram.me") return "telegram";
      if (url.hostname === "max.ru") return "max";
    } catch { /* No contact link. */ }
    return null;
  }

  document.addEventListener("click", event => {
    if (!active || readChoice() !== "allow") return;
    const link = event.target.closest("a[href]");
    if (!link) return;
    const channel = channelOf(link);
    if (!channel) return;
    const data = { channel, page: safePath };
    window.ym(config.counterId, "reachGoal", "contact_click", data);
    window.ym(config.counterId, "reachGoal", `${channel}_click`, data);
  });

  function ready() {
    const choice = readChoice();
    window[disableKey] = choice !== "allow";
    const footer = document.querySelector("footer, .footer-note, .privacy-footer");
    if (footer) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "analytics-settings";
      button.textContent = "Настройки аналитики";
      button.addEventListener("click", showPanel);
      footer.appendChild(button);
    }
    if (choice === "allow") start();
    else if (choice === null) showPanel();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
