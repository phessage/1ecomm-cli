/**
 * The CLI as a developer meets it: a process, with arguments and an exit code.
 *
 * Everything else in this directory tests functions. This file tests the
 * program — which is where a whole class of defect lives that unit tests cannot
 * see: a flag that parses but is never passed on, an error that prints but exits
 * zero, a refusal that leaves half a project behind.
 *
 * Exit codes are asserted everywhere. A CLI that prints an error and exits 0 is
 * a CLI that cannot be used in a script, and that is how a broken scaffold gets
 * deployed by CI.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const STORE_ID = process.env['E2E_STORE_ID'] || '01f5b02f-d7c0-42cd-b880-59f78ea70aa3';
const UNPROVISIONED = '00000000-0000-0000-0000-000000000000';

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  all: string;
}

/**
 * Run the CLI with a closed stdin.
 *
 * Closed on purpose: it is not a TTY, so any prompt the CLI tries to ask must
 * refuse rather than hang. A test suite that hangs on a missing flag is worse
 * than one that fails.
 */
function run(args: string[], cwd: string, timeoutMs = 60_000): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`\`1ecomm ${args.join(' ')}\` did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, all: stdout + stderr });
    });
  });
}

let workspace: string;
before(async () => {
  assert.ok(existsSync(CLI), 'Build first: `npm run build`.');
  workspace = await mkdtemp(join(tmpdir(), '1ecomm-cli-test-'));
});
after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe('help and version', () => {
  test('bare invocation prints usage and exits 0', async () => {
    const result = await run([], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /1ecomm init/);
    assert.match(result.stdout, /1ecomm doctor/);
  });

  test('usage names every init flag, so the prompts are all scriptable', async () => {
    const { stdout } = await run(['--help'], workspace);
    for (const flag of [
      '--store-id',
      '--framework',
      '--palette',
      '--appearance',
      '--package-manager',
      '--bootstrap-url',
      '--install',
      '--start',
      '--yes',
    ]) {
      assert.match(stdout, new RegExp(flag.replace(/-/g, '\\-')), `usage omits ${flag}`);
    }
  });

  test('usage states that no API key is needed', async () => {
    // The single most common wrong assumption about this CLI.
    const { stdout } = await run(['--help'], workspace);
    assert.match(stdout, /no API key|key to paste/i);
  });

  test('--version prints a version and nothing else', async () => {
    const { code, stdout } = await run(['--version'], workspace);
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  test('an unknown command fails, and says so', async () => {
    const result = await run(['frobnicate'], workspace);
    assert.equal(result.code, 1);
    assert.match(result.all, /unknown command/i);
  });
});

describe('init refuses bad input before writing anything', () => {
  test('an unprovisioned store is refused, with advice', async () => {
    const dir = join(workspace, 'unprovisioned');
    const result = await run(
      ['init', dir, '--store-id', UNPROVISIONED, '--framework', 'react', '-y', '--no-install'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /not configured/i);
    assert.match(result.all, /ACTIVE application/i, 'the error must say what to do next');
    assert.ok(!existsSync(dir), 'a refused init must leave nothing behind');
  });

  test('an unknown framework is refused and lists the ones that work', async () => {
    const result = await run(
      ['init', join(workspace, 'a'), '--store-id', STORE_ID, '--framework', 'svelte', '-y'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /svelte/);
    assert.match(result.all, /react/, 'the error must name a framework that does work');
  });

  test('an unbuilt framework is refused as unbuilt, not as unknown', async () => {
    // Two different problems; telling them apart is the difference between
    // "try again later" and "you typed it wrong".
    const result = await run(
      ['init', join(workspace, 'b'), '--store-id', STORE_ID, '--framework', 'angular', '-y'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /not available yet/i);
    assert.match(result.all, /Ready today/i);
  });

  test('an unknown palette is refused and the valid ones are listed', async () => {
    const result = await run(
      ['init', join(workspace, 'c'), '--store-id', STORE_ID, '--palette', 'chartreuse', '-y'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /chartreuse/);
    assert.match(result.all, /indigo/, 'the error must list real palettes');
  });

  test('an unknown appearance is refused', async () => {
    const result = await run(
      ['init', join(workspace, 'd'), '--store-id', STORE_ID, '--appearance', 'sepia', '-y'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /light, dark or system/i);
  });

  test('a non-empty directory is refused rather than merged into', async () => {
    const dir = join(workspace, 'occupied');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'important.txt'), 'do not clobber me');

    const result = await run(
      ['init', dir, '--store-id', STORE_ID, '--framework', 'react', '-y', '--no-install'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /not empty/i);
    assert.equal(await readFile(join(dir, 'important.txt'), 'utf8'), 'do not clobber me');
  });

  test('an invalid project name is refused', async () => {
    const result = await run(
      ['init', join(workspace, 'Not A Package'), '--store-id', STORE_ID, '-y', '--no-install'],
      workspace,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /lowercase/i);
  });

  test('an unreachable platform fails with a network message, not a store message', async () => {
    const result = await run(
      [
        'init', join(workspace, 'offline'),
        '--store-id', STORE_ID,
        '--bootstrap-url', 'http://127.0.0.1:1',
        '-y', '--no-install',
      ],
      workspace,
      45_000,
    );
    assert.equal(result.code, 1);
    assert.match(result.all, /could not reach|did not answer/i);
  });
});

describe('init without a TTY', () => {
  test('refuses to prompt rather than hanging', async () => {
    // No --store-id and no TTY. The alternative is a CI job that waits forever.
    const result = await run(['init', join(workspace, 'e')], workspace, 30_000);
    assert.equal(result.code, 1);
    assert.match(result.all, /not an interactive terminal/i);
    assert.match(result.all, /flag/i, 'the refusal must point at the way out');
  });
});

describe('init writes what it was asked for', () => {
  test('flags land in the generated project, and no key is written', async () => {
    const dir = join(workspace, 'flagged');
    const result = await run(
      [
        'init', dir,
        '--store-id', STORE_ID,
        '--framework', 'react',
        '--palette', 'orchid',
        '--appearance', 'dark',
        '--package-manager', 'pnpm',
        '-y', '--no-install',
      ],
      workspace,
    );
    assert.equal(result.code, 0, result.all);

    const html = await readFile(join(dir, 'index.html'), 'utf8');
    assert.match(html, /data-dt-palette="orchid"/);
    assert.match(html, /data-dt-theme="dark"/);

    const config = JSON.parse(await readFile(join(dir, 'headless-config.json'), 'utf8'));
    assert.equal(config.storeId, STORE_ID);
    assert.deepEqual(Object.keys(config).sort(), ['bootstrapUrl', 'storeId']);

    // The chosen package manager must reach the printed next steps, or the
    // developer is told to run the wrong command.
    assert.match(result.stdout, /pnpm/);

    for (const file of await readdir(dir, { recursive: true })) {
      const path = join(dir, String(file));
      if (!existsSync(path) || (await readFile(path).catch(() => null)) === null) continue;
      const text = await readFile(path, 'utf8').catch(() => '');
      assert.ok(!/pk_(test|live)_/.test(text), `${file} contains a publishable key`);
    }
  });

  test('the reported capabilities match what the platform says', async () => {
    const dir = join(workspace, 'caps');
    const result = await run(
      ['init', dir, '--store-id', STORE_ID, '--framework', 'react', '-y', '--no-install'],
      workspace,
    );
    assert.equal(result.code, 0, result.all);
    assert.match(result.stdout, /catalog/);

    const res = await fetch(`https://api.1ecomm.com/v1/headless/stores/${STORE_ID}/config`);
    const { data } = (await res.json()) as { data: { capabilities: string[] } };

    // A route is scaffolded only when the store can serve it, and the omission
    // is printed rather than silent.
    const hasOrders = data.capabilities.includes('orders');
    assert.equal(existsSync(join(dir, 'src/routes/OrderLookup.tsx')), hasOrders);
    if (!hasOrders) assert.match(result.stdout, /omitted .*OrderLookup/);

    const hasCheckout = data.capabilities.includes('checkout-preparation');
    assert.equal(existsSync(join(dir, 'src/routes/Checkout.tsx')), hasCheckout);
  });

  test('vue produces a vue project, not a react one', async () => {
    const dir = join(workspace, 'vueish');
    const result = await run(
      ['init', dir, '--store-id', STORE_ID, '--framework', 'vue', '-y', '--no-install'],
      workspace,
    );
    assert.equal(result.code, 0, result.all);
    assert.ok(existsSync(join(dir, 'src/App.vue')));
    assert.ok(!existsSync(join(dir, 'src/App.tsx')));
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['@1ecomm/dt-ui-vue']);
    assert.ok(!pkg.dependencies['@1ecomm/dt-ui-react']);
  });
});

