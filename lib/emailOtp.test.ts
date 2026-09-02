import { describe, expect, it } from "vitest";

import { isValidEmailOneTimeCode, normalizeEmailAddress, normalizeEmailOneTimeCode } from "./emailOtp";

describe("email one-time password helpers", () => {
  it("normalizes invited email addresses", () => {
    expect(normalizeEmailAddress("  DustinFudge@Gmail.com ")).toBe("dustinfudge@gmail.com");
  });

  it("keeps only the supported code digits", () => {
    expect(normalizeEmailOneTimeCode("12 34-56 78 90")).toBe("12345678");
  });

  it("accepts six-to-eight-digit verification codes", () => {
    expect(isValidEmailOneTimeCode("123456")).toBe(true);
    expect(isValidEmailOneTimeCode("12345678")).toBe(true);
    expect(isValidEmailOneTimeCode("12345")).toBe(false);
    expect(isValidEmailOneTimeCode("123456789")).toBe(false);
  });
});
