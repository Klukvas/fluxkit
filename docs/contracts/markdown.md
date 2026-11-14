# Contract: safe Markdown (`MarkdownDocument`, `MarkdownView`)

Status: new in this release (blog plan `docs/plans/2026-11-13-blog.md`, extension point E9, ADR 0050); not released yet, so it can still
change before the first SemVer release (recorded in `CHANGELOG.md`). The blog's contract list (`features.md`, plan section 13) points
here for E9.

## What is contract

| Item | Since | Contract |
|---|---|---|
| Syntax ("Fluxkit Markdown") | unreleased | ADR 0050 decisions 2 to 5: what parses into nodes, what stays literal text, the link rule and the input hygiene. Accepting more syntax is minor; refusing syntax that parsed before is breaking (a stored body could stop parsing) |
| `parseMarkdown(source, {locales})` (`@fluxkit/core`) | unreleased | `{ok: true, document}` or `{ok: false, error: {code, line, reason?}}`; never throws for any string input; pure |
| `MarkdownDocument` (`@fluxkit/core`) | unreleased | `{type: "document", children: Block[]}`. Block: `paragraph {children}`, `heading {level: 2 \| 3 \| 4, children}`, `codeBlock {value}`, `blockquote {children: Block[]}`, `list {ordered, start, items: listItem[]}` with `listItem {children: Block[]}`, `thematicBreak`. Inline: `text {value}`, `inlineCode {value}`, `break`, `emphasis {children}`, `strong {children}`, `link {kind: "path" \| "https", href, children}` (a path without the locale; never a link inside a link). Adding a node type or a field is minor (renderers ignore unknown node types); renaming or removing one is breaking |
| Error codes (`MarkdownErrorCode`) | unreleased | `control_character`, `heading_level`, `empty_heading`, `unclosed_code_fence`, `link_refused` (with `reason`: the banner link reasons plus `control_character`, `bidi_control`, `format_character`), `empty_link_text`, `too_long`, `too_many_blocks`, `too_deep`, `too_many_links`, `too_many_nodes`, `too_large`; `line` is 1-based (line 1 for the document-wide `too_long` and `too_large`) |
| `MARKDOWN_LIMITS` (`@fluxkit/core`) | unreleased | 40 000 characters, 2 000 blocks, nesting 4, lists 2, inline nesting 4, 300 links, 20 000 nodes, 256 KB serialized. Raising a limit is minor, lowering one is breaking |
| `markdownPlainText(document)` (`@fluxkit/core`) | unreleased | the words of the document, blocks separated by a blank line, no markup |
| `MarkdownView` (`@fluxkit/ui`) | unreleased | props `document` (`MarkdownViewDocument`, the same shape as `MarkdownDocument`), `localePrefix` (`""` or `"/<locale>"`, anything else throws), optional `renderPathLink({href, className, children})` for storefront paths, optional `className` for the container. Renders a `div` of semantic elements (`h2` to `h4`, `p`, `em`, `strong`, `code`, `pre`, `blockquote`, `ul`/`ol`/`li`, `hr`, `a`); never raw HTML; `https` links with `rel="noopener noreferrer"`; a link that fails the render-time check is rendered as its text |

## Not contract

- The classes `MarkdownView` puts on its elements (tokens only; a redesign may change them), and the parser's internal modules (only
  the names exported from `@fluxkit/core` are public).
