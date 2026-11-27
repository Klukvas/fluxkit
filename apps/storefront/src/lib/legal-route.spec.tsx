import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { legalPageMetadata, legalPageRoute } from "./legal-route";

vi.mock("./public-url.server", () => ({
  publicOrigin: async () => "https://shop.example.test:8443",
}));

describe("legal route public URL", () => {
  it("renders the public host without protocol and uses the same origin for metadata", async () => {
    const props = { params: Promise.resolve({ locale: "en" }) };
    const html = renderToStaticMarkup(await legalPageRoute("terms")(props));
    expect(html).toContain("online shop shop.example.test:8443");
    expect(html).not.toContain("https://shop.example.test:8443");
    const metadata = await legalPageMetadata("terms")(props);
    expect(metadata.alternates?.canonical).toBe("https://shop.example.test:8443/en/legal/terms");
  });
});
