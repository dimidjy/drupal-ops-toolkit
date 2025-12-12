/**
 * Starting points for the pipeline editor. Plain Drupal + Composer commands;
 * {alias} comes from the chosen site (e.g. "@self" or "@fr").
 */

/** @typedef {{ name: string, run: string, continueOnError?: boolean, timeoutSeconds?: number }} StepTemplate */

/** @type {Record<string, StepTemplate>} */
export const STEPS = {
  'git pull': { name: 'Pull code', run: 'git pull --ff-only' },
  'composer install': {
    name: 'Install dependencies',
    run: 'composer install --no-dev --no-interaction --optimize-autoloader',
    timeoutSeconds: 900,
  },
  updb: { name: 'Database updates', run: 'vendor/bin/drush {alias} updb -y' },
  cim: { name: 'Import configuration', run: 'vendor/bin/drush {alias} cim -y' },
  cex: { name: 'Export configuration', run: 'vendor/bin/drush {alias} cex -y' },
  cr: { name: 'Rebuild caches', run: 'vendor/bin/drush {alias} cr' },
  cron: { name: 'Run cron', run: 'vendor/bin/drush {alias} cron' },
  status: { name: 'Status', run: 'vendor/bin/drush {alias} status' },
  'maintenance on': {
    name: 'Maintenance mode on',
    run: 'vendor/bin/drush {alias} state:set system.maintenance_mode 1 --input-format=integer',
  },
  'maintenance off': {
    name: 'Maintenance mode off',
    run: 'vendor/bin/drush {alias} state:set system.maintenance_mode 0 --input-format=integer',
  },
  'recent errors': {
    name: 'Recent errors',
    run: 'vendor/bin/drush {alias} watchdog:show --severity=Error --count=20',
    continueOnError: true,
  },
};

/** @type {Record<string, { description: string, steps: string[] }>} */
export const PIPELINES = {
  'Drupal deploy': {
    description: 'Pull code, install dependencies, update the database and config',
    steps: ['git pull', 'composer install', 'updb', 'cim', 'cr'],
  },
  'Deploy with maintenance': {
    description: 'Deploy behind maintenance mode',
    steps: [
      'maintenance on',
      'git pull',
      'composer install',
      'updb',
      'cim',
      'maintenance off',
      'cr',
    ],
  },
  'Cache rebuild': { description: 'Rebuild Drupal caches', steps: ['cr'] },
  'Health check': {
    description: 'Status and recent errors',
    steps: ['status', 'recent errors'],
  },
};
