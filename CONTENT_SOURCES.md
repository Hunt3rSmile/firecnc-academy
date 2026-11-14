# Источники и границы учебного содержания

Проверены 14 ноября 2026. Уроки, вопросы, схемы и программы созданы для FireCNC; они не являются вопросами реального экзамена колледжа. Материалы KELLER не копируются. Соответствие собственному профилю проверяется тестами; промышленная сертификация не заявлена.

| ID | Первичный источник | Использование |
|---|---|---|
| linuxcnc-gcode | [LinuxCNC G-Codes](https://www.linuxcnc.org/docs/html/gcode/g-code.html) | Геометрия G0/G1/G2/G3, плоскости, конец дуги и смещения центра, координаты G54, G90/G91. |
| linuxcnc-overview | [LinuxCNC G-code Overview](https://www.linuxcnc.org/docs/html/gcode/overview.html) | Кадры, слова, комментарии, модальные группы. Собственный профиль принимает лишь документированное подмножество. |
| linuxcnc-lathe | [LinuxCNC Lathe User Information](https://www.linuxcnc.org/docs/html/lathe/lathe-user.html) | Различие радиуса/диаметра, ось и привязка инструмента. Собственный TNNCC не приписывается LinuxCNC. |
| firecnc-profile | [CNC_PROFILE.md](CNC_PROFILE.md) | Нормативное для этого приложения описание фиксированного мм/мин, диаметральной X, TNNCC, нулевых поправок и ограничений. |

DIN/ISO в названии — обозначение учебного направления. Официального соответствия всем положениям конкретного платного стандарта или конкретной стойки не заявляется. LinuxCNC здесь — источник для своего диалекта RS274/NGC, а не доказательство семантики FANUC, PAL или SINUMERIK. Для новых профилей требуются их первичные руководства и отдельные тесты.

Архитектура сверена по [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security), [Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [Electron timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines), [Node crypto](https://nodejs.org/api/crypto.html), [Three.js fundamentals](https://threejs.org/manual/pages/fundamentals.html), [Monaco](https://microsoft.github.io/monaco-editor/docs.html), [Vite guide](https://vite.dev/guide/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [electron-builder](https://www.electron.build/configuration/), [Playwright Electron](https://playwright.dev/docs/api/class-electron).

Версии получены из официального npm registry и закреплены в package.json/lock. Electron 45.3.2: встроенный Node 24.22.2, ABI 150 подтверждены запуском; host Node 26.12.0. Vite 8.3.8, React 19.3.1, TypeScript 7.0.2, Three.js 0.187.0, Monaco 0.57.0, better-sqlite3 13.2.0, Vitest 5.1.0, Playwright 1.65.1. Совместимость подтверждена Linux build/E2E, Windows пока требует CI-проверки.

[KELLER SYMplus for CNC training](https://cnc-keller.com/symplus-cnc-software/symplus-for-cnc-training/) использован только для понимания структуры учебных направлений. Промышленная достоверность и превосходство над KELLER не сравнивались.

Noto Sans Regular 2.015 поставляется локально по [OFL 1.1](https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt); файл лицензии включён. Никаких внешних шрифтов, трекеров, скриптов и CDN при обучении нет.

Тренировка координат 0.3: собственные чертежи ступенчатого профиля и XY-контура. По пользовательским фотографиям уточнён формат «ввести координаты каждой точки, режим G90/G91 меняется». Снимки KELLER, его тексты и интерфейс в продукт и репозиторий не включены. Семантика сверена с указанными первичными разделами LinuxCNC G90/G91/G7/G8 и зафиксирована отдельно как профиль FireCNC.

Измерения: [Mitutoyo, Quick Guide to Precision Measuring Instruments — micrometers](https://www2.mitutoyo.co.jp/eng/useful/E11003/pageindices/index10.html) и [официальный каталог 2026 — vernier scale](https://www2.mitutoyo.co.jp/eng/useful/catalog-2026/seo/0532.html), проверено 14.11.2026. Из них сверены принципы сложения отсчётов и отношение делений; рисунки и формулировки в приложении собственные. Учебный штангенциркуль имеет нониус 20/19 мм, ход 0–150 мм и шкалу до 170 мм для чтения на краю хода. Микрометр имеет ход 0–25 мм, винт 0,5 мм и 50 делений барабана; отсчёт 0,01 мм. Погрешность промышленного прибора и измерительное усилие не моделируются.

Формулы режимов сверены с первичными материалами Sandvik Coromant: [sandvik-turning](https://www.sandvik.coromant.com/en-gb/knowledge/machining-formulas-definitions/general-turning-formulas-definitions), [sandvik-milling](https://www.sandvik.coromant.com/en-gb/knowledge/machining-formulas-definitions/milling-formulas-definitions). Vc = πDn/1000 (м/мин при D в мм), n = 1000Vc/(πD), vf = fz·n·Zeff. Это расчётные учебные примеры; G95/G96 в интерпретатор не добавлены. Вопросы созданы заново и ссылаются на темы/профиль.

Сервер: [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) и [официальная таблица совместимости rate-limit](https://github.com/fastify/fastify-rate-limit#compatibility) проверены перед фиксацией Fastify 5.12.8 и @fastify/rate-limit 11.2.2 (ветка ≥10 для Fastify 5). В CI используется Node 24 LTS; серверные HTTP-тесты выполняются и на host Node, и в Windows/Linux CI.
