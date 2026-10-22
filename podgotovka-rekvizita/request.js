"use strict";
(() => {
  const button = document.getElementById("copy-transport-request");
  const template = document.getElementById("transport-request");
  const status = document.getElementById("transport-copy-status");
  if (!button || !template || !status) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(template.textContent.trim());
      status.textContent = "Заявка скопирована. Вставьте её в мессенджер и заполните.";
    } catch {
      template.focus();
      const range = document.createRange();
      range.selectNodeContents(template);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "Текст выделен. Скопируйте его через меню устройства или Ctrl+C.";
    } finally {
      button.disabled = false;
    }
  });
})();
