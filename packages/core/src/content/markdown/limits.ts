/**
 * Limits of "Fluxkit Markdown" (ADR 0050, blog plan section 8). They bound the work of one parse and the size of what the
 * API returns, so a stored body can be parsed again on every store read.
 */
export const MARKDOWN_LIMITS = Object.freeze({
  /** Source characters (UTF-16 code units, like the API's string length check). */
  maxLength: 40_000,
  /** Block nodes, list items included. */
  maxBlocks: 2_000,
  /** Block containers (block quotes and list items) inside each other. */
  maxDepth: 4,
  /** Lists inside lists: two levels. */
  maxListDepth: 2,
  /** Emphasis, strong and link inside each other. */
  maxInlineDepth: 4,
  maxLinks: 300,
  /** Every node of the AST, the document itself left out. */
  maxNodes: 20_000,
  /** UTF-8 bytes of `JSON.stringify(document)`: 256 KB. */
  maxSerializedBytes: 262_144,
  /** Characters scanned for one link target before giving up (the banner link rule's maximum length). */
  maxLinkTargetLength: 2_048,
});
