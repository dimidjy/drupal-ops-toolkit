# drupal-ops-toolkit

Personal automation for day-to-day Drupal work: deploy pipelines over SSH,
visual checks, smoke tests and AI-assisted code review.

## Usage

```bash
npm install
cp examples/dops.config.example.yml dops.config.yml   # adjust targets and pipelines

npx dops pipelines                    # what can I run?
npx dops deploy cache-clear --dry-run # show the commands per target
npx dops deploy deploy                # run it, with live output
npx dops exec -t prod-web1 prod-web2 -- drush status   # one-off command
npx dops history                      # previous runs
npx dops history show <run-id>        # steps and full output of one run
```

Pipelines are lists of shell steps that run on one or more targets, through
a bastion when needed. A failing step stops the run; later targets are
skipped so a broken release never reaches every server.

SSH uses your key file or agent. No passwords are stored in the config.

Steps can use `{placeholders}`: target values (`{target}`, `{path}`), site
values (`{alias}`) and parameters declared under `params` with a description
and an optional default. Missing values are asked for before anything runs,
as fields in the dashboard or with `-p branch=release/2.4` in the CLI.

A target with `local: true` runs its steps in a shell on this machine, in its
`path`. That's handy for local routines like `ddev drush cim` after switching
branches, with the same history and live output as remote runs.

## Dashboard

```bash
npm run build                 # builds the React dashboard once
npx dops serve                # http://127.0.0.1:4800
```

The dashboard lists pipelines, starts runs on chosen targets and sites,
streams their output live and keeps the run history. A quick-command box runs
any one-off command (`drush status`, `tail -n 50 …/php-error.log`) on the
ticked servers, and the Local tab does the same on this machine. It only listens on
localhost and every API call needs a token (`DOPS_TOKEN`, or the one printed
on start). Exposing it on another interface requires `DOPS_ALLOW_REMOTE=1`.

Pipelines and parameters can also be created in the dashboard (Editor and
Parameters tabs) from templates such as "Drupal deploy" or "Deploy with
maintenance". They are saved to `.dops/workspace.json` (`dashboard.workspaceFile`)
and work from the CLI too; the ones in `dops.config.yml` stay read-only and
can be duplicated.

## Visual checks

Screenshot a list of pages before a release, again after it, and get a pixel
diff with an HTML report:

```bash
npx dops visual capture staging --label before
npx dops deploy deploy
npx dops visual capture staging --label after
npx dops visual compare staging      # exit code 1 when pages differ
```

The report (`.dops/visual/<set>/report-before-after.html`) shows changed pages
first with before, after and diff images side by side. Dynamic elements such
as status messages or sliders can be hidden with `visual.hide` selectors.
Environments behind basic auth read their credentials from the env variables
named in `httpAuth`.

The dashboard's Visual tab does the same without any config: paste a list of
URLs, pick a viewport and settle delay, optionally add basic auth or cookies
(used for that capture only), then take the "before" screenshots, deploy, take
the "after" ones and compare. Only the pages that changed are listed, with
before, after and diff images, twenty at a time.
