// Собирает Next в автономном режиме и копирует результат в desktop/app
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = path.join(root, "web");
const out = path.join(root, "desktop", "next-app");

console.log("> next build");
execSync("npm run build", { cwd: web, stdio: "inherit" });

fs.rmSync(out, { recursive: true, force: true });
const standalone = path.join(web, ".next", "standalone");
// при turbopack.root = web структура: standalone/{server.js, node_modules, .next}
fs.cpSync(standalone, out, { recursive: true });
fs.cpSync(path.join(web, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(web, "public"))) fs.cpSync(path.join(web, "public"), path.join(out, "public"), { recursive: true });
// .env.local в сборку не копируем: токен задаётся в настройках приложения
for (const f of fs.readdirSync(out)) if (f.startsWith(".env")) fs.rmSync(path.join(out, f));
console.log("app prepared at", out, "server.js exists:", fs.existsSync(path.join(out, "server.js")));
