// The message extras of the fork run (`vitest.home-fork.config.ts` only; not used by the app): the REAL
// `src/messages-extra/uk.json` (empty upstream, a fork's own `custom.` texts in a fork) with upstream's fixture texts merged
// over it, so a fork's own sections keep their texts in that run. The real file is imported by a path the run's alias of
// `../messages-extra/uk.json` does not match.
import real from "../../src/messages-extra/uk.json";
import fixture from "./messages-extra-fork-fixture.uk.json";

const extras: Readonly<Record<string, unknown>> = { ...real, ...fixture };

export default extras;
