# Template font: Rubik

- Source: Google Fonts `ofl/rubik/Rubik[wght].ttf` at commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` ([source](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/rubik)).
- Source TTF SHA-256: `1b3a7437ba2af80e465e773ed60c5036d1ba6ace492d89046dbcf18fb31e4e88`.
- Variable font, weight axis 300–900; Latin, Cyrillic, Hebrew and Arabic.
- `rubik-wght.ttf` is that file byte for byte, only renamed (no brackets in a bundler path): unmodified in the sense of the OFL. Google publishes no WOFF2 of it, and the OFL counts a format change (a TTF to WOFF2 conversion) as a Modified Version, which the owner's approval of 2026-11-14 (unmodified font files) does not cover. Cost: about 360 KB on the first visit (Next serves it from `/_next/static/media` with an immutable cache; no preload). A lossless WOFF2 (about 122 KB, every table byte-identical, checked on 2026-11-14) is an owner decision (`docs/HANDOFF.md`).
- Licence: SIL OFL 1.1, [OFL.txt](OFL.txt) next to the font, no Reserved Font Name. Owner approval: 2026-11-14 for unmodified font files, not code packages. `pnpm notices` includes the full text.
- `../template-fonts.ts` loads the face without preloading, as `--font-template-sans`. Unit tests read that module as text because Vitest has no Next font transform.
- A fork supplies its faces through `config/fonts.ts`, then sets both `--fk-font-sans` and `--fk-font-display` in the light rule of `packages/theme/src/brand-overrides.css`. If neither token names `--font-template-sans`, the template font is not downloaded (`preload: false`); the module and font may stay untouched.
