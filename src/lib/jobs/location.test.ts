import { describe, expect, it } from "vitest";
import { formatLocation, normalizeCountry, parseLocation } from "./location";

// Every input below was seen in a real Greenhouse/Lever/Ashby response on 2026-10-15.
describe("parseLocation", () => {
  it.each([
    ["San Francisco, CA • New York, NY • United States", { city: "San Francisco", state: "CA", country: "US", remote: false }],
    ["London, England", { city: "London", state: "England", country: "GB", remote: false }],
    ["Berlin, Germany", { city: "Berlin", state: null, country: "DE", remote: false }],
    ["São Paulo, Brazil", { city: "São Paulo", state: null, country: "BR", remote: false }],
    ["Singapore", { city: "Singapore", state: null, country: "SG", remote: false }],
    ["Dublin", { city: "Dublin", state: null, country: "IE", remote: false }],
    ["Chicago", { city: "Chicago", state: "IL", country: "US", remote: false }],
    ["Seattle, WA", { city: "Seattle", state: "WA", country: "US", remote: false }],
    ["US-Remote", { city: null, state: null, country: "US", remote: true }],
    ["US Remote", { city: null, state: null, country: "US", remote: true }],
    ["Remote", { city: null, state: null, country: null, remote: true }],
    ["US / Canada", { city: null, state: null, country: "US", remote: false }],
    ["NYC, SF", { city: "New York", state: "NY", country: "US", remote: false }],
    ["Dublin, London", { city: "Dublin", state: null, country: "IE", remote: false }],
    ["New York, NY (HQ)", { city: "New York", state: "NY", country: "US", remote: false }],
    ["Remote (Canada)", { city: null, state: null, country: "CA", remote: true }],
    ["Europe", { city: null, state: null, country: null, remote: false }],
    ["N/A", { city: null, state: null, country: null, remote: false }],
    ["Sydney, New South Wales, Australia", { city: "Sydney", state: "New South Wales", country: "AU", remote: false }],
    ["Austin, Texas, United States", { city: "Austin", state: "TX", country: "US", remote: false }],
    ["California", { city: null, state: "CA", country: "US", remote: false }],
    ["Greater Boston Area", { city: "Boston", state: "MA", country: "US", remote: false }],
    ["San Francisco Bay Area", { city: "San Francisco", state: "CA", country: "US", remote: false }],
    ["US-Chicago, US-New York", { city: "Chicago", state: "IL", country: "US", remote: false }],
    ["US-SF-HQ, US-SEA, US-CHI, US-NYC", { city: "San Francisco", state: "CA", country: "US", remote: false }],
    ["US-CA", { city: null, state: "CA", country: "US", remote: false }],
    ["IN - Bengaluru", { city: "Bengaluru", state: "Karnataka", country: "IN", remote: false }],
    ["Japan, Tokyo", { city: "Tokyo", state: null, country: "JP", remote: false }],
    ["Ireland, Dublin", { city: "Dublin", state: null, country: "IE", remote: false }],
    ["SEA, SF, NY, Toronto", { city: "Seattle", state: "WA", country: "US", remote: false }],
    ["Luxembourg", { city: "Luxembourg", state: null, country: "LU", remote: false }],
    ["Taipei City", { city: "Taipei", state: null, country: "TW", remote: false }],
    ["Seattle, Chicago, US", { city: "Seattle", state: "WA", country: "US", remote: false }],
  ])("%s", (raw, expected) => {
    expect(parseLocation(raw)).toEqual(expected);
  });

  it("uses hints for country and remote", () => {
    expect(parseLocation("Stockholm", { country: "SE", remote: true })).toEqual({
      city: "Stockholm",
      state: null,
      country: "SE",
      remote: true,
    });
    expect(parseLocation("Taiwan (Home Mix)", { country: "TW" }).country).toBe("TW");
    expect(parseLocation(null, { country: "USA" })).toEqual({ city: null, state: null, country: "US", remote: false });
  });

  it("does not treat an unrelated 'CA' as California when it stands alone", () => {
    // Lone two-letter codes are ambiguous (CA = Canada or California); leave them unresolved.
    expect(parseLocation("CA").state).toBeNull();
  });
});

describe("normalizeCountry", () => {
  it("accepts codes, names, and aliases", () => {
    expect(normalizeCountry("USA")).toBe("US");
    expect(normalizeCountry("United Kingdom")).toBe("GB");
    expect(normalizeCountry("uk")).toBe("GB");
    expect(normalizeCountry("de")).toBe("DE");
    expect(normalizeCountry("Narnia")).toBeNull();
  });
});

describe("formatLocation", () => {
  it("formats US and non-US locations and remote", () => {
    expect(formatLocation({ city: "Chicago", state: "IL", country: "US", remote: false })).toBe("Chicago, IL");
    expect(formatLocation({ city: "Berlin", state: null, country: "DE", remote: false })).toBe("Berlin, Germany");
    expect(formatLocation({ city: null, state: null, country: "US", remote: true })).toBe("Remote · United States");
    expect(formatLocation({ city: null, state: null, country: null, remote: false }, "Somewhere")).toBe("Somewhere");
  });
});
