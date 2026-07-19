import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findForbiddenSourceLines } from "./activeSourceScanner";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("active source scanner", () => {
  it("detects forbidden terms in JavaScript module sources", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "finance-guard-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "legacy.js"), "export const forbidden = 'debt';\n");
    await writeFile(path.join(directory, "legacy.mjs"), "export const endpoint = '/api/state';\n");

    const matches = await findForbiddenSourceLines([directory]);

    expect(matches).toHaveLength(2);
    expect(matches.some((match) => match.includes("legacy.js"))).toBe(true);
    expect(matches.some((match) => match.includes("legacy.mjs"))).toBe(true);
  });
});
