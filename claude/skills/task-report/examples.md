# Report examples

Invented examples that show the expected tone and shape.

## SHOP-101: feature, no root cause

```markdown
Hello @reviewer. :wave:

I'm done with this assignment https://example.atlassian.net/browse/SHOP-101
The newsletter block now confirms the signup on the page instead of reloading it.

**The development/fix:**

- After a valid email is sent, the form is replaced by a short confirmation message.
- An invalid email shows the error under the field, and what the visitor typed is kept.
- The block looks the same as before until the visitor submits it.

**Test URLs:**
https://staging.example.com/blog
Fill in the newsletter block in the footer with a valid email, then with "test@".

**Back-office configuration:**
No configuration needed.

**Impact:**

- The newsletter block on every page that shows it, on all sites.
- Unchanged: the email provider, the list the subscribers go to, the consent text.

**Deploy info:**

- "release/SHOP-101"
- drush cr
```

Notes: no Root cause section, because this is a feature. Bullets in the fix and impact sections, because there are several independent points.

## SHOP-102: bug fix with a one-off drush command

```markdown
Hello @reviewer @lead. :wave:

I'm done with this assignment https://example.atlassian.net/browse/SHOP-102
Event dates in the teaser lists now show the local time again.

**Root cause:**
The teaser view formatted the date without a time zone, so it fell back to UTC. Events starting after 22:00 local time showed up on the next day.

**The development/fix:**
The teaser date now uses the site's time zone, like the full event page. A drush command re-saves the cached teaser lists so the fix is visible without waiting for the cache to expire. It is safe to run again: it skips lists that are already up to date.

**Test URLs:**
https://staging.example.com/events
An event starting at 23:00 shows the correct day in the list and on its page.

**Back-office configuration:**
No manual action: the command does it.

**Impact:**
Event teasers on every site after the command has run. Event pages and the calendar export were already correct and are unchanged.

**Deploy info:**

- "release/SHOP-102"
- drush --uri=<site> shop-102:refresh-teasers (on each site)
- drush cr
```

Notes: several recipients on one line. The root cause names the exact mechanism. Deploy info lists the command itself, because it is a manual per-site step.

## Deploy info shape

Always two parts:

1. The ticket branch from the project profile.
2. The deploy actions in order: a config import first when config changed, a custom command when one was written for the ticket, and the cache rebuild last.
