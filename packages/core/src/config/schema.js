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
});

/** This machine: steps run in a local shell, e.g. `ddev drush cr` in a project folder. */
const localTarget = z.object({
  local: z.literal(true),
  path: z.string().default('.'),
  environment: z.string().optional(),
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
    dashboard: z
      .object({
        /** Allow free-form commands from the dashboard (localhost + token only). */
        allowCommands: z.boolean().default(true),
        /** Pipelines and parameters created in the dashboard. */
        workspaceFile: z.string().default('.dops/workspace.json'),
      })
      .default({}),
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
