# Help content (the admin knowledge base)

The articles of the admin's Help area (`/admin-ui/help`). They are TypeScript data, not Markdown: the screens render each block with React, so no HTML from here ever reaches the page. Plan: `docs/plans/2026-11-02-admin-knowledge-base.md`.

## Files

| File | Holds |
|---|---|
| `index.ts` | `HELP_LIBRARY`: the topics in menu order and the articles in reading order (previous and next follow it). |
| `start.ts`, `catalog.ts`, `prices-stock.ts`, `sales.ts`, `settings.ts` | One topic each: the topic and its articles. |
| `../help-model.ts` | The shapes (`HelpArticle`, `HelpBlock`, `HelpText`); not content, keep it when you replace this folder. |

## An article

```ts
{
  id: "gift-wrapping",                 // the address /help/gift-wrapping: lower-case words joined by "-"
  topic: "sales",                      // a topic id of index.ts
  title: { uk: "...", en: "..." },     // every text in EVERY UI language (a missing one is a type error)
  summary: { uk: "...", en: "..." },   // one or two sentences for the list and the search results
  keywords: { uk: ["..."], en: ["..."] }, // extra words people search for
  blocks: [ ... ],
}
```

Blocks (a closed set; anything else does not compile):

| `kind` | Fields | Shown as |
|---|---|---|
| `heading` | `id`, `text` | A section heading; `id` is its anchor (`/help/<article>#<id>`). |
| `paragraph` | `text` | A paragraph. |
| `steps` | `items` | A numbered list. |
| `note` | `text` | A tip. |
| `warning` | `text` | Something that cannot be undone, costs money or depends on a setting. |
| `screen` | `route` | "Open this screen: <page title>", a link to an admin route without parameters (`src/router/paths.ts`). A role that may not open it sees a line instead. |
| `definitions` | `items: [{term, definition}]` | A definition list. |

Texts are plain text: no HTML, no Markdown, no entities (`help-content.spec.ts` refuses them). Ukrainian texts are in Cyrillic, English ones in Latin letters (also checked).

## Adding, changing or replacing articles (client forks)

1. Edit an existing topic file, or add a file with a topic and its articles and list both in `index.ts`.
2. Keep article and section ids stable: other places link to them, and the specs check every link:
   - the shell's "Help for this page" map `src/layout/context-help.ts` (every screen and product editor tab);
   - the getting-started checklist `../checklist-model.ts` (`CHECKLIST_STEPS`: article, section, screen).
   When you rename or remove an article or section, update those two files in the same change.
3. Describe what the shop really does in that fork (its providers, its settings). Mark what depends on configuration, say what the shop does not do, and promise no legal outcome.
4. Run `pnpm --filter @fluxkit/admin test` (`help-content.spec.ts`: both languages, no empty block, unique ids, real routes and anchors, no markup).

No client data here in the template: no shop names, addresses, phone numbers or real products.

## Search

The search box looks at title, keywords, summary and body in all languages, case- and diacritic-insensitive, every typed word must match (`../help-search.ts`). Add keywords for words people use that the text does not contain.
