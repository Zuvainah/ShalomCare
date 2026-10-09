import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist");
const paths = ["/index.html", "/offline.html", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png", "/css/style.css", "/js/app.js", "/js/backend.js"];
const assets = Object.fromEntries(await Promise.all(paths.map(async (path) => {
  const value = await readFile(resolve(root, "web", path.slice(1)));
  if (path.endsWith(".png")) return [path, "data:image/png;base64," + value.toString("base64")];
  return [path, value];
})));
const worker = await readFile(resolve(root, "worker/index.js"), "utf8");
if (!worker.includes("const assets = __ASSETS__;")) throw new Error("Worker asset placeholder is missing.");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "server"), { recursive: true });
await mkdir(resolve(output, ".openai"), { recursive: true });
await writeFile(resolve(output, "server/index.js"), worker.replace("const assets = __ASSETS__;", "const assets = " + JSON.stringify(assets) + ";"));
await writeFile(resolve(output, ".openai/hosting.json"), await readFile(resolve(root, ".openai/hosting.json")));
console.log("Built Worker and embedded ShalomCare frontend assets.");
