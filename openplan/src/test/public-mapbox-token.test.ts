import { describe, expect, it } from "vitest";

import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";

describe("public Mapbox token helpers", () => {
  it("uses the first public pk token after trimming shell quotes", () => {
    expect(resolvePublicMapboxToken("'sk.secret-token'", '"pk.public-token"')).toBe("pk.public-token");
  });

  it("flags invalid public candidates without rejecting later valid candidates", () => {
    expect(hasInvalidPublicMapboxToken("'sk.secret-token'", '"pk.public-token"')).toBe(true);
    expect(resolvePublicMapboxToken("'sk.secret-token'", '"pk.public-token"')).toBe("pk.public-token");
  });
});
