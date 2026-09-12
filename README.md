# `1ecomm`

One command from a store ID to a themed storefront running against the live
1Ecomm commerce API.

```sh
npm create @1ecomm/storefront@latest my-shop
# or
npx @1ecomm/cli init my-shop
```

## What it does

```
*  Store ID
|  01f5b02f-…                    <- validated against the platform before the next question
|  OK Store 01f5b02f… on api.1ecomm.com · catalog, cart, checkout-preparation
|  OK Catalog reachable, with published products.
*  Framework          React (Next.js, Vue, Angular coming)
*  Colour             24 dt-ui palettes, drawn as live swatches
*  Appearance         Light · Dark · Follow the system
*  Optional routes    Checkout · Order lookup   (only those the store can serve)
*  Package manager    npm · pnpm · yarn · bun
```

Then it installs and starts the app, and you have a shop.

## There is no token to paste

The store ID is the only thing you supply. The publishable key, the API URL and
the store's capability list all come back from the platform's bootstrap call, so
`headless-config.json` holds a store ID and nothing else. No secret ever reaches
the generated project.

## The store ID is checked first, on purpose

It is the first question, and it is validated against the live platform before
the second question is asked. A wrong ID costs one prompt rather than a project
that installs, builds, and only then fails at runtime.

The CLI then makes one authenticated catalog read, because the capability list
says what is *permitted* and only a real call says what *works*.

## Routes follow the store's capabilities

A catalog-only store is scaffolded with **no checkout route**, rather than one
that is reachable and always fails. The same applies to order lookup, which
needs the `orders` capability.

## Commands

| | |
|---|---|
| `1ecomm init [dir]` | scaffold a storefront and connect it to a store |
| `1ecomm doctor [dir]` | check an existing project against the live platform |

Every prompt has a flag, so the whole thing is scriptable:

```sh
1ecomm init my-shop \
  --store-id 01f5b02f-d7c0-42cd-b880-59f78ea70aa3 \
  --framework react --palette jade --appearance system \
  --package-manager npm -y --install --no-start
```

## What the generated project contains

Real commerce, not a catalog mock:

- **Home** — hero, category tiles, product grid, incentives, FAQ, newsletter
- **Category** — listing with category filters
- **Product** — images, price, and the **option matrix**
- **Cart** — line items, quantities, live totals
- **Checkout** — address, delivery and payment selection, driven by the
  platform's own country rules and payment capabilities
- **Order lookup** — guest order status

Presentation is [dt-ui](https://github.com/phessage/dt-ui): 37 components, 149
templates, 24 palettes crossed with light/dark/system. The shell — header,
footer, hero — is composed in the project from dt-ui primitives and its semantic
tokens, so it repalettes with everything else and you can edit it freely.

### The variant trap, handled

The platform rejects an add-to-cart that omits `variantId` for a product that
has variants — HTTP 400, "Cart mutation could not be completed", which tells a
shopper nothing. The generated product page resolves variants first, says which
choice is still outstanding, greys out combinations that do not exist, and
enables the button only when the selection maps to a variant in stock.

## `1ecomm doctor`

Run it in a project that has stopped working:

```
1ecomm doctor
  ok    configuration found (headless-config.json)
  ok    store resolves at api.1ecomm.com (API v1)
  ok    capabilities: catalog, cart, checkout-preparation
  ok    catalog read (1 product returned)
  warn  checkout route present but the store lost checkout capability
```

It catches the failure the CLI cannot prevent: capabilities revoked *after*
scaffolding, which produces a runtime error with no obvious cause.

## Tests

```sh
npm run test        # 62 unit tests — scaffolder, platform client, adapter, and the CLI as a process
npm run test:e2e    # 211 browser tests against the live platform
npm run test:all
```

A full guide with screenshots of every prompt and the storefronts it generates:
<https://claude.ai/code/artifact/4849bd08-64ec-41fc-9cdc-813cbdc0a6b2>

The end-to-end suite is not a mock. `e2e/global-setup.ts` scaffolds **four real
projects** through the CLI, installs them from the public npm registry, builds
them, serves each on its own allocated port, and drives them with Chromium
against `api.1ecomm.com`. If `@1ecomm/dt-ui-react` cannot install and compile in
a clean project, setup fails — which is exactly the defect that shipped in
dt-ui 0.1.0 and that no in-repo gate could see.

The matrix crosses framework, palette and appearance, and every entry answers a
question no other entry answers:

| entry | covers |
|---|---|
| react · indigo · light | the default, and the whole shopper journey |
| react · ember · dark | a second palette and dark mode |
| react · jade · light | the same palette as the Vue entry, isolating palette from framework |
| vue · jade · system | the same journey in another framework, same spec, same testids |

**One spec suite drives every framework.** `journey.spec.ts` contains no
framework-specific code — it addresses everything through `data-testid`, which
is why both templates agree on them. Adding a framework costs a template, not a
second copy of the assertions.

What it covers: the shopper journey, the variant gate, checkout preparation
driven by the platform's own country rules, cart mutations and session
isolation, deep links and browser history, phone width and touch targets,
keyboard operation, theming actually reaching the paint, capability-gated
routes, axe on every route, and failure behaviour under injected outages.

The CLI itself is tested as a **process**, not only as functions: help, version,
every refusal, every flag reaching the generated project, and `doctor` against
healthy and broken projects — with exit codes asserted throughout, because a CLI
that prints an error and exits zero cannot be used in a script.

### The suite has been watched failing

A gate never seen failing may assert nothing. Every rule above was verified by
breaking the code and confirming the suite goes red — the variant gate, the
ID-vs-slug link, the price conversion, the palette, the route gating, and the
option ordering. The price case is the instructive one: `Intl.NumberFormat`
coerces a numeric string, so an unconverted price **renders correctly** and the
browser suite cannot see it. That one is caught by a unit test instead.

## Licence

1Ecomm Customer Use License 1.0 — see [LICENSE.md](./LICENSE.md).
