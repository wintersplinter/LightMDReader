/**
 * Copies the runtime libraries out of node_modules into ./vendor.
 *
 * The deployed app is plain static files and never installs anything, so the
 * copies in ./vendor are what actually ships. package.json still lists the
 * libraries as dependencies, which is what makes them visible to Dependabot
 * and `npm audit`.
 *
 * Usage:
 *   node scripts/vendor.mjs          refresh ./vendor from node_modules
 *   node scripts/vendor.mjs --check  fail if ./vendor is out of date
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(projectRoot, "vendor");
const manifestPath = join(vendorDir, "VERSIONS.json");

const libraries = [
  { pkg: "markdown-it", source: "dist/markdown-it.min.js", target: "markdown-it.min.js" },
  { pkg: "markdown-it-footnote", source: "dist/markdown-it-footnote.min.js", target: "markdown-it-footnote.min.js" },
  { pkg: "markdown-it-deflist", source: "dist/markdown-it-deflist.min.js", target: "markdown-it-deflist.min.js" },
  { pkg: "markdown-it-sub", source: "dist/markdown-it-sub.min.js", target: "markdown-it-sub.min.js" },
  { pkg: "markdown-it-sup", source: "dist/markdown-it-sup.min.js", target: "markdown-it-sup.min.js" },
  { pkg: "markdown-it-mark", source: "dist/markdown-it-mark.min.js", target: "markdown-it-mark.min.js" },
  { pkg: "markdown-it-attrs", source: "markdown-it-attrs.browser.js", target: "markdown-it-attrs.browser.js" },
  { pkg: "markdown-it-task-lists", source: "dist/markdown-it-task-lists.min.js", target: "markdown-it-task-lists.min.js" },
  { pkg: "dompurify", source: "dist/purify.min.js", target: "purify.min.js" },
];

const checkOnly = process.argv.includes("--check");

function sha256(buffer) {
  return `sha256-${createHash("sha256").update(buffer).digest("base64")}`;
}

async function readPackageVersion(pkg) {
  const manifest = JSON.parse(await readFile(join(projectRoot, "node_modules", pkg, "package.json"), "utf8"));
  return manifest.version;
}

async function main() {
  await mkdir(vendorDir, { recursive: true });

  const entries = {};
  const problems = [];

  for (const { pkg, source, target } of libraries) {
    const sourcePath = join(projectRoot, "node_modules", pkg, source);
    let contents;

    try {
      contents = await readFile(sourcePath);
    } catch {
      problems.push(`Missing ${pkg}/${source}. Run "npm install" first.`);
      continue;
    }

    const version = await readPackageVersion(pkg);
    const integrity = sha256(contents);
    entries[target] = { package: pkg, version, integrity };

    const targetPath = join(vendorDir, target);

    if (checkOnly) {
      let existing;

      try {
        existing = await readFile(targetPath);
      } catch {
        problems.push(`vendor/${target} is missing. Run "npm run vendor".`);
        continue;
      }

      if (sha256(existing) !== integrity) {
        problems.push(`vendor/${target} does not match ${pkg}@${version}. Run "npm run vendor".`);
      }

      continue;
    }

    await writeFile(targetPath, contents);
    console.log(`vendored ${pkg}@${version} -> vendor/${target}`);
  }

  const manifest = `${JSON.stringify({ generatedBy: "scripts/vendor.mjs", libraries: entries }, null, 2)}\n`;

  if (checkOnly) {
    const existingManifest = await readFile(manifestPath, "utf8").catch(() => "");

    if (existingManifest !== manifest) {
      problems.push('vendor/VERSIONS.json is out of date. Run "npm run vendor".');
    }

    if (problems.length) {
      problems.forEach((problem) => console.error(problem));
      process.exit(1);
    }

    console.log("vendor/ is up to date.");
    return;
  }

  if (problems.length) {
    problems.forEach((problem) => console.error(problem));
    process.exit(1);
  }

  await writeFile(manifestPath, manifest);
  console.log(`wrote ${manifestPath}`);
}

await main();
