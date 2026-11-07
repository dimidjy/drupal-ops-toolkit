import { z } from 'zod';

export const name = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, "-" and "_"');

/**
 * SSH endpoint. Credentials are never stored in the config: authenticate with a
 * private key file, the SSH agent, or both. A key passphrase is read from the
 * environment variable named in `passphraseEnv`.
 */
const sshEndpoint = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  user: z.string().min(1),
  identityFile: z.string().optional(),
  passphraseEnv: z.string().optional(),
  agent: z.boolean().default(false),
  /** Expected host key, e.g. "SHA256:..." from `ssh-keygen -lf`. */
  hostFingerprint: z.string().optional(),
});

const bastion = sshEndpoint;

const sshTarget = sshEndpoint.extend({
  /** Working directory the steps run in. */
  path: z.string().default('.'),
  /** Name of a bastion to tunnel through. */
  bastion: name.optional(),
  /** Free-form label shown in the CLI and dashboard, e.g. "staging". */
  environment: z.string().optional(),
  /** Set for production servers, e.g. by `production: true` in an environment file. */
  production: z.boolean().default(false),
});

/** This machine: steps run in a local shell, e.g. `ddev drush cr` in a project folder. */
const localTarget = z.object({
  local: z.literal(true),
  path: z.string().default('.'),
  environment: z.string().optional(),
  production: z.boolean().default(false),
});

const target = z.union([localTarget, sshTarget]);

const step = z.object({
  name: z.string().min(1),
  run: z.string().min(1),
  continueOnError: z.boolean().default(false),
  timeoutSeconds: z.number().int().positive().default(600),
});

export const pipelineSchema = z.object({
  description: z.string().optional(),
  /** Targets the pipeline runs on unless overridden on the command line. */
  targets: z.array(name).min(1),
  steps: z.array(step).min(1),
});

/** Basic auth for protected environments; names of env variables, not values. */
const httpAuth = z.object({ usernameEnv: z.string(), passwordEnv: z.string() }).strict();

const urlSet = z.object({
  baseUrl: z.string().url(),
  paths: z.array(z.string().startsWith('/')).min(1),
  /** Other deployments of the same site, e.g. { prod: "https://www.example.com" }. */
  environments: z.record(name, z.string().url()).default({}),
  httpAuth: httpAuth.optional(),
  /** Other origins a capture may be redirected to, e.g. a language subdomain. */
  allowedOrigins: z.array(z.string().url()).optional(),
});

const visual = z.object({
  outputDir: z.string().default('.dops/visual'),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1440, height: 900 }),
  fullPage: z.boolean().default(true),
  /** pixelmatch colour threshold per pixel (0..1). */
  threshold: z.number().min(0).max(1).default(0.1),
  /** A page counts as changed when more than this share of pixels differs. */
  maxDiffRatio: z.number().min(0).max(1).default(0.001),
  /** Pages captured in parallel (browser tabs). */
  concurrency: z.number().int().min(1).max(16).default(4),
  /** CSS selectors hidden before the screenshot (carousels, timestamps…). */
  hide: z.array(z.string()).default([]),
  /** Add a unique query parameter to every page so Varnish or a CDN serves it fresh. */
  cacheBust: z.boolean().default(false),
  urlSets: z.record(name, urlSet).default({}),
});

const uiSuite = z.object({
  /** Folder with Playwright *.spec.js files, relative to the working directory. */
  testDir: z.string().min(1),
  baseUrl: z.string().url(),
  retries: z.number().int().min(0).default(1),
  workers: z.number().int().positive().default(2),
  timeoutSeconds: z.number().int().positive().default(30),
  httpAuth: httpAuth.optional(),
  /** Other deployments the suite can run against, e.g. { prod: "https://www.example.com" }. */
  environments: z.record(name, z.string().url()).default({}),
});

export const BROWSERS = /** @type {const} */ (['chromium', 'firefox', 'webkit', 'mobile']);

/** What to run of a suite: one spec file, an environment, URLs, a browser. */
export const uiRunOptions = z.object({
  testFile: z.string().optional(),
  environment: name.optional(),
  /** Passed to the specs as DOPS_TEST_URLS (comma separated). */
  urls: z.array(z.string()).optional(),
  browser: z.enum(BROWSERS).optional(),
});

const uiSchedule = uiRunOptions.extend({
  suite: name,
  /** Cron expression, e.g. "0 7 * * 1-5" for weekdays at 07:00. */
  cron: z.string().min(1),
  timezone: z.string().optional(),
  name: z.string().optional(),
});

const uiTests = z.object({
  outputDir: z.string().default('.dops/ui-tests'),
  suites: z.record(name, uiSuite).default({}),
  schedules: z.array(uiSchedule).default([]),
  /** Posts { text } (Slack-compatible) to the URL in this env variable. */
  notify: z
    .object({
      webhookEnv: z.string(),
      /** "failures" also reports when a failing suite passes again. */
      when: z.enum(['failures', 'always']).default('failures'),
    })
    .optional(),
});

