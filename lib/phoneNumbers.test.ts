import { describe, expect, it } from "vitest";

import { formatPhoneNumber } from "./phoneNumbers";

describe("formatPhoneNumber", () => {
  it("adds dashes to a ten-digit US phone number", () => {
    expect(formatPhoneNumber("4045192472")).toBe("404-519-2472");
  });

  it("keeps the country code when present", () => {
    expect(formatPhoneNumber("1 (404) 519-2472")).toBe("+1 404-519-2472");
  });

  it("preserves an unrecognized format", () => {
    expect(formatPhoneNumber("555-0123 ext. 4")).toBe("555-0123 ext. 4");
  });
});
