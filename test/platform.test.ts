/**
 * The platform client, against a stubbed registry rather than the live one.
 *
 * The live API is exercised end to end by the Playwright suite. What matters
 * here is the logic that decides what the CLI DOES with an answer — especially
 * the refusals, which are the paths a developer actually meets when something is
 * wrong and which a happy-path test never reaches.
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlatformError,
  describeCapabilities,
  fetchStoreConfig,
  looksLikeStoreId,
} from '../dist/lib/platform.js';

const VALID = '01f5b02f-d7c0-42cd-b880-59f78ea70aa3';

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

afterEach(() => mock.restoreAll());

describe('store id shape', () => {
  test('accepts a uuid in any case, with surrounding space', () => {
    assert.ok(looksLikeStoreId(VALID));
    assert.ok(looksLikeStoreId(VALID.toUpperCase()));
    assert.ok(looksLikeStoreId(`  ${VALID}  `));
  });

  test('rejects the things people paste by mistake', () => {
    for (const value of ['', 'not-a-uuid', 'pk_test_abc', VALID.slice(0, -1), `${VALID}x`]) {
      assert.ok(!looksLikeStoreId(value), value);
    }
  });
});

describe('bootstrap', () => {
  test('returns the runtime configuration the project needs', async () => {
    stub(200, {
      data: {
        storeId: VALID,
        apiUrl: 'https://api.1ecomm.com/',
        publishableKey: 'pk_test_abc',
        apiVersion: 'v1',
        capabilities: ['catalog', 'cart'],
      },
    });
    const config = await fetchStoreConfig(VALID);
    assert.equal(config.storeId, VALID);
    // A trailing slash would produce '//v1/headless/...' in every request.
    assert.equal(config.apiUrl, 'https://api.1ecomm.com');
    assert.deepEqual(config.capabilities, ['catalog', 'cart']);
  });

  test('a 404 becomes advice, not just a status', async () => {
    stub(404, { detail: 'Headless store is not configured', code: 'HEADLESS_HTTP_404' });
    await assert.rejects(
      () => fetchStoreConfig(VALID),
      (error: PlatformError) => {
        assert.equal(error.status, 404);
        assert.match(error.message, /not configured/);
        assert.match(error.hint ?? '', /ACTIVE application/);
        return true;
      },
    );
  });

  test('REFUSES a bootstrap that answers for a different store', async () => {
    // Otherwise the project is silently wired to someone else's catalog.
    stub(200, {
      data: {
        storeId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        apiUrl: 'https://api.1ecomm.com',
        publishableKey: 'pk_test_abc',
        apiVersion: 'v1',
        capabilities: [],
      },
    });
    await assert.rejects(() => fetchStoreConfig(VALID), /mismatched store|returned store/);
  });

  test('refuses a response missing the fields the project depends on', async () => {
    stub(200, { data: { storeId: VALID, apiVersion: 'v1' } });
    await assert.rejects(() => fetchStoreConfig(VALID), /missing storeId, apiUrl or publishableKey/);
  });

  test('a server error is named as the platform side, not the developer', async () => {
    stub(503, { detail: 'upstream unavailable' });
    await assert.rejects(
      () => fetchStoreConfig(VALID),
      (error: PlatformError) => {
        assert.match(error.hint ?? '', /not your configuration/i);
        return true;
      },
    );
  });
});

describe('capabilities', () => {
  test('a catalog-only store can browse and nothing else', () => {
    const report = describeCapabilities(['catalog']);
    assert.deepEqual(report, {
      canBrowse: true,
      canCart: false,
      canCheckout: false,
      canOrder: false,
      canAccounts: false,
    });
  });

  test('checkout-preparation does NOT imply the store can place an order', () => {
    // The distinction the whole route-gating rests on.
    const report = describeCapabilities(['catalog', 'cart', 'checkout-preparation']);
    assert.equal(report.canCheckout, true);
    assert.equal(report.canOrder, false);
  });

  test('a fully capable store reports everything', () => {
    const report = describeCapabilities(['catalog', 'cart', 'checkout-preparation', 'orders', 'customers']);
    assert.equal(report.canOrder, true);
    assert.equal(report.canAccounts, true);
  });
});