const db = z.object({
  /** Writes a gzipped dump to stdout; runs in the target's path with site {placeholders}. */
  dumpCommand: z
    .string()
    .default(
      'vendor/bin/drush {alias} sql-dump --structure-tables-list=cache,cache_*,flood,sessions,watchdog | gzip -c',
    ),
  outputDir: z.string().default('.dops/db'),
  /** Local command for `db pull --import`; {file} is the downloaded dump. */
  importCommand: z.string().default('ddev import-db --file={file}'),
  timeoutSeconds: z.number().int().positive().default(3600),
});

/** Per-site values available to steps as {placeholders}. */
const site = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const paramName = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'letters, digits and "_", not starting with a digit');

/** A value steps can use as {name}; asked for at run time when not given. */
export const paramSchema = z.object({
  description: z.string().optional(),
  default: z.string().optional(),
});

export const configSchema = z
  .object({
    bastions: z.record(name, bastion).default({}),
    targets: z.record(name, target).default({}),
    sites: z.record(name, site).default({}),
    pipelines: z.record(name, pipelineSchema).default({}),
    params: z.record(paramName, paramSchema).default({}),
    visual: visual.default({}),
    ai: z
      .object({
        /** How to start dops-ai; defaults to the Python package in this repository via uv. */
        command: z.string().optional(),
        /** Git repository whose commits the dashboard reviews. */
        repo: z.string().default('.'),
        provider: z.enum(['openai', 'anthropic']).default('openai'),
      })
      .default({}),
    dashboard: z
      .object({
        /** Allow free-form commands from the dashboard (localhost + token only). */
        allowCommands: z.boolean().default(true),
        /** Pipelines and parameters created in the dashboard. */
        workspaceFile: z.string().default('.dops/workspace.json'),
      })
      .default({}),
    db: db.default({}),
    uiTests: uiTests.default({}),
  })
  .superRefine((config, ctx) => {
    for (const [targetName, t] of Object.entries(config.targets)) {
      if ('local' in t) continue;
      if (t.bastion && !config.bastions[t.bastion]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', targetName, 'bastion'],
          message: `unknown bastion "${t.bastion}"`,
        });
      }
      if (!t.identityFile && !t.agent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', targetName],
          message: 'set identityFile or agent: true',
        });
      }
    }
    for (const [pipelineName, p] of Object.entries(config.pipelines)) {
      p.targets.forEach((t, i) => {
        if (!config.targets[t]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pipelines', pipelineName, 'targets', i],
            message: `unknown target "${t}"`,
          });
        }
      });
    }
    config.uiTests.schedules.forEach((schedule, i) => {
      if (!config.uiTests.suites[schedule.suite]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uiTests', 'schedules', i, 'suite'],
          message: `unknown suite "${schedule.suite}"`,
        });
      }
    });
  });

/** @typedef {z.infer<typeof configSchema>} Config */
/** @typedef {z.infer<typeof bastion>} Bastion */
/** @typedef {z.infer<typeof target>} Target */
/** @typedef {z.infer<typeof sshTarget>} SshTarget */
/** @typedef {z.infer<typeof localTarget>} LocalTarget */

/**
 * @param {Target} target
 * @returns {target is LocalTarget}
 */
export function isLocalTarget(target) {
  return 'local' in target && target.local === true;
}

/**
 * Short description for logs and the dashboard, e.g. "deploy@10.0.0.1:/var/www".
 *
 * @param {Target} target
 */
export function describeTarget(target) {
  return isLocalTarget(target)
    ? `local:${target.path}`
    : `${target.user}@${target.host}:${target.path}`;
}
/** @typedef {z.infer<typeof pipelineSchema>} Pipeline */
/** @typedef {z.infer<typeof step>} Step */
/** @typedef {z.infer<typeof site>} SiteParams */
/** @typedef {z.infer<typeof paramSchema>} ParamDefinition */

/**
 * Defaults of the configured parameters, as {placeholder} values.
 *
 * @param {Config} config
 * @returns {Record<string, string>}
 */
export function paramDefaults(config) {
  return Object.fromEntries(
    Object.entries(config.params).flatMap(([key, p]) =>
      p.default === undefined ? [] : [[key, p.default]],
    ),
  );
}
/** @typedef {z.infer<typeof visual>} VisualConfig */
/** @typedef {z.infer<typeof db>} DbConfig */
/** @typedef {z.infer<typeof uiTests>} UiTestsConfig */
/** @typedef {z.infer<typeof uiSuite>} UiSuite */
/** @typedef {z.infer<typeof uiSchedule>} UiSchedule */
/** @typedef {z.infer<typeof uiRunOptions>} UiRunOptions */
/** @typedef {z.infer<typeof uiTests>['notify']} UiNotify */
/** @typedef {z.infer<typeof urlSet>} UrlSet */
