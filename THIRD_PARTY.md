# Сторонние компоненты

Точные версии всех прямых/транзитивных зависимостей — package-lock.json. Прямые зависимости закреплены без диапазонов. При сборке `scripts/notices.mjs` формирует `dist/THIRD_PARTY_NOTICES.txt` с полными текстами уведомлений из установленных пакетов. Он входит в ASAR. Electron также поставляет собственные LICENSE и LICENSES.chromium.html.

| Компоненты | Лицензия | Поставка |
|---|---|---|
| Electron | MIT и уведомления Chromium | Встроенный runtime |
| React, React DOM, scheduler | MIT | UI bundle |
| Three.js | MIT | UI bundle |
| Monaco Editor | MIT | UI и локальный editor worker |
| marked | MIT | Зависимость Monaco |
| DOMPurify | Apache-2.0 OR MPL-2.0 | Зависимость Monaco; текст dual license включён |
| better-sqlite3 | MIT; SQLite public domain | Нативный модуль |
| node-addon-api | MIT | Зависимость SQLite |
| Zod | MIT | Проверка данных |
| semver | ISC | Сравнение версий обновлений |
| Noto Sans | SIL OFL 1.1, ©2022 Noto Project Authors | Локальный шрифт, third-party/NotoSans-LICENSE.txt |
| TypeScript | Apache-2.0 | Только разработка |
| Vite, plugin-react, Vitest, tsx, esbuild | MIT | Только разработка |
| Playwright | Apache-2.0 | Только разработка |
| electron-builder, electron-rebuild | MIT | Только разработка |

Код FireCNC распространяется по LICENSE (MIT). Оригинальные схемы, модели и учебные тексты находятся в этом репозитории. Приватные ключи и реальные выданные лицензии в исходную и клиентскую поставку не входят.
