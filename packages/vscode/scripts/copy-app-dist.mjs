import { cp, mkdir, rm, stat } from "node:fs/promises";

const appDist = new URL("../../app/dist/", import.meta.url);
const target = new URL("../media/app-dist/", import.meta.url);

async function pathExists(url) {
  try {
    await stat(url);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

if (!(await pathExists(appDist))) {
  console.error(
    "packages/app/dist is missing. Run `npm run build:web --workspace=@getpaseo/app` before building @getpaseo/vscode.",
  );
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(new URL("../media/", import.meta.url), { recursive: true });
await cp(appDist, target, { recursive: true });
