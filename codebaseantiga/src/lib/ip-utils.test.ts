import { describe, it, expect } from "vitest";
import { isValidIPv4, formatIP } from "./ip-utils";

describe("isValidIPv4", () => {
  it("accepts only the configured XX.X.X.XX and XX.X.X.XXX formats", () => {
    expect(isValidIPv4("10.1.6.57")).toBe(true);
    expect(isValidIPv4("10.1.6.215")).toBe(true);
    expect(isValidIPv4("99.9.9.99")).toBe(true);
    expect(isValidIPv4("99.9.9.255")).toBe(true);
  });

  it("rejects other IP shapes", () => {
    expect(isValidIPv4("10.1.6.7")).toBe(false);
    expect(isValidIPv4("10.12.6.57")).toBe(false);
    expect(isValidIPv4("10.1.65.57")).toBe(false);
    expect(isValidIPv4("1.1.6.57")).toBe(false);
    expect(isValidIPv4("100.1.6.57")).toBe(false);
    expect(isValidIPv4("10.1.6.2155")).toBe(false);
  });

  it("rejects invalid values and malformed input", () => {
    expect(isValidIPv4("10.1.6.256")).toBe(false);
    expect(isValidIPv4("99.9.9.999")).toBe(false);
    expect(isValidIPv4("10.1.6")).toBe(false);
    expect(isValidIPv4("10.1.6.")).toBe(false);
    expect(isValidIPv4("abc.1.6.57")).toBe(false);
    expect(isValidIPv4("")).toBe(false);
  });
});

describe("formatIP", () => {
  it("preserves valid allowed formats", () => {
    expect(formatIP("10.1.6.57")).toBe("10.1.6.57");
    expect(formatIP("10.1.6.215")).toBe("10.1.6.215");
  });

  it("limits each octet to the allowed shape while typing", () => {
    expect(formatIP("100.12.65.2155")).toBe("10.1.6.215");
    expect(formatIP("1234.1.1.1")).toBe("12.1.1.1");
    expect(formatIP("10.1.6.999")).toBe("10.1.6.255");
  });

  it("strips invalid characters and keeps partial input stable", () => {
    expect(formatIP("10.a1.b6.215")).toBe("10.1.6.215");
    expect(formatIP("10")).toBe("10");
    expect(formatIP("10.")).toBe("10.");
    expect(formatIP("10.1.6.")).toBe("10.1.6.");
  });

  it("limits to 4 octets and does not throw on edge inputs", () => {
    expect(formatIP("10.1.6.57.5")).toBe("10.1.6.57");
    ["", ".", "..", "...", "a", "abc", ".10", "10.."].forEach((input) => {
      expect(() => formatIP(input)).not.toThrow();
    });
  });
});