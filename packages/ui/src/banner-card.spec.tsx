import { describe, expect, it } from "vitest";
import { BannerCard, type BannerCardLinkProps } from "./banner-card";
import { classTokens, first, render, tags, text } from "./test-helpers";

const anchor = (href: string) =>
  function Anchor({ children, ...props }: BannerCardLinkProps) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };

const picture = (alt: string) => (
  <img src="/p.webp" alt={alt} width={1280} height={640} className="h-full w-full object-cover" />
);

describe("BannerCard, card layout", () => {
  it("is one link named by its title and described by its text; the decorative picture adds nothing", () => {
    const markup = render(
      <BannerCard
        id="b1"
        layout="card"
        title="Spring sale"
        text="Up to a third off"
        picture={picture("")}
        renderLink={anchor("/catalog")}
      />,
    );
    expect(tags(markup, "a")).toHaveLength(1);
    const link = first(markup, "a");
    expect(link.attributes["href"]).toBe("/catalog");
    expect(link.attributes["aria-labelledby"]).toBe("b1-title");
    expect(link.attributes["aria-describedby"]).toBe("b1-text");
    expect(first(markup, "h3").attributes["id"]).toBe("b1-title");
    expect(markup).toContain('id="b1-text"');
    expect(first(markup, "img").attributes["alt"]).toBe("");
    expect(text(markup)).toBe("Spring sale Up to a third off");
  });

  it("has no description without a text, and takes the heading level it is given", () => {
    const markup = render(
      <BannerCard
        id="b2"
        layout="card"
        title="New"
        text={null}
        picture={picture("")}
        renderLink={anchor("/x")}
        headingLevel="h2"
      />,
    );
    expect(first(markup, "a").attributes["aria-describedby"]).toBeUndefined();
    expect(markup).not.toContain("b2-text");
    expect(tags(markup, "h2")).toHaveLength(1);
    expect(tags(markup, "h3")).toHaveLength(0);
  });

  it("treats an empty text like no text: no description element, no aria-describedby", () => {
    for (const text of ["", null, undefined]) {
      const markup = render(
        <BannerCard
          id="e"
          layout="card"
          title="New"
          text={text}
          picture={picture("")}
          renderLink={anchor("/x")}
        />,
      );
      expect(first(markup, "a").attributes["aria-describedby"], String(text)).toBeUndefined();
      expect(markup, String(text)).not.toContain('id="e-text"');
    }
  });

  it("draws the tones with tokens only: surface on the background, accent on the accent fill (the tone name stays)", () => {
    const surface = classTokens(
      render(
        <BannerCard
          id="s"
          layout="card"
          title="T"
          text="X"
          picture={picture("")}
          renderLink={anchor("/")}
        />,
      ),
    );
    expect(surface).toEqual(expect.arrayContaining(["bg-background", "text-foreground"]));
    expect(surface).toContain("text-muted-foreground");
    const accent = classTokens(
      render(
        <BannerCard
          id="a"
          layout="card"
          tone="accent"
          title="T"
          text="X"
          picture={picture("")}
          renderLink={anchor("/")}
        />,
      ),
    );
    expect(accent).toEqual(expect.arrayContaining(["bg-accent", "text-accent-foreground"]));
    expect(accent).not.toContain("bg-primary");
    expect(accent).not.toContain("text-muted-foreground");
  });

  it("puts the picture in a fixed 2:1 frame, so any upload keeps the card's size", () => {
    const markup = render(
      <BannerCard id="f" layout="card" title="T" picture={picture("")} renderLink={anchor("/")} />,
    );
    const frame = /<span class="([^"]*aspect-2\/1[^"]*)"><img/.exec(markup);
    expect(frame?.[1]).toContain("overflow-hidden");
  });
});

describe("BannerCard, image layout", () => {
  it("is one link around the picture alone, named by the picture's alt, without title, text or tone", () => {
    const markup = render(
      <BannerCard
        id="i1"
        layout="image"
        tone="accent"
        title="ignored"
        text="ignored too"
        picture={picture("Spring sale: up to a third off")}
        renderLink={anchor("https://example.com/sale")}
      />,
    );
    expect(tags(markup, "a")).toHaveLength(1);
    const link = first(markup, "a");
    expect(link.attributes["aria-labelledby"]).toBeUndefined();
    expect(link.attributes["aria-describedby"]).toBeUndefined();
    expect(first(markup, "img").attributes["alt"]).toBe("Spring sale: up to a third off");
    expect(text(markup)).toBe("");
    expect(tags(markup, "h3")).toHaveLength(0);
    expect(classTokens(markup)).not.toContain("bg-primary");
    expect(markup).toContain("aspect-2/1");
  });

  it("lets the app render the link as something else (an admin preview that must not navigate)", () => {
    const markup = render(
      <BannerCard
        id="p"
        layout="image"
        picture={picture("Alt")}
        renderLink={({ children, className }) => <div className={className}>{children}</div>}
      />,
    );
    expect(tags(markup, "a")).toHaveLength(0);
    expect(tags(markup, "div")).toHaveLength(1);
  });
});
