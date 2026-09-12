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

## Licence

1Ecomm Customer Use License 1.0 — see [LICENSE.md](./LICENSE.md).
