const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "frontend");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const jsFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) jsFiles.push(p);
  }
}
walk(path.join(root, "scripts"));

for (const file of jsFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log(`Syntax OK for ${jsFiles.length} JS files.`);

const allCode = html + "\n" + jsFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const apiCalls = [...allCode.matchAll(/window\.FOUNDIT\.(\w+)\??\.(\w+)\(/g)].map(
  (m) => `${m[1]}.${m[2]}`
);
const uniqueCalls = [...new Set(apiCalls)];

let missing = 0;
for (const call of uniqueCalls) {
  const [mod, fn] = call.split(".");
  const modFile = jsFiles.find(
    (f) =>
      path.basename(f).toLowerCase() === `${mod.toLowerCase()}.js` ||
      (mod === "router" && path.basename(f) === "main.js")
  );
  if (!modFile) {
    console.error("MISSING MODULE for call:", call);
    missing++;
    continue;
  }
  const src = fs.readFileSync(modFile, "utf8");
  if (!src.includes(fn)) {
    console.error("MISSING FUNCTION:", call, "in", modFile);
    missing++;
  }
}

if (missing > 0) process.exit(1);
console.log(`All ${uniqueCalls.length} cross-module API calls verified.`);
