# Выпуск и обслуживание офлайн-лицензий

CLI владельца находится в `tools/license-issuer`, запускается из исходного репозитория с Node.js. Он не входит в обычный клиентский пакет. Храните закрытые ключи отдельно от распространяемого приложения и делайте защищённые резервные копии.

```sh
npm run license:keygen -- --out ./private-keys
```

Создаёт `issuer-private.pem` (PKCS#8, режим 0600 там, где поддерживается), `issuer-public.pem` и `trusted-keys.json`. Существующие файлы не перезаписываются. Для зашифрованного PKCS#8:

```sh
npm run license:keygen -- --out ./private-keys-protected --encrypt
```

Пароль запрашивается дважды без эха, не короче 12 символов; в аргументах и переменных среды не принимается. Нужен интерактивный TTY. При выпуске зашифрованным ключом пароль также вводится без эха. Не печатайте закрытый PEM в терминал.

```sh
npm run license:issue -- --private-key ./private-keys/issuer-private.pem --edition teacher --modules theory,turning,milling,measurements,exams,teacher --days 365 --customer "Учебная группа" --output ./issued/teacher.fcnclic
npm run license:verify -- --license ./issued/teacher.fcnclic --public-key ./private-keys/issuer-public.pem
npm run license:list -- --ledger ./issued/ledger.jsonl
```

Рабочие редакции CLI: student и teacher. Lab выдаётся отдельным сервером с учётом установок; офлайн CLI и проверяющая схема отклоняют offline Lab. Без `--modules` берётся стандартный набор редакции. Чтобы открыть также CAD/CAM, добавьте `cadcam`: `--modules theory,turning,milling,measurements,exams,teacher,cadcam`. Новую лицензию выпускайте в новый файл; существующий ключ подписи повторно не создавайте. Без `--days` — бессрочная offline-лицензия; иначе 1–36500 целых суток. Журнал рядом с выданным файлом хранит ID, владельца, даты и модули, **не** закрытый ключ или токен. Другой журнал задаётся `--ledger`. CLI не перезаписывает уже выданный файл.

Для привязанного выпуска: пользователь экспортирует запрос в настройках и передаёт JSON. Владелец добавляет:

```sh
npm run license:issue -- --private-key ./private-keys/issuer-private.pem --edition student --days 180 --customer "Студент" --request ./request.json --output ./issued/bound.fcnclic
```

Безопасная проверка привязанного файла требует известного хеша из запроса:

```sh
npm run license:verify -- --license ./issued/bound.fcnclic --public-key ./private-keys/issuer-public.pem --installation-hash HASH_ИЗ_ЗАПРОСА
```

Сборка клиента:

```sh
npm run build -- --trust ./private-keys/trusted-keys.json
npm start
```

Для упаковки установите `FCNC_TRUST_FILE` в среде сборки, затем `npm run pack:win` или `npm run pack:linux`. Только публичные ключи допускаются в trust store; проверяются алгоритм и keyId. Переменная применяется во время компиляции, не служит runtime-разблокировкой. По умолчанию используется публичный config/trusted-keys.json; другой trust store задаётся явно. В репозитории и CI нет приватного ключа. Не выдавайте файл произвольным уже собранным клиентам: их встроенный список ключей должен содержать ваш публичный ключ.

Пользователь импортирует `.fcnclic` либо вставляет FCNC1. При неверной подписи, сроке или привязке импорт отказывает и сохраняет прежнюю лицензию. Установленная лицензия хранится в пользовательской БД и проверяется при каждом лицензируемом IPC. Токен подписи не является секретом; пароли, закрытые ключи и renewal-секреты — секреты.

Ротация:

```sh
npm run license:rotate -- --out ./private-keys-next --encrypt
```

Объедините **публичные** записи старого и нового trusted-keys.json (не более восьми), соберите обновление, затем выпускайте новые файлы новым ключом. Не удаляйте единственную резервную копию старого ключа до принятия политики перевыпуска. Отзыв бессрочного офлайн-файла не происходит мгновенно у отключённого клиента.

Локальная воспроизводимая проверка: `npm run license:dev`, затем `npm run dev`, импорт `.local/development.fcnclic`. Этот ключ не принимается обычным release-build. `.gitignore` и allowlist упаковки исключают `.local`, private-keys, issued, PEM, .env, БД и резервные копии. Утилита не создаёт универсальный секрет продукта.

Короткие FCNC-ключи, отдельный Fastify/SQLite сервер, счётчик мест Lab, renew/deactivate и административный API реализованы. Порядок локального запуска, выпуска, отзыва и резервирования — [SERVER_ADMIN_RU.md](SERVER_ADMIN_RU.md). Клиент продолжает работать с непросроченным lease при недоступном сервере; отзыв не отменяет уже выданный автономный срок. Для потерянной установки офлайн-владелец выдаёт новый подписанный файл на новый запрос; старый бессрочный файл на изолированной машине продолжает действовать.
