import { afterEach, describe, expect, it, vi } from "vitest";
import { imageHosts } from "./image-hosts.server";

afterEach(() => vi.unstubAllEnvs());

describe("imageHosts", () => {
  it("reads the variable of the running server, on every call", () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "cdn.example.com, Images.Example.org");
    expect(imageHosts()).toEqual(["cdn.example.com", "images.example.org"]);
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "other.example.com");
    expect(imageHosts()).toEqual(["other.example.com"]);
  });

  it("allows no host when the variable is empty or unset", () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "");
    expect(imageHosts()).toEqual([]);
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", undefined);
    expect(imageHosts()).toEqual([]);
  });
});
