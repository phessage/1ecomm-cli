/**
 * Build every matrix entry, for real, before any spec runs.
 *
 * Each entry is scaffolded by the CLI exactly as a developer would, installed
 * from the registry, and built. Nothing is mocked and nothing is linked: if
 * `@1ecomm/dt-ui-react` does not install and compile in a clean project, this
 * setup fails — which is precisely the defect that shipped in 0.1.0 and that
 * every in-repo gate was blind to.
 *
 * Two rules this file exists to hold:
 *
 *   1. **A missing prerequisite THROWS.** It never skips. A skipped suite exits
 *      zero and reports green having proved nothing.
 *   2. **Ports are allocated, never hard-coded.** A fixed port is a collision
 *      waiting for a neighbour on a shared runner, and the failure reads as a
 *      broken app rather than a busy machine.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX, STORE_ID, BOOTSTRAP_URL, type MatrixEntry } from './matrix.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, '..');

export interface BuiltProject extends MatrixEntry {
  directory: string;
  port: number;
  baseURL: string;
}

export interface Manifest {
  workspace: string;
  projects: BuiltProject[];
}

export const MANIFEST_PATH = join(tmpdir(), '1ecomm-e2e-manifest.json');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        return reject(new Error('Could not allocate a port.'));
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function run(command: string, args: string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      // The whole output, not a summary. A build that fails here is the finding.
      reject(new Error(`${label} failed (exit ${code}).\n${output}`));
    });
  });
}

/** Wait until a server answers, rather than sleeping and hoping. */
async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${url} did not come up within ${timeoutMs / 1000}s.`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function preflight(): Promise<void> {
  // The suite drives a real platform. If it is unreachable, say so in one
  // sentence rather than letting 40 specs fail with timeouts that look like
  // application bugs.
  const url = `${BOOTSTRAP_URL}/v1/headless/stores/${STORE_ID}/config`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    throw new Error(
      `Cannot reach the platform at ${BOOTSTRAP_URL}. This suite runs against a live store and has no offline mode.\n` +
        `Set E2E_BOOTSTRAP_URL / E2E_STORE_ID to point elsewhere.\nCause: ${String(cause)}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Store ${STORE_ID} did not resolve (HTTP ${res.status}) at ${url}.\n` +
        `Set E2E_STORE_ID to a provisioned store, or lease one with POST /operations/headless/e2e-fixtures/allocate.`,
    );
  }
  const body = (await res.json()) as { data?: { capabilities?: string[] } };
  const capabilities = body.data?.capabilities ?? [];
  if (!capabilities.includes('catalog')) {
    throw new Error(
      `Store ${STORE_ID} has no catalog capability (${capabilities.join(', ') || 'none'}), so there is nothing to test.`,
    );
  }
  process.stdout.write(`\n  platform ok · store ${STORE_ID.slice(0, 8)}… · ${capabilities.join(', ')}\n`);
}

export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(cliRoot, 'dist', 'cli.js'))) {
    throw new Error('Build the CLI first: `npm run build`. The suite drives dist/cli.js, not the sources.');
  }

  await preflight();

  const workspace = await mkdtemp(join(tmpdir(), '1ecomm-e2e-'));
  const projects: BuiltProject[] = [];

  for (const entry of MATRIX) {
    const started = Date.now();
    process.stdout.write(`  ${entry.id}: scaffolding…`);

    await run(
      process.execPath,
      [
        join(cliRoot, 'dist', 'cli.js'),
        'init',
        entry.id,
        '--store-id', STORE_ID,
        '--bootstrap-url', BOOTSTRAP_URL,
        '--framework', entry.framework,
        '--palette', entry.palette,
        '--appearance', entry.appearance,
        '-y', '--install', '--no-start',
      ],
      workspace,
      `${entry.id} scaffold+install`,
    );

    const directory = join(workspace, entry.id);
    process.stdout.write(' building…');
    await run('npm', ['run', 'build'], directory, `${entry.id} build`);

    const port = await freePort();
    const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
      cwd: directory,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    const baseURL = `http://localhost:${port}`;
    await waitForServer(baseURL);

    projects.push({ ...entry, directory, port, baseURL });
    process.stdout.write(` ready on ${port} (${Math.round((Date.now() - started) / 1000)}s)\n`);
  }

  const manifest: Manifest = { workspace, projects };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  process.stdout.write(`\n  ${projects.length} projects built and served.\n\n`);
}

/** Torn down by global-teardown; exported so it can be reused. */
export async function cleanup(): Promise<void> {
  if (!existsSync(MANIFEST_PATH)) return;
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(MANIFEST_PATH, 'utf8')) as Manifest;
  for (const project of manifest.projects) {
    // The preview servers were detached, so they are killed by port rather than
    // by a handle this process no longer holds.
    try {
      const { execSync } = await import('node:child_process');
      execSync(`lsof -ti tcp:${project.port} | xargs kill -9`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  if (process.env['E2E_KEEP_WORKSPACE'] !== '1') {
    await rm(manifest.workspace, { recursive: true, force: true });
  }
  await rm(MANIFEST_PATH, { force: true });
}