describe('doctor', () => {
  test('reports green on a healthy project and exits 0', async () => {
    const dir = join(workspace, 'healthy');
    await run(['init', dir, '--store-id', STORE_ID, '-y', '--no-install'], workspace);

    const result = await run(['doctor', dir], workspace);
    assert.equal(result.code, 0, result.all);
    assert.match(result.stdout, /configuration found/);
    assert.match(result.stdout, /store resolves/);
    assert.match(result.stdout, /capabilities/);
    assert.match(result.stdout, /catalog read/);
  });

  test('fails with a reason where there is no project', async () => {
    const result = await run(['doctor', workspace], workspace);
    assert.equal(result.code, 1);
    assert.match(result.all, /No headless-config\.json/);
  });

  test('fails when the store stops resolving, and says what to check', async () => {
    const dir = join(workspace, 'broken');
    await run(['init', dir, '--store-id', STORE_ID, '-y', '--no-install'], workspace);
    await writeFile(
      join(dir, 'headless-config.json'),
      JSON.stringify({ storeId: UNPROVISIONED, bootstrapUrl: 'https://api.1ecomm.com' }),
    );

    const result = await run(['doctor', dir], workspace);
    assert.equal(result.code, 1);
    assert.match(result.all, /store bootstrap/);
    assert.match(result.all, /ACTIVE application/i);
  });

  test('warns rather than fails when the store id is not a uuid', async () => {
    const dir = join(workspace, 'malformed');
    await run(['init', dir, '--store-id', STORE_ID, '-y', '--no-install'], workspace);
    await writeFile(
      join(dir, 'headless-config.json'),
      JSON.stringify({ storeId: 'not-a-uuid', bootstrapUrl: 'https://api.1ecomm.com' }),
    );

    const result = await run(['doctor', dir], workspace);
    assert.equal(result.code, 1, 'it still cannot resolve, so it still fails');
    assert.match(result.all, /not a UUID/i, 'but the shape problem is named first');
  });

  test('run with no argument, it checks the current directory', async () => {
    const dir = join(workspace, 'cwd-check');
    await run(['init', dir, '--store-id', STORE_ID, '-y', '--no-install'], workspace);
    const result = await run(['doctor'], dir);
    assert.equal(result.code, 0, result.all);
  });
});
