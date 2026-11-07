---
name: pipelines
description: Створити або змінити файли pipelines і середовищ dops (pipelines/<name>.yml, environments/<env>.yml) за правилами проєкту й перевірити їх dry-run. Використовуй, коли прошу додати pipeline, команду деплою, нове середовище (staging, preprod, prod) або змінити кроки.
argument-hint: <що зробити, наприклад "pipeline для cim на preprod">
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion
---

Запит: $ARGUMENTS

# Pipelines і середовища

Файли лежать поруч із `dops.config.yml` toolkit (`<toolkit_dir>` з профілю `.claude/dops/project.md`):

```text
<toolkit_dir>/dops.config.yml   sites, params, visual, uiTests
<toolkit_dir>/environments/     одне середовище на файл
<toolkit_dir>/pipelines/        один pipeline на файл
```

Обидві папки ігноруються git toolkit. Після роботи перевір `git -C <toolkit_dir> status --short`: файлів проєкту там бути не повинно.

## Правила

- **Ніколи не запускай pipeline сам.** Лише `--dry-run`. Справжній запуск роблю я: у dashboard або CLI. Прапорець `--yes` (підтвердження production) ти не передаєш ніколи.
- **Секрети** не пишуться у файли. Хости й користувачі, що відрізняються між машинами, задаються як `${VAR}` зі значенням в env-файлі; паролів немає взагалі (SSH через ключ або агент).
- **Середовище** = файл `environments/<env>.yml` з `targets` (і за потреби `bastions`). Назва файлу стає `environment` кожної цілі. Для production обов'язково `production: true` на початку файлу.
- **Pipeline** = файл `pipelines/<name>.yml`, де назва файлу в kebab-case і є назвою pipeline. Поля: `description`, `environment` (або `targets`, якщо потрібні конкретні сервери), `steps`.
- **Кроки:** `name` англійською, коротко (`Rebuild caches`); `run` — одна shell-команда, яка працює з `path` цілі. Для довгих кроків задай `timeoutSeconds`, для некритичних — `continueOnError: true`.
- **Підстановки:**
  - `{alias}`, `{uri}` та інші значення сайту з `sites:`;
  - `{target}`, `{path}` — значення цілі;
  - `{param}` — параметри з `params:` у `dops.config.yml`. Новий параметр додай туди з `description` і, якщо доречно, `default`.
- **Порядок кроків деплою Drupal:** код → `composer install` → кастомні команди, що готують дані → `updb` → імпорт конфігу → `cr`. Maintenance mode вмикай до `updb` і вимикай після `cr`, лише якщо це прийнято в проєкті.
- Кастомну drush-команду в кроці спершу перевір через `dops:drush-command-audit`.
- Наявний файл не перезаписуй мовчки: покажи різницю.

## Кроки

1. Прочитай `dops.config.yml`, `environments/` і `pipelines/`, щоб не дублювати назви цілей чи pipelines.
2. Якщо бракує даних (хости, шлях на сервері, bastion, які сайти), спитай через AskUserQuestion. Не вигадуй хости.
3. Створи або зміни файли за правилами вище.
4. Перевір:
   - `<dops_cli> pipelines` — pipeline видно, цілі правильні;
   - `<dops_cli> deploy <name> --dry-run` (з `--site <site>`, якщо кроки містять значення сайту) — команди розгорнулись правильно.

   Помилку «Missing environment variables» не обходь: назви змінну, яку треба додати в env-файл.

5. Покажи результат: файли, ціль кожного pipeline, вивід dry-run коротко. Для production окремо нагадай, що запуск іде на production.
