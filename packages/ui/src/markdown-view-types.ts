/**
 * The Markdown AST that `MarkdownView` renders: structurally the `MarkdownDocument` of `@fluxkit/core` (ADR 0050), restated
 * because the UI library does not depend on core. A caller passing core's type (the admin) or the API client's type (the
 * storefront) is checked against this shape by TypeScript at the call site. Contract: `docs/contracts/markdown.md`.
 */

export type MarkdownViewInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "inlineCode"; readonly value: string }
  | { readonly type: "break" }
  | { readonly type: "emphasis"; readonly children: readonly MarkdownViewInline[] }
  | { readonly type: "strong"; readonly children: readonly MarkdownViewInline[] }
  | {
      readonly type: "link";
      readonly kind: "path" | "https";
      readonly href: string;
      readonly children: readonly MarkdownViewInline[];
    };

export interface MarkdownViewListItem {
  readonly type: "listItem";
  readonly children: readonly MarkdownViewBlock[];
}

export type MarkdownViewBlock =
  | { readonly type: "paragraph"; readonly children: readonly MarkdownViewInline[] }
  | {
      readonly type: "heading";
      readonly level: 2 | 3 | 4;
      readonly children: readonly MarkdownViewInline[];
    }
  | { readonly type: "codeBlock"; readonly value: string }
  | { readonly type: "blockquote"; readonly children: readonly MarkdownViewBlock[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly MarkdownViewListItem[];
    }
  | { readonly type: "thematicBreak" };

export interface MarkdownViewDocument {
  readonly type: "document";
  readonly children: readonly MarkdownViewBlock[];
}
