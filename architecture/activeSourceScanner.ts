import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ACTIVE_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|css)$/;
const FORBIDDEN = /leverage|debt|accruedInterest|liquidated|borrowMoney|repayMoney|settleOneDayInterest|accrueInterest|checkLiquidation|\/api\/state|localStorage/i;

async function activeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return activeFiles(file);
    return ACTIVE_SOURCE_EXTENSION.test(entry.name) ? [file] : [];
  }));
  return nested.flat();
}

export async function findForbiddenSourceLines(roots: string[]): Promise<string[]> {
  const files = (await Promise.all(roots.map(activeFiles))).flat();
  const matches: string[] = [];
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (FORBIDDEN.test(line)) matches.push(`${path.relative(process.cwd(), file)}:${index + 1}:${line.trim()}`);
    });
  }
  return matches;
}
