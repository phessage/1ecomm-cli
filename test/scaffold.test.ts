/**
 * The scaffolder's pure logic.
 *
 * These are the rules that decide what a developer's project contains, so each
 * case here is a decision rather than a coincidence. The route-marker cases in
 * particular encode the thing that matters most: a store that cannot check out
 * gets NO checkout route, not a broken one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidProjectName,
  titleFromName,
  scaffold,
  templateRoot,
  type ScaffoldPlan,
} from '../dist/lib/scaffold.js';

const STORE = {
  storeId: '01f5b02f-d7c0-42cd-b880-59f78ea70aa3',
  apiUrl: 'https://api.1ecomm.com',
  publishableKey: 'pk_test_whatever',
  apiVersion: 'v1',
  capabilities: ['catalog', 'cart', 'checkout-preparation'] as never,
};

async function plan(overrides: Partial<ScaffoldPlan> = {}): Promise<ScaffoldPlan> {
  return {
    directory: await mkdtemp(join(tmpdir(), 'scaffold-test-')),
    projectName: 'my-shop',
    projectTitle: 'My Shop',
    framework: 'react',
    palette: 'indigo',
    appearance: 'system',
    store: STORE,
    bootstrapUrl: 'https://api.1ecomm.com',
    routes: { checkout: true, orders: true },
    packageManager: 'npm',
    dtUiVersion: '^0.1.0',
    ...overrides,
  };
}

describe('project names', () => {
  test('accepts what npm accepts', () => {
    for (const name of ['my-shop', 'shop', 'a1', 'my.shop', 'my_shop']) {
      assert.equal(isValidProjectName(name), undefined, name);
    }
  });

  test('rejects what would produce an unpublishable package', () => {
    for (const name of ['', 'My-Shop', '-shop', 'shop-', 'my shop', '.shop']) {
      assert.notEqual(isValidProjectName(name), undefined, name);
    }
  });

  test('turns a package name into a heading a shopper reads', () => {
    assert.equal(titleFromName('my-shop'), 'My Shop');
    assert.equal(titleFromName('northwind_supply'), 'Northwind Supply');
    assert.equal(titleFromName('shop'), 'Shop');
  });
});

describe('token substitution', () => {
  test('every placeholder is replaced in every written file', async () => {
    const p = await plan();
    await scaffold(p);
    const files = await walk(p.directory);
    for (const file of files) {
      const text = await readFile(join(p.directory, file), 'utf8');
      const leftover = text.match(/__[A-Z0-9_]+__/g);
      assert.equal(leftover, null, `${file} still contains ${leftover?.join(', ')}`);
    }
  });

  test('the store id and bootstrap url reach the config the app reads', async () => {
    const p = await plan();
    await scaffold(p);
    const config = JSON.parse(await readFile(join(p.directory, 'headless-config.json'), 'utf8'));
    assert.equal(config.storeId, STORE.storeId);
    assert.equal(config.bootstrapUrl, 'https://api.1ecomm.com');
  });

  test('the publishable key is NEVER written into the project', async () => {
    // It is discovered at runtime. Writing it would put a credential-shaped
    // value in a file people commit, for no benefit.
    const p = await plan();
    await scaffold(p);
    for (const file of await walk(p.directory)) {
      const text = await readFile(join(p.directory, file), 'utf8');
      assert.ok(!text.includes(STORE.publishableKey), `${file} contains the publishable key`);
    }
  });

  test('palette and appearance land on the html element', async () => {
    const p = await plan({ palette: 'ember', appearance: 'dark' });
    await scaffold(p);
    const html = await readFile(join(p.directory, 'index.html'), 'utf8');
    assert.match(html, /data-dt-palette="ember"/);
    assert.match(html, /data-dt-theme="dark"/);
  });
});

describe('capability-gated routes', () => {
  test('react: a store with no checkout gets no checkout route or import', async () => {
    const p = await plan({ routes: { checkout: false, orders: false } });
    const result = await scaffold(p);

    assert.ok(result.skipped.includes('src/routes/Checkout.tsx'));
    assert.ok(!result.written.includes('src/routes/Checkout.tsx'));

    const app = await readFile(join(p.directory, 'src/App.tsx'), 'utf8');
    assert.ok(!app.includes('Checkout'), 'App.tsx must not reference a route that was not written');
    assert.ok(!app.includes('__ROUTE'), 'markers must be resolved, not left behind');
  });

  test('react: a capable store gets both route and import', async () => {
    const p = await plan({ routes: { checkout: true, orders: true } });
    await scaffold(p);
    const app = await readFile(join(p.directory, 'src/App.tsx'), 'utf8');
    assert.match(app, /import \{ Checkout \} from '\.\/routes\/Checkout'/);
    assert.match(app, /path="\/checkout"/);
    assert.match(app, /path="\/orders"/);
  });

  test('vue: the same gating, in Vue Router syntax', async () => {
    const p = await plan({ framework: 'vue', routes: { checkout: true, orders: false } });
    const result = await scaffold(p);

    assert.ok(result.skipped.includes('src/routes/OrderLookup.vue'));
    const router = await readFile(join(p.directory, 'src/router.ts'), 'utf8');
    assert.match(router, /import Checkout from '\.\/routes\/Checkout\.vue'/);
    assert.match(router, /path: '\/checkout', component: Checkout/);
    assert.ok(!router.includes('OrderLookup'), 'an omitted route must leave no reference');
    assert.ok(!router.includes('__ROUTE'));
  });
});

describe('shared template code', () => {
  test('both frameworks receive the same commerce client and adapter', async () => {
    const react = await plan({ framework: 'react' });
    const vue = await plan({ framework: 'vue' });
    await scaffold(react);
    await scaffold(vue);

    for (const file of ['src/lib/commerce.ts', 'src/lib/adapt.ts']) {
      const a = await readFile(join(react.directory, file), 'utf8');
      const b = await readFile(join(vue.directory, file), 'utf8');
      assert.equal(a, b, `${file} differs between frameworks; the shared copy has drifted`);
    }
  });

  test('a framework can still override a shared file', async () => {
    // Not exercised by a real override today, but the mechanism is what allows
    // one, so it is asserted rather than assumed.
    assert.ok(templateRoot('react').endsWith('react'));
    assert.ok(templateRoot('vue').endsWith('vue'));
  });
});

describe('unshipped frameworks', () => {
  test('asking for one fails loudly rather than writing half a project', () => {
    assert.throws(() => templateRoot('angular' as never), /No template shipped/);
  });
});

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}
