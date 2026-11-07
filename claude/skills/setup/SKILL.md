---
name: setup
description: Підключити dops до Drupal-проєкту - профіль проєкту, CLAUDE.local.md з правилами, git exclude, файл секретів і URL set для візуальних перевірок. Лише за явною командою /dops:setup.
argument-hint: '[шлях до toolkit, за замовчуванням drupal-ops-toolkit]'
disable-model-invocation: true
---

Аргументи: $ARGUMENTS

# Setup

Мета: щоб усі skills `dops:*` працювали в цьому проєкті, нічого з проєкту не потрапило в git, а нічого клієнтського не потрапило в toolkit.

## Правила

- Нічого не комітити. Усе, що створює цей skill, або виключене з git проєкту, або ігнорується toolkit.
- У файли toolkit, які відстежує git, не записуй нічого про проєкт. Дозволені лише ignored-файли toolkit: `dops.config.yml`, `.env`, `.dops/`.
- Не перезаписуй наявні файли без моєї згоди: спершу покажи, що там є.
- Секрети не заповнюй і не питай у чаті: лише створи порожній файл і скажи, які ключі заповнити.
- Мережа (`npm install`, `playwright install`) лише з моєї згоди.

## Кроки

1. **Toolkit.** Шлях з аргументу або `drupal-ops-toolkit/` у корені проєкту. Перевір, що там є `claude/.claude-plugin/plugin.json`.
2. **Git exclude.** Додай у `.git/info/exclude` проєкту рядки, яких там ще немає: `drupal-ops-toolkit/`, `.claude/`, `CLAUDE.local.md`. Перевір через `git status --short`, що вони зникли зі списку.
3. **Профіль.** Створи `.claude/dops/project.md` з `${CLAUDE_PLUGIN_ROOT}/templates/project.md`. Заповни те, що видно з репозиторію:
   - `prod_base`: `git symbolic-ref refs/remotes/origin/HEAD`;
   - `dev_branch`: найактивніша гілка розробки за `git log --all`;
   - `local_ddev_name`, `ddev_config_file`: `.ddev/config.yaml`;
   - `local_sites`: аліаси з `drush/sites/*.site.yml` або `web/sites/sites.php`, лише ті, що я назву для перевірок;
   - `theme_dir`, `compiled_assets`, `theme_build`: кастомна тема та її `package.json`;
   - `custom_commands_dir`, `task_commands`: де лежать кастомні drush-команди;
   - `db_core_major`: major `drupal/core` у `composer.lock` dev-гілки.

   Решту (`tracker_url`, `ticket_key_pattern`, `report_greeting`, `report_dir`, середовища) спитай через AskUserQuestion. Покажи таблицю: ключ, значення, звідки взято, впевненість.

4. **Правила.** Створи `CLAUDE.local.md` у корені проєкту з `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.local.md`. Якщо файл уже є, лише додай два рядки `@...`, яких бракує.
5. **Секрети.** Один файл на проєкт для всього: CLI, dashboard, `dops-ai` і skills. Якщо `env_file` не існує, створи його з `${CLAUDE_PLUGIN_ROOT}/templates/project.env.example` з правами `600`. Скажи, які ключі заповнити.
6. **Конфіг toolkit.** Якщо `<toolkit>/dops.config.yml` немає, створи його з `<toolkit>/examples/dops.config.example.yml`. Залиш лише те, що стосується проєкту, першим рядком вкажи `envFile: <env_file>` і додай URL set для `visual_set`:
   ```yaml
   envFile: ~/.config/dops/<project>.env
   visual:
     cacheBust: true
     hide: ['.messages']
     urlSets:
       local:
         baseUrl: https://<local-site>.ddev.site
         paths: [/]
   ```
   Для кількох локальних сайтів зроби окремий URL set на кожен або спитай, який основний.
7. **Залежності** (лише з моєї згоди): `npm install` і `npx playwright install chromium` у toolkit. Потрібен Node із `<toolkit>/.nvmrc`.
8. **Дозволи** (за бажанням): запропонуй `${CLAUDE_PLUGIN_ROOT}/templates/settings.local.json` для `.claude/settings.local.json`. Якщо файл уже є, покажи різницю, а не замінюй.
9. **Перевірка.**
   - `git status --short` у проєкті: нових файлів немає.
   - `git -C <toolkit> status --short`: відстежувані файли toolkit не змінились.
   - `<dops_cli> visual capture <visual_set> -l setup-check --force` проходить без зламаних сторінок.

## Результат

Зроблено / Не зроблено / Що заповнити мені (ключі секретів, порожні поля профілю).
