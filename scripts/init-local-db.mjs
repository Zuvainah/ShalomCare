import { mkdir, readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = resolve(process.argv[2] || resolve(root, "local.sqlite"));
await mkdir(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
try {
  for (const migration of (await readdir(resolve(root, "drizzle"))).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(await readFile(resolve(root, "drizzle", migration), "utf8"));
  }
  db.exec("PRAGMA optimize");
  console.log("Initialized local SQLite database at " + file);
} finally {
  db.close();
}
