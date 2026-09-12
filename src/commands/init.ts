/**
 * `1ecomm init` — the conversation that turns a store ID into a running shop.
 *
 * The ordering is the design. The store ID is asked FIRST and validated against
 * the live platform before any other question, so a wrong ID costs one prompt
 * rather than a scaffolded project that installs, builds, and only then fails at
 * runtime. Everything after it is shaped by what that store can actually do.
 *
 * There is no token to paste. The publishable key, API URL and capability list
 * all come back from the bootstrap call, which is why headless-config.json holds
 * only a store ID and why nothing secret ever reaches the generated project.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import {
  DEFAULT_BOOTSTRAP_URL,
  PlatformError,
  describeCapabilities,
  fetchStoreConfig,
  looksLikeStoreId,
  probeCatalog,
  type StoreConfig,
} from '../lib/platform.js';
import { APPEARANCES, DEFAULT_PALETTE, PALETTES, isPalette, type Appearance } from '../lib/palettes.js';
import {
  RUN_COMMAND,
  isValidProjectName,
  scaffold,
  titleFromName,
  type Framework,
  type PackageManager,
  type ScaffoldPlan,
} from '../lib/scaffold.js';
import * as p from '../lib/prompt.js';

/** dt-ui version the generated project depends on. */
const DT_UI_VERSION = '^0.1.0';

/** What `-y` picks when no framework is named. */
const DEFAULT_FRAMEWORK: Framework = 'react';

const FRAMEWORKS: Array<{ value: Framework; label: string; hint: string; ready: boolean }> = [
  { value: 'react', label: 'React', hint: 'Vite, React Router', ready: true },
  { value: 'nextjs', label: 'Next.js', hint: 'App Router, server components', ready: false },
  { value: 'vue', label: 'Vue', hint: 'Vite, Vue Router', ready: true },
  { value: 'angular', label: 'Angular', hint: 'standalone components, signals', ready: false },
];

export interface InitFlags {
  dir?: string;
  storeId?: string;
  framework?: string;
  palette?: string;
  appearance?: string;
  packageManager?: string;
  bootstrapUrl?: string;
  install?: boolean;
  start?: boolean;
  yes?: boolean;
}

