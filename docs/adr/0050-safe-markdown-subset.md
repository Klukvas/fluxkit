# 0050. Safe Markdown: an own subset parser in core, an AST over the API, React rendering in the UI library

Status: accepted (owner, 2026-11-13: question 4 (a) of plan `docs/plans/2026-11-13-blog.md`, section 17; extension point E9 of the
same plan, section 8). Builds on ADR 0046 (the banner link rule, reused for link targets); changes no earlier ADR.

## Context

- The blog (plan `docs/plans/2026-11-13-blog.md`) needs formatted bodies written by staff in the admin and read by shoppers and
  crawlers. Product descriptions are plain text today; nothing in the lockfile parses Markdown or sanitizes HTML.
- A body is stored data rendered on public pages: any HTML path (Markdown to HTML, then a sanitizer, then `dangerouslySetInnerHTML`)
  makes the sanitizer configuration security-critical and breaks the storefront guard that keeps raw HTML in `json-ld.tsx` only.
- The alternatives were dependencies: `mdast-util-from-markdown` + `micromark` (full CommonMark, about twenty packages) or `marked` +
  `sanitize-html` (an HTML string). The owner chose option (a), no dependency.

## Decision

1. **No HTML at any stage.** `parseMarkdown(source, {locales})` in `packages/core/src/content/markdown/` turns the source into a typed
   AST (`MarkdownDocument`) or refuses it with the first error and its 1-based source line. The API returns the AST; `MarkdownView` in
   `@fluxkit/ui` maps each node to a React element, so React escapes every text. A guard spec keeps raw HTML out of the UI library.
2. **The subset ("Fluxkit Markdown").** Paragraphs; headings `##` to `####` (`#` and `#####` or deeper are refused: the page title is the
   only `h1`; an empty heading is refused); emphasis and strong with `*` or `_` (CommonMark delimiter rules, so `snake_case` stays text);
   inline code; fenced code blocks with three or more backticks or tildes (the info string is dropped, no highlighting; an unclosed fence
   is refused); block quotes (lazy continuation lines allowed); bullet (`-`, `*`, `+`) and ordered (`1.`, `1)`) lists, two levels;
   thematic breaks (`---`, `***`, `___`); links `[text](target)` with optional spaces inside the parentheses and balanced parentheses in
   the target; hard breaks with a trailing backslash; backslash escapes of ASCII punctuation. Only an ordered item starting at 1 ends a
   paragraph (`2024. it rained` continues the sentence).
3. **Everything else is text**, rendered literally: raw HTML, images `![...](...)`, tables, footnotes, autolinks `<https://...>`, entities,
   link titles (`[a](/x "t")`), `<...>` targets, setext headings (`---` under a line is a break), indented code blocks (the indentation
   is dropped), two trailing spaces (no break). Soft line breaks stay as `\n` in text. A link never contains another link.
4. **Links.** A target is a storefront path or an `https` address by the banner link rule (`checkBannerLink`: one leading `/`, no `//`,
   no dot segments also as `%2e`, no locale prefix; an `https` host without credentials), with the scheme written exactly `https://`
   (`HTTPS://` is refused), and no control character (C0, DEL, C1) or bidi control (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to
   U+2069), raw or percent-encoded as UTF-8 (one decoding, like a browser; the encoded line and paragraph separators U+2028 and U+2029
   are refused too), and no invisible format character (U+00AD, U+200B to U+200D, U+2060, U+FEFF, U+180E; raw or percent-encoded,
   reason `format_character`: `exa\u00ADmple.com` would point elsewhere than what the admin sees). A refused target is the error
   `link_refused` with a `reason`. Whitespace (a raw line end, tab or space) ends a
   target, so such brackets stay text and make no link. `[](/x)` (no visible name) is refused. The AST keeps the target without the
   locale; `MarkdownView` adds `localePrefix` to a path (and hands it to the app's router link), renders an `https` address as a plain
   anchor with `rel="noopener noreferrer"` and no `target`, and checks every link again at render (a path without `//`, dot segments
   also as `%2e`, or a leading locale segment of the library's locales or the prefix's own; an `https` host without credentials; no
   whitespace, control, bidi control or format character, raw or percent-encoded): one that fails renders as its text.
5. **Input hygiene.** `\r\n` and a lone `\r` end a line. NUL anywhere is refused (`control_character`). Bidi controls in text are kept
   (legitimate in prose), never in targets. Tabs in a line's leading indentation and markers count to the next stop of four. A leading
   UTF-8 BOM is text, so `\uFEFF# x` is a paragraph, not a refused heading; text indented by four or more spaces is a paragraph too
   (there are no indented code blocks).
6. **Limits** (`MARKDOWN_LIMITS`): 40 000 characters (UTF-16 code units), 2 000 blocks (list items included), block nesting 4 (quotes
   and list items together), list nesting 2, inline nesting 4 (emphasis, strong and link inside each other), 300 links, 20 000 nodes,
   and a serialized document (`JSON.stringify`) of at most 256 KB of UTF-8. The parser is a hand-written single pass with no regular
   expression that can backtrack: emphasis uses CommonMark's delimiter stack with its `openers_bottom` table, code spans an index of
   backtick runs, links a bracket stack whose deactivation stops at the first inactive bracket, and a link target scan stops after 2 048
   characters. An adversarial spec asserts linear time and the output caps on inputs at the length limit.
7. **Error codes** (`MarkdownErrorCode`): `control_character`, `heading_level`, `empty_heading`, `unclosed_code_fence`, `link_refused`,
   `empty_link_text`, `too_long`, `too_many_blocks`, `too_deep`, `too_many_links`, `too_many_nodes`, `too_large`. The document-wide
   `too_long` and `too_large` report line 1; the others the line of the offending text. The blog API maps them (plan section 6:
   `markdown_invalid` with the line and the code, `markdown_too_long`).
8. **Never trust storage.** Only the source is stored. A reader (the blog API) parses it again on every read with the current rules,
   and a body that no longer parses is not served (plan section 8).
9. **Plain text.** `markdownPlainText(document)` returns the words, blocks separated by a blank line (the description fallback and the
   word count of the blog's JSON-LD).
10. **The AST in the UI library.** `@fluxkit/ui` does not depend on core, so `MarkdownView` states the same shape as
    `MarkdownViewDocument`; TypeScript checks core's (admin) or the API client's (storefront) type against it where it is passed. It uses
    existing tokens only (text roles for `h2` to `h4`, the spacing scale, `rounded-panel`, `bg-muted`, `border-border`); no new theme token.

## Consequences

- No dependency, no HTML sanitizer to configure, no new raw HTML. The subset is smaller than CommonMark: writers coming from other tools
  meet literal text for tables and images, and an error (with its line) for `#` headings and refused links.
- The AST and `MarkdownView` are public contracts (`docs/contracts/markdown.md`): adding a node type is additive (a renderer of an older
  version ignores node types it does not know); removing or renaming one is a major change.
- Product descriptions could use the same parser later (not part of this decision).
- Not verified: rendering in a browser (the specs render to static markup), and how writers cope with the subset in the admin form
  (blog plan PR 5).
