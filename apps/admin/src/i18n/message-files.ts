import { ADMIN_FEATURES, featureMessageLoaders } from "../features/registry";
import { LAZY_FILE_LOADERS, createFileLoader } from "../messages";

/** Every lazy message file the SPA can load: the areas' files and the message file of each feature slice. */
export const loadAnyMessageFile = createFileLoader(
  LAZY_FILE_LOADERS,
  featureMessageLoaders(ADMIN_FEATURES),
);
