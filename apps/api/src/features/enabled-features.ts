/**
 * The names of the features loaded from `FEATURES_ENABLED`, sorted (`readonly string[]`; ADR 0049, E4): `features` of
 * `GET /store/config` and `GET /admin/config`. Provided globally by `FeaturesModule`.
 */
export const ENABLED_FEATURES = Symbol("ENABLED_FEATURES");

export type EnabledFeatures = readonly string[];
