---
name: task-report
description: Готовий до вставки в чат звіт англійською про щойно зроблений тікет у фіксованому форматі (привітання, жирні заголовки, блок Deploy info) і збереження у файл. Використовуй після завершення або передачі тікета, коли прошу звіт для Slack або Teams.
argument-hint: <ticket-id>
allowed-tools: Read, Write, Bash, Grep, Glob, AskUserQuestion
---

Тікет: $ARGUMENTS

# Task report

Короткий звіт англійською для команди про роботу, зроблену в цій розмові. Береться з контексту сесії, а не з повного розбору git; для ретроспективи є `dops:ticket-recap`.

Перед написанням переглянь [examples.md](examples.md): тон, стиль пунктів, які розділи лишати. Значення в `<...>` беруться з `.claude/dops/project.md`.

## Крок 0. Ключ тікета

1. Якщо `$ARGUMENTS` порожній, візьми ключ із поточної гілки, відкритого файлу або останніх комітів (`ticket_key_pattern`). Якщо неоднозначно, спитай.
2. Нормалізуй до голого ключа, без `#`.

## Крок 1. Факти з сесії

Не виводь усе заново з git. Збери:

- що змінено, простою мовою;
- чи є справжня **root cause** (лише для багфіксів; для нових функцій розділ пропускай);
- конфігурацію в back office;
- обсяг і вплив: які типи контенту, які сайти, відомі обмеження;
- гілку деплою: `<ticket_branch>` для цього ключа;
- команди деплою: за замовчуванням `<deploy_default>`; імпорт конфігу перед cache rebuild, якщо конфіг змінювався; кастомна drush-команда, якщо її написали для тікета. Якщо був `dops:deploy-prep`, бери його блок "Deploy info".

Якщо test URLs, адресати чи наявність root cause не зрозумілі з розмови, спитай через AskUserQuestion: хибний URL або вигадана root cause гірші за коротку паузу.

## Крок 2. Звіт

Структура й форматування фіксовані:

```markdown
<report_greeting>

I'm done with this assignment <tracker_url>/browse/<KEY>
<One or two sentences: what the user-facing result is now.>

**Root cause:**
<Only for bug fixes. Explain precisely WHY the bug existed.>

**The development/fix:**

- <one bullet per notable change, plain language>

**Test URLs:**
<URL(s) with a one-line note on what to check, or "Suggested pages to test: ...">

**Back-office configuration:**
<Concrete steps, or "No configuration needed.">

**Impact:**
<Which content types, blocks or pages, on which sites. Call out what is explicitly unchanged.>

**Deploy info:**

- "<ticket_branch>"
- <deploy command(s)>
```

### Правила форматування

- Привітання з `<report_greeting>`, якщо я не назвав інших адресатів (кілька тегів в одному рядку через пробіл).
- Заголовки завжди жирні з двокрапкою всередині: `**Header:**`. Не markdown-заголовки `#`.
- Набір заголовків фіксований: `Root cause:`, `The development/fix:`, `Test URLs:`, `Back-office configuration:`, `Impact:`, `Deploy info:`. Додатковий заголовок лише коли тікет справді цього потребує.
- Жодних назв коду, функцій, класів чи змінних: лише проста мова.
- Посилання на тікет — звичайний URL, не markdown-посилання.
- Коротко: це повідомлення в чат, а не есе.

## Крок 3. Збереження

1. Запиши звіт у `<report_dir>/<KEY>.md`. Якщо файл уже є з іншим вмістом, спершу спитай: це може бути чернетка.
2. Встав звіт і в відповідь, готовим до копіювання.
