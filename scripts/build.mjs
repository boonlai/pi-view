import { build } from "esbuild";
import { watch } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function buildPackage() {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["@earendil-works/*"],
    legalComments: "inline",
  });
  await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
  for (const name of ["image-worker.mjs", "image-codec.ts"]) {
    await copyFile(new URL(`../src/${name}`, import.meta.url), new URL(`../dist/${name}`, import.meta.url));
  }
  console.log("Built pi-view");
}

await buildPackage();
if (process.argv.includes("--watch")) {
  let timer;
  let building = false;
  let pending = false;
  const rebuild = async () => {
    if (building) { pending = true; return; }
    building = true;
    do {
      pending = false;
      try { await buildPackage(); } catch (error) { console.error(error); }
    } while (pending);
    building = false;
  };
  const watcher = watch(new URL("../src/", import.meta.url), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void rebuild(); }, 100);
  });
  const close = () => { clearTimeout(timer); watcher.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  console.log("Watching src/ for changes");
}
