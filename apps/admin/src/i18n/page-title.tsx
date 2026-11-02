import { createContext, useContext, useEffect } from "react";
import { useLocation } from "react-router";

/**
 * A page whose title is data (a help article, its not-found state) tells the shell, which writes the document title
 * (`use-document-title.ts`). The title is kept with the path it was set for, so it never leaks to the next page: the shell
 * uses it only while that path is shown (no reset effect that could run after the page's own effect).
 */
export interface PageTitleOverride {
  pathname: string;
  text: string;
}

const PageTitleContext = createContext<((title: PageTitleOverride) => void) | null>(null);

export const PageTitleProvider = PageTitleContext.Provider;

/** Uses `text` as the document title of the current page (outside the shell, in tests, it does nothing). */
export function usePageTitle(text: string): void {
  const setTitle = useContext(PageTitleContext);
  const { pathname } = useLocation();
  useEffect(() => {
    setTitle?.({ pathname, text });
  }, [setTitle, pathname, text]);
}
