# Повторяемая проверка согласия

Из корня репозитория установите пакет `playwright` локально (`npm install --no-save playwright`) и используйте установленный Chrome. При отсутствии Chrome тест пробует браузер Chromium из Playwright. Пакет и браузер не входят в PR.

```text
node tests/consent-metrika.cjs js/consent-metrika.js               # Dinar.agency
node tests/consent-metrika.cjs assets/consent-metrika.js           # DINAR handmade
node tests/consent-metrika.cjs public/assets/consent-metrika.js    # Dinar Moscow
node tests/consent-metrika.cjs site-final/consent-metrika.js       # Hudwagen
```

Выполните только строку для текущего репозитория. Если Playwright уже установлен отдельно, передайте путь к его каталогу через `PLAYWRIGHT_MODULE`. Тест запускает только локальный макет страницы и подменяет ответ `mc.yandex.ru`; он не отправляет события в настоящий счётчик и не доказывает доставку.
