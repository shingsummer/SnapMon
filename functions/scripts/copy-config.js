// shared-config/*.json を functions/shared-config/ にコピーする。
// Cloud Functions のデプロイは functions/ 配下しか含められないため、ビルド前に必ず実行する。
// functions/shared-config/ は生成物なので git 管理しない。
const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(__dirname, "..", "..", "shared-config");
const dst = path.resolve(__dirname, "..", "shared-config");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(f, t);
    else if (entry.name.endsWith(".json")) fs.copyFileSync(f, t);
  }
}

copyDir(src, dst);
console.log(`copied shared-config -> ${path.relative(process.cwd(), dst)}`);
