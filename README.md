# Fluxkit

White-label e-commerce template: a solid catalog/cart/checkout core, replaceable design, and feature modules you can switch on or off per client.

**Powered by [FluxLab](https://flux-lab.dev/en)**

## Principles

- **Niche-agnostic catalog**: Product + Variant (SKU), data-driven attributes via ProductType.
- **Replaceable design**: design tokens and a token-based UI library.
- **Modular features**: every optional feature lives in its own module behind a single flag.

## Status

Early scaffolding. Stack is not chosen yet (see `AGENTS.md`, section 1).

## Layout

```
apps/storefront     customer-facing site
apps/admin          admin panel
packages/core       catalog, cart, checkout, orders, customers
packages/features   optional modules (wishlist, reviews, coupons, ...)
packages/ui         token-based components
packages/theme      design tokens and presets
packages/config     feature flags, store settings schema
docs/               architecture and guides
seeds/              demo data, product type presets
```

## For AI agents

Rules live in [`AGENTS.md`](./AGENTS.md); `CLAUDE.md` imports it.
