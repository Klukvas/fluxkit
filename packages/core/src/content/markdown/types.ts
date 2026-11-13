import type { BannerLinkRefusal } from "../banner-link.js";

/**
 * The AST of "Fluxkit Markdown" (ADR 0050): what the API returns instead of HTML and what `MarkdownView` of `@fluxkit/ui`
 * renders with React elements. Public contract (`docs/contracts/markdown.md`); additive changes only within a major version.
 */

export interface MarkdownText {
  readonly type: "text";
  /** Literal text; soft line breaks stay as `\n`. Never HTML: the renderer escapes it. */
  readonly value: string;
}

export interface MarkdownInlineCode {
  readonly type: "inlineCode";
  readonly value: string;
}

export interface MarkdownBreak {
  readonly type: "break";
}

export interface MarkdownEmphasis {
  readonly type: "emphasis";
  readonly children: readonly MarkdownInline[];
}

export interface MarkdownStrong {
  readonly type: "strong";
  readonly children: readonly MarkdownInline[];
}

/** A storefront path (stored without a locale; the renderer adds it) or an `https` address. Never contains another link. */
export interface MarkdownLink {
  readonly type: "link";
  readonly kind: "path" | "https";
  readonly href: string;
  readonly children: readonly MarkdownInline[];
}

export type MarkdownInline =
  | MarkdownText
  | MarkdownInlineCode
  | MarkdownBreak
  | MarkdownEmphasis
  | MarkdownStrong
  | MarkdownLink;

export interface MarkdownParagraph {
  readonly type: "paragraph";
  readonly children: readonly MarkdownInline[];
}

/** `##` to `####`: the page title is the only `h1`. */
export interface MarkdownHeading {
  readonly type: "heading";
  readonly level: 2 | 3 | 4;
  readonly children: readonly MarkdownInline[];
}

/** A fenced code block; the info string is dropped (no highlighting). */
export interface MarkdownCodeBlock {
  readonly type: "codeBlock";
  readonly value: string;
}

export interface MarkdownBlockquote {
  readonly type: "blockquote";
  readonly children: readonly MarkdownBlock[];
}

export interface MarkdownListItem {
  readonly type: "listItem";
  readonly children: readonly MarkdownBlock[];
}

export interface MarkdownList {
  readonly type: "list";
  readonly ordered: boolean;
  /** The first number of an ordered list (1 for a bullet list). */
  readonly start: number;
  readonly items: readonly MarkdownListItem[];
}

export interface MarkdownThematicBreak {
  readonly type: "thematicBreak";
}

export type MarkdownBlock =
  | MarkdownParagraph
  | MarkdownHeading
  | MarkdownCodeBlock
  | MarkdownBlockquote
  | MarkdownList
  | MarkdownThematicBreak;

export interface MarkdownDocument {
  readonly type: "document";
  readonly children: readonly MarkdownBlock[];
}

/** Why a link target is refused: the banner link rule's reasons, plus control and bidi characters (raw or percent-encoded). */
export type MarkdownLinkRefusal = BannerLinkRefusal | "control_character" | "bidi_control";

export type MarkdownErrorCode =
  /** NUL anywhere in the source. */
  | "control_character"
  /** `#` (the page title is the only `h1`) or `#####` and deeper. */
  | "heading_level"
  /** A heading without text. */
  | "empty_heading"
  /** A code fence that is never closed inside its block. */
  | "unclosed_code_fence"
  /** A link target that is not a storefront path or an `https` address (see `reason`). */
  | "link_refused"
  /** `[](...)`: a link must have a visible name. */
  | "empty_link_text"
  /** More than `maxLength` characters (whole document, line 1). */
  | "too_long"
  /** More than `maxBlocks` blocks, list items included. */
  | "too_many_blocks"
  /** Block nesting deeper than `maxDepth`, lists deeper than `maxListDepth`, or inline nesting deeper than `maxInlineDepth`. */
  | "too_deep"
  | "too_many_links"
  /** More than `maxNodes` AST nodes in total. */
  | "too_many_nodes"
  /** The serialized document is larger than `maxSerializedBytes` (whole document, line 1). */
  | "too_large";

export interface MarkdownError {
  readonly code: MarkdownErrorCode;
  /** 1-based source line (`\r\n`, `\r` and `\n` end a line). */
  readonly line: number;
  /** Only with `link_refused`. */
  readonly reason?: MarkdownLinkRefusal;
}

export type MarkdownParseResult =
  | { readonly ok: true; readonly document: MarkdownDocument }
  | { readonly ok: false; readonly error: MarkdownError };

export interface MarkdownParseOptions {
  /** The shop's locales: a link path may not start with one (`/uk/x`); the storefront adds the shopper's locale. */
  readonly locales: readonly string[];
}
