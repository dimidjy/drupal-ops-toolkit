---
name: ticket-recap
description: Підсумок того, що змінив тікет, з історії git - знайти коміти, розібрати diff і зібрати структурований звіт англійською (root cause, fix, test URLs, back-office config, prevention). Використовуй, коли прошу підсумок або recap уже зробленого тікета. Для питання "чому так" є dops:task-history.
argument-hint: <ticket-id> [ще ключі через , або /]
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

Тікет: $ARGUMENTS

# Ticket recap

Перед аналізом прочитай [drupal-context.md](drupal-context.md) (категорії файлів Drupal) і профіль проєкту `.claude/dops/project.md` (гілки, формат ключа).

## Крок 0. Вхід

- Якщо ключа немає, спитай. Формат: `ticket_key_pattern` профілю, без урахування регістру.
- Кілька ключів через `/` або `,`: розбери кожен окремо, потім об'єднай.
- Прибери `#` на початку й пробіли.

## Крок 1. Коміти

```bash
git log --all --no-merges -i --grep="<KEY>" --format="HASH:%H|DATE:%ai|AUTHOR:%an|SUBJECT:%s"
git branch -a --list "*<KEY>*"
```

- Прибери дублікати cherry-pick між гілками: однаковий subject і дата з точністю до хвилини. Лишай коміт із найважливішої гілки: `prod_base`, потім `dev_branch`, потім решта.
- Не бери stash-коміти (`index on`, `WIP on`, `untracked files on`).

## Крок 2. Особливі випадки

- **Комітів немає:** скажи про це й запропонуй частковий пошук або інший ключ.
- **Понад 20 комітів:** покажи коротку хронологію й спитай: повний аналіз чи останні N.
- **Squashed commit:** прочитай повне повідомлення `git log <hash> -1 --format=%B`.
- **Кілька тікетів в одному коміті:** згадай перехресні ключі, але тримайся запитаного.
- **Revert:** покажи в хронології, яку спробу відкотили і чим замінили.

## Крок 3. Файли

`git diff-tree --no-commit-id --name-only -r <hash>` для кожного коміту. Прибери дублікати й розклади за категоріями з [drupal-context.md](drupal-context.md).

## Крок 4. Diff

- **Малий тікет** (до 10 комітів і до 20 файлів): `git show <hash> --stat -U3` для кожного, у хронологічному порядку.
- **Великий:** спершу `--stat` для всіх, потім повний diff 5-8 найважливіших файлів.
- Завжди детально: `*.services.yml`, `*.module`, `settings.php`, `src/Service/`, нові файли.
- Вплив: шукай використання змінених сервісів і функцій через Grep.

## Крок 5. Історія змін

Склади в голові: проблему (технічна root cause), рішення, вплив, як запобігти повтору.

## Крок 6. Підтвердження (обов'язково)

Покажи: кількість комітів і період, авторів, 2-3 речення розуміння, категорії файлів. Спитай через AskUserQuestion:

1. Чи правильний аналіз, чи є контекст щодо root cause?
2. Які test URLs?
3. Чи потрібна конфігурація в back office?

## Крок 7. Звіт англійською

```markdown
# Ticket Analysis: <KEY>

**Period**: <first date> -> <last date>
**Authors**: <names>
**Commits**: <N> unique commits across <branches>
**Files modified**: <N>

## Root cause

<2-5 sentences: the exact mechanism, not "there was a bug">

## The development/fix

<What was done, in order when there were several iterations, including approaches that were rolled back>

### Key changes

- **<Category>**: <what changed and why>

## Test URLs

- <URL or page>

## Back-office configuration

<Actions in the Drupal back office, or "No back-office configuration required.">

## Prevention

<Concrete measures: code patterns, tests that would have caught it, process>

## Related tickets

- <KEY>: <relationship>
```

## Правила

- Лише читання: нічого не змінюй.
- Якщо зміну можна трактувати по-різному, спитай, а не вгадуй.
- Якщо test URLs не дали, напиши "Suggested pages to test: ..." з описом.
- Звіт має бути готовим для вставки в тікет або чат.
