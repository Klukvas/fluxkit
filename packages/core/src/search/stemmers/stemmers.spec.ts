import { describe, expect, it } from "vitest";
import { prefixToken, stemLanguageOf, stemToken, stemTokens } from "./index.js";
import { ENGLISH_VOCABULARY_SAMPLE } from "./snowball/english-sample.js";
import { UKRAINIAN_VOCABULARY_SAMPLE } from "./snowball/ukrainian-sample.js";

function pairs(sample: string): [string, string][] {
  return sample
    .trim()
    .split("\n")
    .map((line) => {
      const [word, stem] = line.split(" ");
      if (word === undefined || stem === undefined) {
        throw new Error(`bad sample line: ${line}`);
      }
      return [word, stem];
    });
}

describe("stemLanguageOf", () => {
  it("maps the locales that have a Snowball algorithm", () => {
    expect(stemLanguageOf("uk")).toBe("uk");
    expect(stemLanguageOf("en")).toBe("en");
    expect(stemLanguageOf("EN")).toBe("en");
    expect(stemLanguageOf("uk-UA")).toBe("uk");
  });

  it("returns null for any other locale", () => {
    expect(stemLanguageOf("de")).toBeNull();
    expect(stemLanguageOf("")).toBeNull();
    expect(stemLanguageOf("ukr")).toBeNull();
  });
});

describe("Snowball Ukrainian stemmer", () => {
  it("reproduces the reference stems of snowball-data (a sample of 1 in 100 words of the frequency list)", () => {
    const sample = pairs(UKRAINIAN_VOCABULARY_SAMPLE);
    expect(sample.length).toBeGreaterThan(500);
    const wrong = sample.filter(([word, stem]) => stemToken(word, "uk") !== stem);
    expect(wrong).toEqual([]);
  });

  it("gives inflected forms of one word the same stem", () => {
    expect(stemToken("футболка", "uk")).toBe("футболк");
    expect(stemToken("футболки", "uk")).toBe("футболк");
    expect(stemToken("футболці", "uk")).toBe("футболк");
    expect(stemToken("книга", "uk")).toBe("книг");
    expect(stemToken("книзі", "uk")).toBe("книг");
    expect(stemToken("класичний", "uk")).toBe("класичн");
    expect(stemToken("класична", "uk")).toBe("класичн");
    expect(stemToken("чоловічий", "uk")).toBe("чоловіч");
    expect(stemToken("чоловічі", "uk")).toBe("чоловіч");
  });

  it("KNOWN LIMITATION: some forms of one word get different stems (the reason for the prefix queries)", () => {
    // diminutive rule and the dative "-ові" rule of the reference algorithm
    expect(stemToken("сорочка", "uk")).toBe("сор");
    expect(stemToken("сорочці", "uk")).toBe("сорочц");
    expect(stemToken("зимові", "uk")).toBe("зим");
    expect(stemToken("зимовий", "uk")).toBe("зимов");
  });

  it("keeps the apostrophe inside a word", () => {
    expect(stemToken("м'ясо", "uk")).toBe("м'яс");
  });

  it("leaves tokens it cannot stem as they are (Latin, digits, mixed)", () => {
    expect(stemToken("basic", "uk")).toBe("basic");
    expect(stemToken("x200", "uk")).toBe("x200");
    expect(stemToken("500г", "uk")).toBe("500г");
    expect(stemToken("", "uk")).toBe("");
  });
});

describe("Snowball English stemmer", () => {
  it("reproduces the reference stems of snowball-data (a sample of 1 in 100 words)", () => {
    const sample = pairs(ENGLISH_VOCABULARY_SAMPLE);
    expect(sample.length).toBeGreaterThan(300);
    const wrong = sample.filter(([word, stem]) => stemToken(word, "en") !== stem);
    expect(wrong).toEqual([]);
  });

  it("joins singular and plural forms", () => {
    expect(stemToken("batteries", "en")).toBe("batteri");
    expect(stemToken("battery", "en")).toBe("batteri");
    expect(stemToken("jackets", "en")).toBe("jacket");
    expect(stemToken("jacket", "en")).toBe("jacket");
    expect(stemToken("shoes", "en")).toBe("shoe");
  });

  it("KNOWN LIMITATION: irregular forms stay apart (synonyms cover them)", () => {
    expect(stemToken("knives", "en")).not.toBe(stemToken("knife", "en"));
    expect(stemToken("mice", "en")).not.toBe(stemToken("mouse", "en"));
  });

  it("does not touch Cyrillic, digits or codes", () => {
    expect(stemToken("сорочки", "en")).toBe("сорочки");
    expect(stemToken("x200", "en")).toBe("x200");
  });
});

describe("stemTokens and prefixToken", () => {
  it("stems every token of a list", () => {
    expect(stemTokens(["сорочці", "basic", "футболки"], "uk")).toEqual([
      "сорочц",
      "basic",
      "футболк",
    ]);
  });

  it("cuts Cyrillic tokens to five letters and leaves shorter ones, Latin words and codes alone", () => {
    expect(prefixToken("сорочці")).toBe("сороч");
    expect(prefixToken("кіт")).toBe("кіт");
    expect(prefixToken("п'ять")).toBe("п'ять");
    expect(prefixToken("basic")).toBe("basic");
    expect(prefixToken("x200")).toBe("x200");
  });
});
