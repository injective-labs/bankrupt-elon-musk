import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const forbidden = /leverage|debt|accruedInterest|liquidated|borrowMoney|repayMoney|settleOneDayInterest|accrueInterest|checkLiquidation|\/api\/state|localStorage/i;

async function activeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return activeFiles(file);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [file] : [];
  }));
  return nested.flat();
}

describe("legacy finance architecture guard", () => {
  it("keeps unsupported finance mechanics out of active application code", async () => {
    const roots = [path.resolve("src"), path.resolve("app")];
    const files = (await Promise.all(roots.map(activeFiles))).flat();
    const matches: string[] = [];

    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (forbidden.test(line)) matches.push(`${path.relative(process.cwd(), file)}:${index + 1}:${line.trim()}`);
      });
    }

    expect(matches).toEqual([]);
  });
});
