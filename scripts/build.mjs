import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
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
