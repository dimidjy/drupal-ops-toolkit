# Drupal file categories

Use these patterns to group files found in git diffs. Project-specific modules,
branches and commit conventions live in the project profile, not here.

The docroot is usually `web/`, sometimes `docroot/` or the repository root;
read the paths below relative to it. `custom/*` stands for any custom module
or theme.

## Code

| Path pattern                                   | Category            | Notes                                                     |
| ---------------------------------------------- | ------------------- | --------------------------------------------------------- |
| `modules/custom/*/src/Service/`                | Backend Service     | Business logic                                            |
| `modules/custom/*/src/Controller/`             | Controller          | Page and route handlers                                   |
| `modules/custom/*/src/Form/`                   | Form                | Form classes                                              |
| `modules/custom/*/src/Plugin/`                 | Plugin              | Blocks, fields, Views, filters, queue workers             |
| `modules/custom/*/src/Plugin/migrate/`         | Migration Plugin    | Source, process and destination plugins                   |
| `modules/custom/*/src/EventSubscriber/`        | Event Subscriber    | Symfony events                                            |
| `modules/custom/*/src/Hook/`                   | Hook Implementation | Drupal 11.1+ hooks as classes with `#[Hook]` attributes   |
| `*.module`, `*.theme`                          | Hook Implementation | Procedural hooks; both kinds run globally                 |
| `*.install`, `*.post_update.php`               | Update Hook         | Needs `drush updb` on deploy                              |
| `*.api.php`                                    | Hook Documentation  | No runtime effect                                         |
| `modules/custom/*/src/Drush/`, `src/Commands/` | Drush Command       | CLI commands (Drush 12+ uses `src/Drush/Commands/`)       |
| `modules/custom/*/src/Entity/`                 | Entity              | Entity type definitions; schema changes need updates      |
| `modules/custom/*/src/Access/`                 | Access Control      | Access checks                                             |
| `modules/contrib/`, `themes/contrib/`, `core/` | Contributed Code    | Normally managed by Composer; a direct edit is a red flag |

## Front end

| Path pattern                                                | Category        | Notes                                      |
| ----------------------------------------------------------- | --------------- | ------------------------------------------ |
| `themes/custom/*/src/` (js, scss)                           | Frontend Source | Theme sources                              |
| `themes/custom/*/js/`, `css/`, `assets/`, `dist/`           | Frontend Build  | Compiled files; review the source instead  |
| `themes/custom/*/templates/`, `modules/custom/*/templates/` | Twig Template   | Templates                                  |
| `*/components/**/*.component.yml` and files next to it      | Component       | Single Directory Components (Drupal 10.1+) |
| `*.libraries.yml`                                           | Libraries       | Asset libraries, weights and dependencies  |
| `*.breakpoints.yml`, `*.layouts.yml`                        | Theme Metadata  | Breakpoints, layouts                       |

## Definitions and metadata

| Path pattern                                                      | Category           | Notes                                |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------ |
| `*.services.yml`                                                  | Service Definition | Dependency injection                 |
| `*.routing.yml`                                                   | Routing            | Routes and their access requirements |
| `*.permissions.yml`                                               | Permissions        | Permissions                          |
| `*.links.menu.yml`, `.task.yml`, `.action.yml`, `.contextual.yml` | Admin UI Links     | Menu items, tabs, action buttons     |
| `*.info.yml`                                                      | Module/Theme Info  | Metadata, dependencies, core version |
| `translations/*.po`                                               | Translations       | Interface translations               |

## Configuration

| Path pattern                                                      | Category        | Notes                                                                             |
| ----------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `*/config/install/`, `*/config/optional/`                         | Default Config  | Read only when the module or profile is installed; existing sites are not updated |
| `*/config/schema/*.schema.yml`                                    | Config Schema   | Types of config values; a wrong schema breaks import and translation              |
| Project export folder (`config/sync` or as set in `settings.php`) | Exported Config | What a full `drush cim` imports; check it is the folder actually deployed         |
| Partial config folders used by the project                        | Config Set      | Imported with `drush cim --partial --source=...`                                  |
| `field.storage.*.yml`                                             | Field Storage   | Shared by every bundle; changes can need a data migration                         |
| `migrations/*.yml`, `migrate_plus.migration.*.yml`                | Migration       | Migration definitions                                                             |
| `recipes/`                                                        | Recipe          | Drupal recipes (10.3+), applied once                                              |
| `profiles/custom/`                                                | Install Profile | Its config only applies on a fresh install                                        |

## Project and environment

| Path pattern                                                               | Category           | Notes                                   |
| -------------------------------------------------------------------------- | ------------------ | --------------------------------------- |
| `composer.json`, `composer.lock`                                           | Dependencies       | PHP dependencies and patch list         |
| `patches/`, `*.patch`                                                      | Patches            | Patches to contrib or core              |
| `package.json`, lock files                                                 | JS Dependencies    | Node dependencies                       |
| `sites/*/settings*.php`, `sites/*/services.yml`, `sites/sites.php`         | Site Configuration | Per-site settings, multisite mapping    |
| `drush/`                                                                   | Drush Config       | Site aliases                            |
| `.ddev/`, `docker-compose*.yml`                                            | Dev Environment    | Local environment only                  |
| `.github/`, `.gitlab-ci.yml`, `phpstan.neon`, `phpcs.xml*`, `phpunit.xml*` | CI and Analysis    | Pipelines, static analysis, test config |
| `tests/`, `*/tests/`                                                       | Tests              | PHPUnit, Behat, Playwright              |

## Review priority

1. **Always read the full diff:**
   - `*.services.yml`, `*.module`, `src/Hook/`, `settings*.php`, `src/Service/`;
   - update hooks and `field.storage.*`, because they change data;
   - security: `*.routing.yml` (look for `_access: 'TRUE'` and missing requirements), `*.permissions.yml`, `src/Access/`, controllers and forms that take user input;
   - new files.
2. **Read when relevant:** plugins, entity definitions, config schema, exported config and config sets, migrations.
3. **Skim the stats:** templates, styles, scripts, compiled assets, tests, CI.

When config changes, note in the report how it reaches existing sites:
`config/install` alone does not, so a config import, an update hook or a
command must ship with it.
