# Template font: Rubik

- Source: Google Fonts `ofl/rubik/Rubik[wght].ttf` at commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` ([source](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/rubik)).
- Source TTF SHA-256: `1b3a7437ba2af80e465e773ed60c5036d1ba6ace492d89046dbcf18fb31e4e88`.
- Variable font, weight axis 300–900; Latin, Cyrillic, Hebrew and Arabic.
- `rubik-wght.woff2` SHA-256: `bdb2228f9f30a2c5c455b40e88be9e00755a3f81e9e0235df2411663b0d971e1` (about 122 KB; the TTF is about 360 KB).
- Lossless WOFF2 conversion (owner decision 6, 2026-11-14): the TTF's 21 tables written unchanged into one brotli stream (WOFF2 null transforms, Node's built-in `zlib`, quality 11, no extra tool); decoding the WOFF2 gives every table byte for byte equal to the TTF, and Chromium loads it (weights 400 and 800, Latin and Cyrillic). No subsetting or instancing; the font name stays Rubik (no Reserved Font Name). Under the OFL a format change makes a Modified Version, still under the OFL.
- Licence: SIL OFL 1.1, [OFL.txt](OFL.txt) next to the font, no Reserved Font Name. Owner approval 2026-11-14: font files unmodified or losslessly converted to WOFF2, font name unchanged; not code packages. `pnpm notices` includes the full text.
- `../template-fonts.ts` loads the face without preloading and with `display: "optional"` (no swap after the first paint), as `--font-template-sans`. Unit tests read that module as text because Vitest has no Next font transform.
- A fork supplies its faces through `config/fonts.ts`, then sets both `--fk-font-sans` and `--fk-font-display` in the light rule of `packages/theme/src/brand-overrides.css`. If neither token names `--font-template-sans`, the template font is not downloaded (`preload: false`); the module and font may stay untouched.
