#!/usr/bin/env node
/**
 * `npm create @1ecomm/storefront` lands here.
 *
 * npm resolves `create <scope>/<name>` to the package `<scope>/create-<name>`
 * and runs its single bin. There is nothing to do but hand the arguments to the
 * CLI's `init`, so this package exists purely to own that name — keeping the
 * conversation, the validation and the templates in one place rather than two
 * that can drift.
 */
import { init } from '@1ecomm/cli/dist/commands/init.js';

const argv = process.argv.slice(2);
const positional = [];
const flags = {};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('-')) {
    positional.push(arg);
    continue;
  }
  if (arg === '-y') {
    flags.yes = true;
    continue;
  }
  const body = arg.replace(/^--/, '');
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

function camel(s) {
  return s.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

if (positional[0] !== undefined) flags.dir = positional[0];

try {
  await init(flags);
} catch (error) {
  if (error?.name === 'PromptCancelled') {
    process.stdout.write('\nCancelled.\n');
    process.exit(130);
  }
  process.stderr.write(`\nx ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
