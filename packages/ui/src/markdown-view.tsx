import { Fragment, type ReactNode } from "react";
import { cn } from "./cn";
import { assertLocalePrefix, markdownViewHref } from "./markdown-view-href";
import type {
  MarkdownViewBlock,
  MarkdownViewDocument,
  MarkdownViewInline,
  MarkdownViewListItem,
} from "./markdown-view-types";
import { focusRing, textStyles } from "./styles";

/** What `renderPathLink` receives for a storefront path: the final address (locale included), the classes and the text. */
export interface MarkdownViewLinkProps {
  href: string;
  className: string;
  children: ReactNode;
}

export interface MarkdownViewProps {
  /** The parsed body (`MarkdownDocument` of core, as the API returns it). Never HTML. */
  document: MarkdownViewDocument;
  /** `"/<locale>"` added in front of storefront paths (`/catalog` -> `/uk/catalog`), or `""`. Anything else throws. */
  localePrefix: string;
  /** Renders a storefront path link (the app's router link). Default: a plain anchor. `https` links are always plain anchors. */
  renderPathLink?: (props: MarkdownViewLinkProps) => ReactNode;
  /** Layout classes for the container (width, margins). */
  className?: string;
}

interface RenderContext {
  readonly localePrefix: string;
  readonly renderPathLink: (props: MarkdownViewLinkProps) => ReactNode;
}

const LINK_CLASS = cn("underline underline-offset-4", focusRing);
const EXTERNAL_REL = "noopener noreferrer";

function plainAnchor({ href, className, children }: MarkdownViewLinkProps): ReactNode {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

// The AST carries no ids and a rendered document never reorders, so a node's position is its identity: the keys below are
// positions on purpose.
function renderInlines(nodes: readonly MarkdownViewInline[], context: RenderContext): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, `${index}`, context));
}

function renderLink(
  node: Extract<MarkdownViewInline, { type: "link" }>,
  key: string,
  context: RenderContext,
): ReactNode {
  const children = renderInlines(node.children, context);
  const href = markdownViewHref(node.kind, node.href, context.localePrefix);
  if (href === null) {
    return <Fragment key={key}>{children}</Fragment>;
  }
  if (node.kind === "https") {
    return (
      <a key={key} href={href} rel={EXTERNAL_REL} className={LINK_CLASS}>
        {children}
      </a>
    );
  }
  return (
    <Fragment key={key}>
      {context.renderPathLink({ href, className: LINK_CLASS, children })}
    </Fragment>
  );
}

function renderInline(node: MarkdownViewInline, key: string, context: RenderContext): ReactNode {
  switch (node.type) {
    case "text":
      return <Fragment key={key}>{node.value}</Fragment>;
    case "inlineCode":
      return (
        <code key={key} className="bg-muted px-1 font-mono text-sm">
          {node.value}
        </code>
      );
    case "break":
      return <br key={key} />;
    case "emphasis":
      return <em key={key}>{renderInlines(node.children, context)}</em>;
    case "strong":
      return <strong key={key}>{renderInlines(node.children, context)}</strong>;
    case "link":
      return renderLink(node, key, context);
    default:
      return null;
  }
}

function renderHeading(
  node: Extract<MarkdownViewBlock, { type: "heading" }>,
  key: string,
  context: RenderContext,
): ReactNode {
  const children = renderInlines(node.children, context);
  // One element per level, each with its text role written inline (the design guard reads the role from the className).
  switch (node.level) {
    case 2:
      return (
        <h2 key={key} className={textStyles.sectionTitle}>
          {children}
        </h2>
      );
    case 3:
      return (
        <h3 key={key} className={textStyles.subsectionTitle}>
          {children}
        </h3>
      );
    case 4:
      return (
        <h4 key={key} className={textStyles.itemTitle}>
          {children}
        </h4>
      );
    default:
      return null;
  }
}

function renderItems(items: readonly MarkdownViewListItem[], context: RenderContext): ReactNode[] {
  return items.map((item, index) => (
    <li key={`${index}`} className="space-y-2">
      {renderBlocks(item.children, context)}
    </li>
  ));
}

function renderBlock(node: MarkdownViewBlock, key: string, context: RenderContext): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInlines(node.children, context)}</p>;
    case "heading":
      return renderHeading(node, key, context);
    case "codeBlock":
      return (
        <pre
          key={key}
          tabIndex={0}
          className={cn("overflow-x-auto rounded-panel bg-muted p-4 font-mono text-sm", focusRing)}
        >
          <code>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-4 border-s-4 border-border ps-4 text-muted-foreground"
        >
          {renderBlocks(node.children, context)}
        </blockquote>
      );
    case "list":
      return node.ordered ? (
        <ol
          key={key}
          start={node.start === 1 ? undefined : node.start}
          className="list-decimal space-y-2 ps-6"
        >
          {renderItems(node.items, context)}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-2 ps-6">
          {renderItems(node.items, context)}
        </ul>
      );
    case "thematicBreak":
      return <hr key={key} className="border-border" />;
    default:
      return null;
  }
}

function renderBlocks(nodes: readonly MarkdownViewBlock[], context: RenderContext): ReactNode[] {
  return nodes.map((node, index) => renderBlock(node, `${index}`, context));
}

/**
 * A Markdown body (ADR 0050) rendered with React elements only: every text is escaped by React, nothing is set as HTML, and
 * every link is checked again before it becomes an anchor. Headings take the text roles (`h2` section, `h3` subsection, `h4`
 * item: the page's `h1` is the title outside). Presentational: tokens only, no copy, no routing (paths go to
 * `renderPathLink`).
 */
export function MarkdownView({
  document,
  localePrefix,
  renderPathLink = plainAnchor,
  className,
}: MarkdownViewProps) {
  assertLocalePrefix(localePrefix);
  const context: RenderContext = { localePrefix, renderPathLink };
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {renderBlocks(document.children, context)}
    </div>
  );
}
