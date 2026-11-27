import { paragraphsOf } from "../lib/shop-pages";

/** Plain text shared by shop and legal pages; blank lines start paragraphs. */
export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index} className="max-w-prose text-foreground">
          {paragraph}
        </p>
      ))}
    </>
  );
}
