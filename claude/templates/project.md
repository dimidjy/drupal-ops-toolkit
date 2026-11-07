# Project profile (dops plugin)

Format: `key: value`, one per line. Leave a value empty when it does not apply.
This file lives in the project (`.claude/dops/project.md`), never in the toolkit.

## Project

project_name:
toolkit_dir: drupal-ops-toolkit
dops_cli: cd drupal-ops-toolkit && npx dops
env_file: ~/.config/dops/<project>.env
output_language: en

## Tracker

tracker_url:
ticket_key_pattern: [A-Z][A-Z0-9]+-[0-9]+
jira_meta_fields:
jira_dump_dir:

## Reports

report_greeting: Hello @<handle>. :wave:
report_dir:

## Local environment

local_sites:
local_drush: ddev drush @<site> <command>
ddev_config_file: .ddev/config.yaml
local_ddev_name:
db_core_major:

## Remote test environments (non-production only)

remote_test_envs:
remote_allowed_hosts:
production_hosts:

## Git and deploy

prod_base: origin/main
dev_branch:
ticket_branch: release/<TICKET-ID>
commit_message: Release <TICKET-ID>
commits_per_branch: 1
never_in_ticket: .ddev/config.yaml, drupal-ops-toolkit/, .claude/, CLAUDE.local.md
exclude_from_ticket_commits: merge commits, release commits, stash commits (index on / untracked files on / WIP on)
custom_commands_dir: web/modules/custom
task_commands:
config_sets:
stale_config_do_not_use:
compiled_assets:
theme_dir:
theme_build:
theme_node:
deploy_default: drush cr
deploy_config_import:
deploy_task_command:
deploy_one_site: drush --uri=<domain> <command>
local_checks: php -l on changed PHP files; git diff --cached --check

## Visual QA

visual_set: local
