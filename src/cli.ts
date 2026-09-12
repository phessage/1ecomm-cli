#!/usr/bin/env node
/**
 * 1ecomm — scaffold and run a storefront on the 1Ecomm headless platform.
 *
 * Argument parsing is hand-rolled for the same reason the prompts are: this
 * package is downloaded before a developer sees anything, and a flag parser is
 * not worth a dependency tree.
 */
import { init, type InitFlags } from './commands/init.js';
import { doctor } from './commands/doctor.js';
import { PromptCancelled, c } from './lib/prompt.js';

const VERSION = '0.1.0';

const USAGE = `
${c.bold('1ecomm')} — storefronts on the 1Ecomm headless platform

${c.bold('Usage')}
  1ecomm init [directory]     scaffold a storefront and connect it to a store
  1ecomm doctor [directory]   check an existing project against the live platform

${c.bold('init options')}   every prompt has a flag, so the whole thing is scriptable
  --store-id <uuid>           the store to connect to; validated before anything is written
  --framework <name>          react (nextjs, vue and angular are coming)
  --palette <name>            one of dt-ui's 24 palettes, e.g. indigo
  --appearance <mode>         light | dark | system
  --package-manager <name>    npm | pnpm | yarn | bun
  --bootstrap-url <url>       override the platform origin (default https://api.1ecomm.com)
  --install / --no-install    install dependencies without asking
  --start / --no-start        start the dev server when the install finishes
  -y, --yes                   accept sensible defaults for everything not given

${c.bold('Notes')}
  There is no API key to paste. The publishable key, API URL and the store's
  capability list are all discovered from the store ID, so nothing secret ever
  reaches the generated project.

  Routes are gated by what the store can actually do: a catalog-only store is
  scaffolded with no checkout route rather than one that always fails.

${c.bold('Examples')}
  npm create @1ecomm/storefront@latest my-shop
  1ecomm init my-shop --store-id 01f5b02f-d7c0-42cd-b880-59f78ea70aa3 --framework react -y
  1ecomm doctor
`;

interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    if (arg === '-y') {
      flags['yes'] = true;
      continue;
    }
    if (arg === '-h') {
      flags['help'] = true;
      continue;
    }

    const body = arg.replace(/^--/, '');
    // `--no-install` sets install=false, which is distinct from "not given".
    if (body.startsWith('no-')) {
      flags[camel(body.slice(3))] = false;
      continue;
    }
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags[camel(body.slice(0, eq))] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      flags[camel(body)] = next;
      i++;
    } else {
      flags[camel(body)] = true;
    }
  }

  return { command: positional[0], positional: positional.slice(1), flags };
}

const camel = (s: string): string => s.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: string | boolean | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

async function main(): Promise<void> {
  const { command, positional, flags } = parse(process.argv.slice(2));

  if (flags['version']) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (flags['help'] || command === undefined || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  switch (command) {
    case 'init':
    case 'create': {
      const initFlags: InitFlags = {
        ...(positional[0] !== undefined ? { dir: positional[0] } : {}),
        ...(asString(flags['storeId']) !== undefined ? { storeId: asString(flags['storeId'])! } : {}),
        ...(asString(flags['framework']) !== undefined ? { framework: asString(flags['framework'])! } : {}),
        ...(asString(flags['palette']) !== undefined ? { palette: asString(flags['palette'])! } : {}),
        ...(asString(flags['appearance']) !== undefined ? { appearance: asString(flags['appearance'])! } : {}),
        ...(asString(flags['packageManager']) !== undefined
          ? { packageManager: asString(flags['packageManager'])! }
          : {}),
        ...(asString(flags['bootstrapUrl']) !== undefined
          ? { bootstrapUrl: asString(flags['bootstrapUrl'])! }
          : {}),
        ...(asBoolean(flags['install']) !== undefined ? { install: asBoolean(flags['install'])! } : {}),
        ...(asBoolean(flags['start']) !== undefined ? { start: asBoolean(flags['start'])! } : {}),
        ...(flags['yes'] === true ? { yes: true } : {}),
      };
      await init(initFlags);
      return;
    }

    case 'doctor':
      await doctor({
        ...(positional[0] !== undefined ? { dir: positional[0] } : {}),
        ...(asString(flags['bootstrapUrl']) !== undefined
          ? { bootstrapUrl: asString(flags['bootstrapUrl'])! }
          : {}),
      });
      return;

    default:
      process.stderr.write(`${c.red('x')} Unknown command "${command}".\n${USAGE}\n`);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof PromptCancelled) {
    process.stdout.write(`\n${c.grey('Cancelled.')}\n`);
    process.exit(130);
  }
  process.stderr.write(`\n${c.red('x')} ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
