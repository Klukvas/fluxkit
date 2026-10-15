# packages/core

Pure TypeScript domain logic of the catalog (ADR 0006, AGENTS.md section 2.3) and of admin authentication rules (ADR 0009). Rules only: no Nest, no Drizzle, no database, no network, no filesystem, no clock (time is a parameter). Enforced by dependency-cruiser (`core-must-not-import-infrastructure`). The one runtime dependency is `zod`, used only by `attribute-values.ts`.
The API (`apps/api`) reads facts from the database, calls these functions inside a transaction, and maps the results to HTTP problems. Core never decides HTTP status codes.

- `package.json` - `@fluxkit/core`, private; runtime dependency `zod` only; devDependencies typescript and vitest.
- `src/index.ts` - public entry; re-exports `./auth/index.js` and `./catalog/index.js`. Must not export anything else.
- `src/catalog/index.ts` - barrel of the catalog modules below. Add new modules here.

## Entities and shared types

- `src/catalog/types.ts` - plain data shapes (`I18nText`, `AttributeDefinition`, `ProductTypeDefinition`, `OptionDefinition`, `VariantSnapshot`, `ProductSnapshot`, `CategoryNode`, `LocaleConfig`). Must not carry ORM or framework types; the API maps rows to these and back.
- `src/catalog/limits.ts` - `CATALOG_LIMITS` (options per product 3, values per option 30, variants 250, depth 5, page size 100, offset 10 000, ...), `TEXT_LIMITS`, `ATTRIBUTE_VALIDATION_DEFAULTS`, code patterns and `isValidCode` / `isValidValueCode`. Must not read configuration; limits are constants.
- `src/catalog/text-safety.ts` - `hasJsonbUnsafeCharacters` (exported): NUL and unpaired surrogates, which Postgres rejects or the driver silently replaces. Turns a 500 into a field error; the admin schemas use it for every free-text column (barcode, URLs, unit).

## Text, slugs, SKUs

- `src/catalog/i18n.ts` - `validateI18nText` (shape, default locale required, allowed locales, length), `resolveText` (requested locale, else default; per field), `codePointLength`.
- `src/catalog/slug.ts` - `validateSlug`, `isValidSlug`, `transliterateUkrainian` (KMU resolution 55/2010), `slugify`, `slugLookupPrefix` (the prefix a caller queries taken slugs with; not the plain slug, because the candidates of a 160 character slug are `base158-2`, ...), `generateUniqueSlug` (slugifies the title and adds `-2`, `-3` against the set of taken slugs the caller passes in; it must contain every taken slug that starts with `slugLookupPrefix(title)`). Must not query the database for collisions itself.
- `src/catalog/sku.ts` - `normalizeSku` (trim, uppercase), `validateSku`, `proposeSku` / `proposeSkus` (`<SLUG>-<VALUE_CODE>...` uppercased, skipping SKUs in the taken set the caller passes in).

## Attributes and values

- `src/catalog/attribute-defaults.ts` - `normalizeAttributeDefinitionInput`: defaults (`isLocalized` only for text, `isVisibleOnStorefront` is `!isInternal`) and definition consistency errors (for example `internal_cannot_be_public`).
- `src/catalog/attribute-values.ts` - `parseAttributeValidation` and `validateAttributeValues`: validates product or variant attribute values against definitions, in draft mode (required not enforced) or publish mode. Only file in core that uses `zod`. Must not accept unknown keys silently.
- `src/catalog/store-attributes.ts` - public view of attributes: `isPublicAttribute`, `selectPublicAttributes`, `publicAttributeDefinitions`. The one allowlist deciding what the store API may expose (visible on storefront and not internal). Must not be bypassed; the store serializer feeds it and never filters itself.

## Options and variants

- `src/catalog/variants.ts` - `computeOptionSignature` (sorted `code=value` pairs joined with `;`; internal), `generateVariants` (cartesian product, skips existing combinations, enforces limits), invariant checks (`checkExactlyOneDefault`, `checkOptionCoverage`, `checkUniqueSignatures`, `checkSignatureConsistency`, `checkVariantInvariants`).
- `src/catalog/variant-rules.ts` - `canDeleteVariant` (draft only, not the last, not the default), `canCreateVariantManually` (draft only).
- `src/catalog/product-option-change.ts` - `planProductOptionChange`: what a change of a product's options and chosen values does (works on ids, returns a plan; the service applies it in one transaction).

## Categories

- `src/catalog/category-tree.ts` - `depthOf`, `subtreeHeight`, `wouldCreateCycle`, `validateMove`, `validateNewNode`, `validateTree`: depth 5, no cycles, existence of parent or node. Pure; takes the whole tree as input.
- `src/catalog/category-assignments.ts` - `normalizeCategoryAssignments` (exactly one primary when a product has categories), `promotePrimaryAfterRemoval`.

## Lifecycle, rules and type changes

- `src/catalog/lifecycle.ts` - `canTransition` (draft, active, archived), `canHardDelete` (never published), `publishPreconditions` (every violation at once: title, slug, default variant, active variant, option coverage, SKU, required attributes, allowed options).
- `src/catalog/publish-timestamp.ts` - `nextPublishedAt`: set on the first publish, never moved. Takes `now` as a parameter.
- `src/catalog/type-change-rules.ts` - `decide*` functions for ADR 0006 section 5 (code, input type, localization, unit, level, attribute and option removal, product type change, option change on products). Each takes facts the service read from the database and returns `allowed` or a reason code. Must not read anything itself.

## Admin authentication rules (ADR 0009)

Pure decisions only: no hashing, no cookies, no random numbers, no clock (`now` is a parameter). The API does the I/O (scrypt, sessions, database) and calls these.

- `src/auth/index.ts` - barrel of the auth modules below. Add new modules here.
- `src/auth/roles.ts` - `ROLES` (`owner`, `manager`, `viewer`), `PERMISSIONS`, frozen `ROLE_PERMISSIONS`, `isAdminRole`, `isAdminPermission`, `permissionsOf` (frozen copy), `hasPermission`. Unknown role or permission strings (also `__proto__`, `constructor`) never grant anything. The one place roles are defined.
- `src/auth/password-policy.ts` - `PASSWORD_LIMITS` (12 to 128 code points), `validatePassword`: `too_short`, `too_long`, `equals_email`, `not_a_string`, `contains_nul`. No composition rules. Must not hash.
- `src/auth/email.ts` - `normalizeEmail` (trim, lower-case; the stored form), `validateEmail` (a small format check, not the RFC; returns the normalized email).
- `src/auth/lockout.ts` - `LOCKOUT_DEFAULTS` (5 failures, 15 minutes), `isLocked`, `registerFailedLogin`, `registerSuccessfulLogin`. Returns the new counter and lock; does not write them.
- `src/auth/session.ts` - `SESSION_DEFAULTS` (720 idle minutes, 168 hours), `evaluateSession` (`idle_timeout`, `max_lifetime`, `invalid_session`; a limit reached exactly is expired), `shouldTouchSession` (at most once a minute), `sessionExpiry`. Must not read the clock.
- `src/auth/user-rules.ts` - `decideUserChange`: the last active owner cannot be demoted or deactivated; unknown roles are rejected. The caller passes the active owner ids read in the same transaction.

## Test-only and tests

- `src/catalog/test-support.ts` - `deepFreeze` for tests; excluded from the build (`tsconfig.build.json`). Must not be imported by the API.
- `src/auth/*.spec.ts`, `src/catalog/*.spec.ts` - Vitest unit tests next to each module (rules and edge cases); `src/index.spec.ts` checks the public entry point.
