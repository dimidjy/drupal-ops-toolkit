# dops: Claude Code plugin

Skills I use with Claude Code on Drupal projects. They sit on top of the
toolkit (`dops visual` for screenshots) and read everything project-specific
from a profile file in the project, so the plugin itself stays generic.

| Skill                                       | What it does                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/dops:setup`                               | Connects a project: profile, `CLAUDE.local.md`, git exclude, secrets file, visual URL set               |
| `dops:task-history`                         | Why something behaves as it does: ticket chain, commits, verdict (bug or changed requirement)           |
| `dops:jira-fetch`                           | Read-only Jira tickets and epics as markdown, with every comment                                        |
| `dops:ticket-recap`                         | What a finished ticket changed, from git history, as an English report                                  |
| `dops:drush-command-audit`                  | Risk review of a custom drush command before it runs outside local                                      |
| `dops:deploy-prep`                          | Builds the ticket branch from the production base as one commit, resolves conflicts, lists deploy steps |
| `dops:task-report`                          | Chat-ready English report with a fixed shape and a Deploy info block                                    |
| `dops:pipelines`                            | Writes pipeline and environment files by the project's rules and checks them with a dry run             |
| `dops:test-content`                         | Test pages and redirects on non-production environments through the back office                         |
| `dops:qa-start`, `dops:qa-check`            | Visual baseline before a change, after capture, diff and triage                                         |
| `/dops:ticket-start`, `/dops:ticket-finish` | Run the skills above as one flow at the start and the end of a ticket                                   |
| `dops:drupal-gotchas`                       | Known fixes for caches, Varnish, patches, config imports and Playwright                                 |

Skill instructions are written in Ukrainian, the language I work in. Everything
they produce (code, commits, reports) is in English.

## Install in a project

The toolkit is cloned once per project, next to the code, and kept out of the
project's git:

```bash
cd ~/projects/<project>
git clone https://github.com/dimidjy/drupal-ops-toolkit.git
claude plugin marketplace add ./drupal-ops-toolkit
claude plugin install dops@drupal-ops-toolkit --scope local
```

Then, in Claude Code, run `/dops:setup`. It creates, all outside git:

- `.claude/dops/project.md`: the project profile (tracker, branches, deploy commands, local sites)
- `CLAUDE.local.md`: imports [rules.md](rules.md) and the profile into every session
- `~/.config/dops/<project>.env`: the project's secrets, the one file read by the skills, the CLI and the dashboard (`envFile` in `dops.config.yml`), never printed
- `drupal-ops-toolkit/dops.config.yml`: the URL set used by the visual skills

and adds `drupal-ops-toolkit/`, `.claude/` and `CLAUDE.local.md` to
`.git/info/exclude`.

Updates: `git -C drupal-ops-toolkit pull`, then `/reload-plugins` or a new session.

## Rules for this folder

Nothing about a client or a project goes into tracked files here: no names,
domains, ticket keys, people or credentials. Project values belong in the
profile; secrets in the env file. Examples use `example.com` and `SHOP-123`.
