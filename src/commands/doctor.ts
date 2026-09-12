/**
 * `1ecomm doctor` — diagnose an existing project against the live platform.
 *
 * This exists because the cheapest support ticket is the one nobody files. The
 * failure it targets is specific and common: a storefront that builds perfectly
 * and then cannot browse, cart or check out, because the store's application
 * lost a capability or was suspended. That produces a runtime error with no
 * obvious cause, and the platform's own message — "Cart mutation could not be
 * completed" — does not name it.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_BOOTSTRAP_URL,
  PlatformError,
  describeCapabilities,
  fetchStoreConfig,
  looksLikeStoreId,
  probeCatalog,
} from '../lib/platform.js';
import { c } from '../lib/prompt.js';

export interface DoctorFlags {
  dir?: string;
  bootstrapUrl?: string;
}

type Status = 'ok' | 'warn' | 'fail';

const MARK: Record<Status, string> = {
  ok: c.green('ok  '),
  warn: c.yellow('warn'),
  fail: c.red('fail'),
};

interface Check {
  status: Status;
  label: string;
  detail?: string;
}

function report(checks: Check[]): void {
  for (const check of checks) {
    process.stdout.write(`  ${MARK[check.status]}  ${check.label}\n`);
    if (check.detail) {
      for (const line of check.detail.split('\n')) process.stdout.write(`        ${c.grey(line)}\n`);
    }
  }
}

/** Locate the store ID however this project's framework stores it. */
async function findConfig(
  dir: string,
): Promise<{ storeId: string; bootstrapUrl: string; source: string } | undefined> {
  const candidates = [
    'headless-config.json',
    'headless.config.json',
    join('public', 'headless-config.json'),
    join('assets', 'headless-config.json'),
    join('src', 'assets', 'headless-config.json'),
  ];
  for (const candidate of candidates) {
    const path = join(dir, candidate);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as {
        storeId?: string;
        bootstrapUrl?: string;
      };
      if (parsed.storeId) {
        return {
          storeId: parsed.storeId,
          bootstrapUrl: parsed.bootstrapUrl ?? DEFAULT_BOOTSTRAP_URL,
          source: candidate,
        };
      }
    } catch {
      // A malformed config is worth reporting, but the caller reports absence;
      // keep looking in case another candidate is intact.
    }
  }
  return undefined;
}

export async function doctor(flags: DoctorFlags): Promise<void> {
  const dir = resolve(flags.dir ?? process.cwd());
  const checks: Check[] = [];

  process.stdout.write(`\n${c.bold('1ecomm doctor')} ${c.grey(dir)}\n\n`);

  const config = await findConfig(dir);
  if (!config) {
    report([
      {
        status: 'fail',
        label: 'store configuration',
        detail:
          'No headless-config.json with a storeId was found here.\n' +
          'Run this inside a storefront project, or pass the directory as an argument.',
      },
    ]);
    process.exit(1);
  }

  checks.push({ status: 'ok', label: `configuration found (${config.source})` });

  if (!looksLikeStoreId(config.storeId)) {
    checks.push({
      status: 'warn',
      label: 'store ID shape',
      detail: `"${config.storeId}" is not a UUID. The platform will almost certainly reject it.`,
    });
  }

  const bootstrapUrl = flags.bootstrapUrl ?? config.bootstrapUrl;

  let store;
  try {
    store = await fetchStoreConfig(config.storeId, { bootstrapUrl });
    checks.push({
      status: 'ok',
      label: `store resolves at ${new URL(store.apiUrl).host} (API ${store.apiVersion})`,
    });
  } catch (error) {
    const platform = error instanceof PlatformError ? error : undefined;
    checks.push({
      status: 'fail',
      label: 'store bootstrap',
      detail: [platform?.message ?? String(error), platform?.hint].filter(Boolean).join('\n'),
    });
    report(checks);
    process.exit(1);
  }

  const caps = describeCapabilities(store.capabilities);
  checks.push({
    status: caps.canBrowse ? 'ok' : 'fail',
    label: `capabilities: ${store.capabilities.join(', ') || 'none'}`,
    ...(caps.canBrowse
      ? {}
      : { detail: 'Without `catalog` this storefront has nothing to show. Grant the application catalog access.' }),
  });

  // The capability list says what is permitted; only a real call says what
  // works. Both matter, and they disagree more often than anyone expects.
  const probe = await probeCatalog(store);
  if (probe.ok) {
    checks.push({
      status: probe.count === 0 ? 'warn' : 'ok',
      label: `catalog read (${probe.count} product${probe.count === 1 ? '' : 's'} returned)`,
      ...(probe.count === 0
        ? { detail: 'The key works but the store has no published products, so every grid will be empty.' }
        : {}),
    });
  } else {
    checks.push({
      status: 'fail',
      label: `catalog read refused (HTTP ${probe.status})`,
      detail: [probe.detail, probe.requestId ? `request ${probe.requestId}` : undefined]
        .filter(Boolean)
        .join('\n'),
    });
  }

  // Routes the project ships that the store can no longer serve. This is the
  // drift the CLI cannot prevent: capabilities are revoked after scaffolding.
  const hasCheckoutRoute = existsSync(join(dir, 'src', 'routes', 'Checkout.tsx'));
  if (hasCheckoutRoute && !caps.canCheckout) {
    checks.push({
      status: 'warn',
      label: 'checkout route present but the store lost checkout capability',
      detail: 'Shoppers reaching /checkout will see a failure. Restore the capability or remove the route.',
    });
  }

  report(checks);

  const worst = checks.some((x) => x.status === 'fail')
    ? 'fail'
    : checks.some((x) => x.status === 'warn')
      ? 'warn'
      : 'ok';

  process.stdout.write('\n');
  if (worst === 'fail') {
    process.stdout.write(`${c.red('This project cannot serve a storefront as configured.')}\n\n`);
    process.exit(1);
  }
  process.stdout.write(
    worst === 'warn'
      ? `${c.yellow('Usable, with the warnings above.')}\n\n`
      : `${c.green('Everything checks out.')}\n\n`,
  );
}
