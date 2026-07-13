import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

async function firstAccessiblePath(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;

    const accessible = await fs.access(candidate).then(() => true).catch(() => false);
    if (accessible) return candidate;
  }

  return undefined;
}

export async function getChromiumExecutablePath() {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;

  return firstAccessiblePath([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 &&
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    programFilesX86 &&
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
  ]);
}
