// Verify JS syntax, index.html references, cross-module calls, and secret hygiene
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "frontend");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const jsFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (full.endsWith(".js")) jsFiles.push(full);
  }
}

walk(path.join(root, "scripts"));

for (const file of jsFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log(`Syntax OK for all ${jsFiles.length} JS files.`);

// Verify local <script> tags exist on disk
const scriptRefs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((src) => !/^https?:\/\//i.test(src));

for (const ref of scriptRefs) {
  const target = path.join(root, ref);
  if (!fs.existsSync(target)) {
    throw new Error(`Missing script referenced in index.html: ${ref}`);
  }
}
console.log(`Verified ${scriptRefs.length} local <script> references in index.html.`);

// Verify local <link> stylesheets exist on disk
const cssRefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((href) => !/^https?:\/\//i.test(href));

for (const ref of cssRefs) {
  const target = path.join(root, ref);
  if (!fs.existsSync(target)) {
    throw new Error(`Missing stylesheet referenced in index.html: ${ref}`);
  }
}
console.log(`Verified ${cssRefs.length} local <link> stylesheet references in index.html.`);

// Verify every window.FOUNDIT.<module>.<method> call resolves
const combined = html + "\n" + jsFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const calls = [...combined.matchAll(/window\.FOUNDIT\.(\w+)\??\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
const uniqueCalls = [...new Set(calls)];

for (const call of uniqueCalls) {
  const [mod, fn] = call.split(".");
  const modFile = jsFiles.find(
    (f) => path.basename(f, ".js").toLowerCase() === mod.toLowerCase() || (mod === "router" && path.basename(f) === "main.js")
  );
  if (!modFile) {
    throw new Error(`Missing module for call window.FOUNDIT.${call}`);
  }
  const src = fs.readFileSync(modFile, "utf8");
  if (!src.includes(fn)) {
    throw new Error(`Missing function '${fn}' in ${modFile}`);
  }
}
console.log(`Verified ${uniqueCalls.length} unique window.FOUNDIT.* API calls.`);

// Secret hygiene check: ensure no service_role / sb_secret appears in frontend/
for (const file of [path.join(root, "index.html"), ...jsFiles]) {
  const text = fs.readFileSync(file, "utf8");
  if (/sb_secret_|"role"\s*:\s*"service_role"|service_role/i.test(text)) {
    throw new Error(`Forbidden secret/service_role reference in frontend file: ${file}`);
  }
}
console.log("Secret hygiene OK: no service-role keys in frontend/.");
