import { readdir, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { type BuildResult, context } from "esbuild";
import svelte from "esbuild-svelte";

const filename = fileURLToPath(import.meta.url);
const outdir = join(dirname(filename), "..", "src", "fava", "static");
const entryPoints = [join(dirname(filename), "src", "app.ts")];

async function cleanup_outdir(
  result: BuildResult<{ metafile: true }>,
  extra_keep: Iterable<string> = [],
) {
  // Clean all files in outdir except the ones from this build and known static assets.
  const to_keep = new Set(
    Object.keys(result.metafile.outputs).map((p) => basename(p)),
  );
  to_keep.add("favicon.ico");
  // PWA assets: icons are hand-crafted; manifest and sw are built separately.
  for (const f of ["icon-192.png", "icon-512.png", "manifest.json"]) {
    to_keep.add(f);
  }
  for (const f of extra_keep) {
    to_keep.add(f);
  }
  const outdir_files = await readdir(outdir);
  for (const to_delete of outdir_files.filter((f) => !to_keep.has(f))) {
    console.log(`Cleaning up '${to_delete}'`);
    await unlink(join(outdir, to_delete));
  }
}

/**
 * Build the frontend using esbuild.
 * @param dev - Whether to generate sourcemaps and watch for changes.
 */
async function run_build(dev: boolean) {
  const build_hash = Date.now().toString(36);

  const ctx = await context({
    entryPoints,
    outdir,
    format: "esm",
    bundle: true,
    splitting: true,
    metafile: true,
    conditions: dev ? ["development"] : ["production"],
    external: ["fs/promises", "module"], // for web-tree-sitter
    resolveExtensions: [], // enforce explicit extensions
    loader: {
      ".wasm": "file",
      ".woff": "empty",
      ".woff2": "file",
    },
    plugins: [
      svelte({
        compilerOptions: { dev, runes: true },
      }),
    ],
    sourcemap: true,
    target: "esnext",
  });

  const sw_ctx = await context({
    entryPoints: [join(dirname(filename), "src", "sw.ts")],
    outdir,
    format: "esm",
    bundle: true,
    splitting: false,
    metafile: true,
    define: { BUILD_HASH: JSON.stringify(build_hash) },
    sourcemap: true,
    target: "esnext",
  });

  console.log(`starting build, dev=${dev.toString()}`);
  try {
    const result = await ctx.rebuild();
    const sw_result = await sw_ctx.rebuild();
    const sw_files = Object.keys(sw_result.metafile.outputs).map((p) =>
      basename(p),
    );
    await cleanup_outdir(result, sw_files);
    console.log("finished build");
  } catch (err: unknown) {
    console.error("build failed", err);
  } finally {
    await ctx.dispose();
    await sw_ctx.dispose();
  }
}

const is_main = resolve(process.argv[1] ?? "") === filename;

if (is_main) {
  const dev = process.argv.includes("--dev");

  run_build(dev).catch((e: unknown) => {
    console.error(e);
  });
}
