import path from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenSourceLines } from "./activeSourceScanner";

describe("legacy finance architecture guard", () => {
  it("keeps unsupported finance mechanics out of active application code", async () => {
    const roots = [path.resolve("src"), path.resolve("app")];
    const matches = await findForbiddenSourceLines(roots);
    expect(matches).toEqual([]);
  });
});