function fail(message: string, hint?: string): never {
  process.stderr.write(`\n${p.c.red('x')} ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  process.exit(1);
}

async function directoryIsUsable(dir: string): Promise<string | undefined> {
  if (!existsSync(dir)) return undefined;
  const entries = await readdir(dir);
  const meaningful = entries.filter((e) => e !== '.git' && e !== '.DS_Store');
  return meaningful.length === 0
    ? undefined
    : `${dir} already exists and is not empty. Choose another directory.`;
}

/** Resolve the store, showing what it can do. Retries until one validates. */
async function resolveStore(flags: InitFlags): Promise<StoreConfig> {
  const bootstrapUrl = flags.bootstrapUrl ?? DEFAULT_BOOTSTRAP_URL;

  if (flags.storeId) {
    try {
      return await fetchStoreConfig(flags.storeId, { bootstrapUrl });
    } catch (error) {
      const platform = error instanceof PlatformError ? error : undefined;
      fail(platform?.message ?? String(error), platform?.hint);
    }
  }

  for (;;) {
    const id = await p.text({
      message: 'Store ID',
      placeholder: 'from your 1Ecomm workspace, under Applications',
      validate: (value) =>
        value.length === 0
          ? 'Paste your store ID.'
          : looksLikeStoreId(value)
            ? undefined
            : 'A store ID is a UUID, like 01f5b02f-d7c0-42cd-b880-59f78ea70aa3.',
    });

    try {
      return await p.spin('Checking that store with the platform', () =>
        fetchStoreConfig(id, { bootstrapUrl }),
      );
    } catch (error) {
      const platform = error instanceof PlatformError ? error : undefined;
      p.warn(platform?.message ?? 'Could not validate that store.');
      if (platform?.hint) for (const line of platform.hint.split('\n')) p.note(line);
    }
  }
}

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * Check every flag the caller supplied, before anything is asked or written.
 *
 * Validating late means a developer answers four questions and validates a
 * store against the network before being told they mistyped `--palette`. These
 * are all pure checks against values the CLI already knows, so there is no
 * reason to defer them.
 */
function validateFlags(flags: InitFlags): void {
  if (flags.framework) {
    const match = FRAMEWORKS.find((f) => f.value === flags.framework);
    if (!match) {
      fail(
        `Unknown framework "${flags.framework}".`,
        `Choose one of: ${FRAMEWORKS.map((f) => f.value).join(', ')}.`,
      );
    }
    if (!match.ready) {
      const ready = FRAMEWORKS.filter((f) => f.ready).map((f) => f.value).join(' and ');
      fail(`The ${match.label} template is not available yet.`, `Ready today: ${ready}.`);
    }
  }

  if (flags.palette && !isPalette(flags.palette)) {
    fail(
      `Unknown palette "${flags.palette}".`,
      `Choose one of: ${PALETTES.map((x) => x.name).join(', ')}.`,
    );
  }

  if (flags.appearance && !APPEARANCES.includes(flags.appearance as Appearance)) {
    fail(`Unknown appearance "${flags.appearance}".`, 'Choose light, dark or system.');
  }

  if (flags.packageManager && !PACKAGE_MANAGERS.includes(flags.packageManager as PackageManager)) {
    fail(
      `Unknown package manager "${flags.packageManager}".`,
      `Choose one of: ${PACKAGE_MANAGERS.join(', ')}.`,
    );
  }

  if (flags.bootstrapUrl) {
    try {
      new URL(flags.bootstrapUrl);
    } catch {
      fail(`"${flags.bootstrapUrl}" is not a URL.`, 'For example: --bootstrap-url https://api.1ecomm.com');
    }
  }
}

export async function init(flags: InitFlags): Promise<void> {
  validateFlags(flags);
  p.intro('Create a 1Ecomm storefront');

  // ---- 1. the store, before anything else --------------------------------
  const store = await resolveStore(flags);
  const caps = describeCapabilities(store.capabilities);
  p.success(
    `Store ${store.storeId.slice(0, 8)}… on ${new URL(store.apiUrl).host} · ` +
      `${store.capabilities.join(', ') || 'no capabilities reported'}`,
  );

  if (!caps.canBrowse) {
    fail(
      'That store has no catalog capability, so a storefront has nothing to show.',
      'Give its application catalog access in your 1Ecomm workspace, then run this again.',
    );
  }

  // One authenticated read, so a key that bootstraps but cannot be used is
  // caught here rather than in the browser.
  const probe = await p.spin('Reading the catalog', () => probeCatalog(store));
  if (!probe.ok) {
    p.warn(`The catalog refused a read (HTTP ${probe.status}${probe.detail ? `: ${probe.detail}` : ''}).`);
    p.note('Scaffolding anyway. Run `1ecomm doctor` in the project to diagnose it.');
  } else if (probe.count === 0) {
    p.warn('The catalog is reachable but has no published products yet.');
    p.note('The storefront will build and run; it will just have nothing to show.');
  } else {
    p.success('Catalog reachable, with published products.');
  }

  // ---- 2. directory and name ---------------------------------------------
  const rawDir =
    flags.dir ??
    (await p.text({
      message: 'Where should it go?',
      placeholder: 'directory name',
      initial: 'my-shop',
      validate: async (value) => isValidProjectName(basename(value)) ?? (await directoryIsUsable(resolve(value))),
    }));

  const directory = resolve(rawDir);
  const nameProblem = isValidProjectName(basename(directory)) ?? (await directoryIsUsable(directory));
  if (nameProblem) fail(nameProblem);

  const projectName = basename(directory);

  // ---- 3. framework -------------------------------------------------------
  const framework: Framework = flags.framework
    ? (flags.framework as Framework)
    : // `-y` means "accept sensible defaults for everything not given", and it
      // has to include the framework or the flag is a half-promise that still
      // blocks in CI.
      flags.yes
      ? DEFAULT_FRAMEWORK
      : await p.select<Framework>({
        message: 'Framework',
        choices: FRAMEWORKS.map((f) => ({
          value: f.value,
          label: f.label,
          ...(f.ready ? { hint: f.hint } : { disabled: 'coming soon' }),
        })),
      });

  // ---- 4. look ------------------------------------------------------------
  const palette = flags.palette
    ? flags.palette
    : flags.yes
      ? DEFAULT_PALETTE
      : await p.select<string>({
          message: 'Colour',
          choices: PALETTES.map((entry) => ({ value: entry.name, label: entry.name, color: entry.hex })),
          initial: PALETTES.findIndex((entry) => entry.name === DEFAULT_PALETTE),
        });

  const appearance: Appearance = flags.appearance
    ? (flags.appearance as Appearance)
    : flags.yes
      ? 'system'
      : await p.select<Appearance>({
          message: 'Appearance',
          choices: [
            { value: 'system', label: 'Follow the system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        });

  // ---- 5. routes, gated by what the store can do --------------------------
  //
  // Checkout and order lookup are offered only when the store's capabilities
  // permit them. A catalog-only store gets a project with no checkout route at
  // all, which is the difference between a storefront and a demo that 400s.
  const routeChoices = [
    { value: 'checkout' as const, label: 'Checkout', enabled: caps.canCheckout, why: 'store has no checkout capability' },
    { value: 'orders' as const, label: 'Order lookup', enabled: caps.canOrder, why: 'store cannot place orders' },
  ];

  const available = routeChoices.filter((r) => r.enabled);
  let chosenRoutes: Array<'checkout' | 'orders'> = available.map((r) => r.value);

  if (!flags.yes && routeChoices.some((r) => !r.enabled)) {
    for (const blocked of routeChoices.filter((r) => !r.enabled)) {
      p.note(`${blocked.label} is unavailable: ${blocked.why}.`);
    }
  }
  if (!flags.yes && available.length > 0) {
    chosenRoutes = await p.multiselect<'checkout' | 'orders'>({
      message: 'Optional routes',
      choices: routeChoices.map((r) => ({
        value: r.value,
        label: r.label,
        ...(r.enabled ? {} : { disabled: r.why }),
      })),
      initial: available.map((r) => r.value),
      allowEmpty: true,
    });
  }

  // ---- 6. package manager -------------------------------------------------
  const packageManager: PackageManager = (flags.packageManager as PackageManager | undefined) ??
    (flags.yes
      ? 'npm'
      : await p.select<PackageManager>({
          message: 'Package manager',
          choices: [
            { value: 'npm', label: 'npm' },
            { value: 'pnpm', label: 'pnpm' },
            { value: 'yarn', label: 'yarn' },
            { value: 'bun', label: 'bun' },
          ],
        }));

  // ---- 7. write it --------------------------------------------------------
  const plan: ScaffoldPlan = {
    directory,
    projectName,
    projectTitle: titleFromName(projectName),
    framework,
    palette,
    appearance,
    store,
    bootstrapUrl: flags.bootstrapUrl ?? DEFAULT_BOOTSTRAP_URL,
    routes: {
      checkout: chosenRoutes.includes('checkout'),
      orders: chosenRoutes.includes('orders'),
    },
    packageManager,
    dtUiVersion: DT_UI_VERSION,
  };

  await mkdir(directory, { recursive: true });
  const result = await p.spin('Writing the project', () => scaffold(plan));
  p.success(`${result.written.length} files in ${projectName}/`);
  for (const skipped of result.skipped) p.note(`omitted ${skipped} — the store cannot serve it`);

  // ---- 8. install and run -------------------------------------------------
  const commands = RUN_COMMAND[packageManager];
  const shouldInstall = flags.install ?? (flags.yes ? true : await p.confirm({ message: `Run ${commands.install} now?` }));

  if (shouldInstall) {
    const code = await run(commands.install, directory);
    if (code !== 0) fail(`${commands.install} failed.`, `Fix the problem and run it again in ${projectName}/.`);
    p.success('Dependencies installed.');
  }

  const shouldStart =
    shouldInstall && (flags.start ?? (flags.yes ? false : await p.confirm({ message: 'Start the dev server?' })));

  process.stdout.write('\n');
  if (shouldStart) {
    process.stdout.write(`${p.c.grey('Starting the dev server. Press Ctrl+C to stop.')}\n\n`);
    await run(commands.dev, directory);
    return;
  }

  process.stdout.write(`${p.c.bold('Next:')}\n`);
  process.stdout.write(`  cd ${projectName}\n`);
  if (!shouldInstall) process.stdout.write(`  ${commands.install}\n`);
  process.stdout.write(`  ${commands.dev}\n\n`);
}

function run(command: string, cwd: string): Promise<number> {
  const [bin, ...args] = command.split(' ');
  return new Promise((resolveRun) => {
    const child = spawn(bin!, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolveRun(code ?? 1));
    child.on('error', () => resolveRun(1));
  });
}
