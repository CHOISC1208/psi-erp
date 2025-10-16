import { rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outdir = resolve(projectRoot, "dist-tests");

const entryPoints = [
  resolve(projectRoot, "tests/unit/orderMetrics.test.ts"),
  resolve(projectRoot, "tests/e2e/psiMatrix.test.tsx"),
];

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  loader: {
    ".ts": "ts",
    ".tsx": "tsx",
  },
  logLevel: "info",
  external: ["react", "react-dom", "react-dom/server"],
});
