'use strict';
(() => {
  const key = 'marat_data_notice_ok_v1';
  try { if (localStorage.getItem(key) === '1') return; } catch (_) { /* Storage may be disabled. */ }

  const notice = document.createElement('section');
  notice.className = 'data-notice';
  notice.setAttribute('role', 'region');
  notice.setAttribute('aria-labelledby', 'data-notice-title');

  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.id = 'data-notice-title';
  title.textContent = 'О данных на сайте';
  const message = document.createElement('p');
  message.append('Сайт запоминает в браузере только нажатие OK. Текст формы не отправляется. GitHub Pages фиксирует IP для безопасности. ');
  const details = document.createElement('a');
  details.href = new URL('../site-final/privacy.html', document.currentScript.src).href;
  details.textContent = 'Подробнее';
  message.append(details, '.');
  copy.append(title, message);

  const okay = document.createElement('button');
  okay.type = 'button';
  okay.textContent = 'OK';
  okay.setAttribute('aria-label', 'Понятно, закрыть уведомление о данных');
  okay.addEventListener('click', () => {
    try { localStorage.setItem(key, '1'); } catch (_) { /* Keep dismissal for this page. */ }
    notice.remove();
    document.body.classList.remove('has-data-notice');
  });
  notice.append(copy, okay);
  document.body.classList.add('has-data-notice');
  document.body.append(notice);
})();
