/**
 * Turn answers into a project on disk.
 *
 * Templates are real files under templates/<framework>/, not strings in here, so
 * they can be type-checked and linted like the code they become. Two mechanisms
 * shape them:
 *
 *   - `__TOKEN__` substitution, for values (store ID, palette, project name);
 *   - marker comments, for whole routes a store's capabilities do not permit.
 *
 * The second matters more than it looks. A catalog-only store must get a project
 * with NO checkout route, rather than a checkout route that is reachable and
 * always fails.
 */
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoreConfig } from './platform.js';

export type Framework = 'react' | 'nextjs' | 'vue' | 'angular';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ScaffoldPlan {
  directory: string;
  projectName: string;
  projectTitle: string;
  framework: Framework;
  palette: string;
  appearance: 'light' | 'dark' | 'system';
  store: StoreConfig;
  bootstrapUrl: string;
  routes: { checkout: boolean; orders: boolean };
  packageManager: PackageManager;
  dtUiVersion: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/** templates/ sits beside dist/ in the published package and beside src/ in the repo. */
function templatesDir(): string {
  for (const candidate of [join(here, '..', '..', 'templates'), join(here, '..', 'templates')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('The templates directory is missing from this installation.');
}

export function templateRoot(framework: Framework): string {
  const root = join(templatesDir(), framework);
  if (!existsSync(root)) throw new Error(`No template shipped for "${framework}".`);
  return root;
}

/**
 * Framework-free code every template gets: the commerce client and the dt-ui
 * adapter. Kept in one place rather than copied per framework, because two
 * copies of a client that must agree with one API is how they stop agreeing —
 * and the traps encoded in them (variant gating, the string-to-number price
 * conversion) are exactly the things nobody re-derives correctly the second
 * time.
 */
export function sharedRoot(): string {
  return join(templatesDir(), '_shared');
}

export function isValidProjectName(name: string): string | undefined {
  if (!name) return 'Give the project a name.';
  if (name.length > 214) return 'That name is too long for a package name.';
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(name)) {
    return 'Use lowercase letters, digits, dashes, dots or underscores, starting and ending with a letter or digit.';
  }
  return undefined;
}

/** Title Case from a package name, for headings a shopper reads. */
export function titleFromName(name: string): string {
  return name
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function substitute(source: string, plan: ScaffoldPlan): string {
  const values: Record<string, string> = {
    __PROJECT_NAME__: plan.projectName,
    __PROJECT_TITLE__: plan.projectTitle,
    __STORE_ID__: plan.store.storeId,
    __BOOTSTRAP_URL__: plan.bootstrapUrl,
    __PALETTE__: plan.palette,
    __APPEARANCE__: plan.appearance,
    __DTUI_VERSION__: plan.dtUiVersion,
    __API_URL__: plan.store.apiUrl,
    __API_VERSION__: plan.store.apiVersion,
  };
  return source.replace(/__[A-Z0-9_]+__/g, (token) => values[token] ?? token);
}

/**
 * What each route marker expands to, per framework.
 *
 * Markers are comments, so an unresolved template still parses and can be
 * type-checked in place. When a route is included the marker becomes real code;
 * when it is excluded the marker becomes nothing, and the route file is never
 * copied at all.
 *
 * The expansions differ by framework because the syntax does, but the MARKER
 * NAMES do not — so adding a framework means adding a column here, not a new
 * mechanism.
 */
const MARKERS: Record<Framework, Record<string, { checkout: string; orders: string }>> = {
  react: {
    __ROUTE_IMPORT_CHECKOUT__: { checkout: "import { Checkout } from './routes/Checkout';", orders: '' },
    __ROUTE_IMPORT_ORDERS__: { checkout: '', orders: "import { OrderLookup } from './routes/OrderLookup';" },
    __ROUTE_CHECKOUT__: { checkout: '<Route path="/checkout" element={<Checkout />} />', orders: '' },
    __ROUTE_ORDERS__: { checkout: '', orders: '<Route path="/orders" element={<OrderLookup />} />' },
    __NAV_ORDERS__: { checkout: '', orders: "{ to: '/orders', label: 'Order status' }," },
  },
  vue: {
    __ROUTE_IMPORT_CHECKOUT__: { checkout: "import Checkout from './routes/Checkout.vue';", orders: '' },
    __ROUTE_IMPORT_ORDERS__: { checkout: '', orders: "import OrderLookup from './routes/OrderLookup.vue';" },
    __ROUTE_CHECKOUT__: { checkout: "{ path: '/checkout', component: Checkout },", orders: '' },
    __ROUTE_ORDERS__: { checkout: '', orders: "{ path: '/orders', component: OrderLookup }," },
    __NAV_ORDERS__: { checkout: '', orders: "{ to: '/orders', label: 'Order status' }," },
  },
  nextjs: {},
  angular: {},
};

function resolveMarkers(source: string, plan: ScaffoldPlan): string {
  const table = MARKERS[plan.framework];
  let out = source;

  for (const [name, expansion] of Object.entries(table)) {
    const value =
      (plan.routes.checkout ? expansion.checkout : '') + (plan.routes.orders ? expansion.orders : '');
    // Both comment forms: a bare block comment, and a JSX-wrapped one.
    out = out
      .replace(new RegExp(`\\{/\\* ${name} \\*/\\}`, 'g'), value)
      .replace(new RegExp(`/\\* ${name} \\*/`, 'g'), value);
  }

  // Collapse the blank lines an excluded marker leaves behind.
  return out.replace(/^[ \t]*\n(?=[ \t]*\n)/gm, '');
}

/** Route files that must not be written when the store cannot serve them. */
function excludedFiles(plan: ScaffoldPlan): Set<string> {
  const extension = plan.framework === 'vue' ? 'vue' : 'tsx';
  const excluded = new Set<string>();
  if (!plan.routes.checkout) excluded.add(`src/routes/Checkout.${extension}`);
  if (!plan.routes.orders) excluded.add(`src/routes/OrderLookup.${extension}`);
  return excluded;
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml',
  '.gitignore', '.tmpl',
]);

function isText(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? false : TEXT_EXTENSIONS.has(path.slice(dot));
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(relative(base, full));
  }
  return files;
}

/**
 * Where a template file lands.
 *
 * `.tmpl` exists so a template's own package.json is not picked up by the CLI's
 * workspace tooling or its linter. The suffix is dropped on the way out.
 */
function targetPath(rel: string): string {
  return rel.endsWith('.tmpl') ? rel.slice(0, -'.tmpl'.length) : rel;
}

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

export async function scaffold(plan: ScaffoldPlan): Promise<ScaffoldResult> {
  const root = templateRoot(plan.framework);
  const shared = sharedRoot();
  const excluded = excludedFiles(plan);
  const written: string[] = [];
  const skipped: string[] = [];

  // Shared first, then the framework's own files, and a later entry at the same
  // target path REPLACES an earlier one. That is what lets a framework template
  // deliberately override a shared file, and it means each path is written
  // exactly once rather than twice with the loser landing last by accident.
  const sources = new Map<string, { base: string; rel: string }>();
  for (const base of [...(existsSync(shared) ? [shared] : []), root]) {
    for (const rel of await walk(base)) {
      sources.set(targetPath(rel), { base, rel });
    }
  }

  for (const { base, rel } of sources.values()) {
    const target = targetPath(rel);

    if (excluded.has(target)) {
      skipped.push(target);
      continue;
    }

    const destination = join(plan.directory, target);
    await mkdir(dirname(destination), { recursive: true });

    if (isText(rel)) {
      const source = await readFile(join(base, rel), 'utf8');
      await writeFile(destination, resolveMarkers(substitute(source, plan), plan));
    } else {
      await cp(join(base, rel), destination);
    }
    written.push(target);
  }

  // npm refuses to include a file literally named .gitignore in a package, so
  // templates carry it as `gitignore` and it is restored here.
  const dotless = join(plan.directory, 'gitignore');
  if (existsSync(dotless)) {
    await rename(dotless, join(plan.directory, '.gitignore'));
    written[written.indexOf('gitignore')] = '.gitignore';
  }

  return { written, skipped };
}

export const RUN_COMMAND: Record<PackageManager, { install: string; dev: string }> = {
  npm: { install: 'npm install', dev: 'npm run dev' },
  pnpm: { install: 'pnpm install', dev: 'pnpm dev' },
  yarn: { install: 'yarn', dev: 'yarn dev' },
  bun: { install: 'bun install', dev: 'bun run dev' },
};
