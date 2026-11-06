import { describe, expect, it } from "vitest";
import { contactsView } from "../lib/contacts";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { shopContacts, type ShopContacts } from "./contacts";

const none: ShopContacts = {
  phones: [],
  email: null,
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
};

describe("shop contacts (config/contacts.ts)", () => {
  it("are valid, reach nobody (unassigned +380 00 range, example.com) and have their texts in both languages", () => {
    const view = contactsView(shopContacts);
    expect(view.empty).toBe(false);
    expect(view.phones).toEqual([{ href: "tel:+380000000000", text: "+380 00 000 00 00" }]);
    expect(view.email).toEqual({ href: "mailto:shop@example.com", text: "shop@example.com" });
    for (const key of [
      view.addressKey,
      view.hoursKey,
      ...view.links.map((link) => link.labelKey),
    ]) {
      expect((uk as Record<string, string>)[key as string], String(key)).toBeTruthy();
      expect((en as Record<string, string>)[key as string], String(key)).toBeTruthy();
    }
  });

  it("is empty when nothing is set, and drops blank parts instead of showing empty labels", () => {
    expect(contactsView(none).empty).toBe(true);
    const blanks = contactsView({
      ...none,
      phones: [{ tel: "", display: " " }],
      email: "  ",
      addressKey: "",
      hoursKey: " ",
      links: [{ id: "telegram", labelKey: "contacts.links", href: "" }],
      mapHref: "",
    });
    expect(blanks).toEqual({
      phones: [],
      email: null,
      addressKey: null,
      hoursKey: null,
      links: [],
      mapHref: null,
      empty: true,
    });
    expect(contactsView({ ...none, hoursKey: "contacts.demo.hours" }).empty).toBe(false);
  });

  it("accepts https messenger and map links only (the banner link rule)", () => {
    const ok = contactsView({
      ...none,
      links: [{ id: "telegram", labelKey: "contacts.links", href: "https://t.me/example" }],
      mapHref: "https://maps.example.com/?q=1",
    });
    expect(ok.links).toEqual([
      { id: "telegram", href: "https://t.me/example", labelKey: "contacts.links" },
    ]);
    expect(ok.mapHref).toBe("https://maps.example.com/?q=1");
    for (const href of [
      "http://t.me/example",
      "javascript:alert(1)",
      "//t.me/example",
      "/contacts",
      "https://user:pass@t.me/x",
      "https:// t.me",
      "tg://resolve?domain=example",
    ]) {
      expect(
        () => contactsView({ ...none, links: [{ id: "x", labelKey: "contacts.links", href }] }),
        href,
      ).toThrow(/https/);
      expect(() => contactsView({ ...none, mapHref: href }), href).toThrow(/https/);
    }
  });

  it("refuses a repeated or malformed link id", () => {
    const link = { id: "telegram", labelKey: "contacts.links", href: "https://t.me/example" };
    expect(() => contactsView({ ...none, links: [link, link] })).toThrow(/repeated/);
    expect(() => contactsView({ ...none, links: [{ ...link, id: "Tele gram" }] })).toThrow(
      /malformed/,
    );
  });

  it("refuses a phone that is not E.164 or whose display has words, and an email that could carry more than an address", () => {
    for (const tel of ["0441234567", "+0441234567", "+38 044 123", "+380441234567;ext=1", "+1"]) {
      expect(() => contactsView({ ...none, phones: [{ tel, display: "044" }] }), tel).toThrow(
        /E\.164/,
      );
    }
    expect(() =>
      contactsView({ ...none, phones: [{ tel: "+380441234567", display: "call us" }] }),
    ).toThrow(/written number/);
    for (const email of [
      "shop@example.com?subject=x",
      "shop@example.com&cc=a@b.c",
      // Injected in the local part (review m1 of PR 232).
      "shop?subject=x@example.com",
      "shop&cc=x@example.com",
      "shop=x@example.com",
      "shop%3Fsubject%3Dx@example.com",
      "shop example@example.com",
      "shop@localhost",
      "<shop@example.com>",
      "mailto:shop@example.com",
    ]) {
      expect(() => contactsView({ ...none, email }), email).toThrow(/plain address/);
    }
    // A plus-address and dots stay valid.
    expect(contactsView({ ...none, email: "shop+orders.ua@mail.example.com" }).email).toEqual({
      href: "mailto:shop+orders.ua@mail.example.com",
      text: "shop+orders.ua@mail.example.com",
    });
  });
});
