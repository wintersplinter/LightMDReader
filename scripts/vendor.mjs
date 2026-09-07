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
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
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
  { pkg: "temml", source: "dist/temml.min.js", target: "temml.min.js" },
  { pkg: "temml", source: "dist/Temml-Local.css", target: "Temml-Local.css" },
  { pkg: "temml", source: "dist/Temml.woff2", target: "Temml.woff2" },
];

/**
 * Mermaid is not one file. Its ESM build is a small entry that imports a large
 * shared chunk and then one chunk per diagram type, so a document with a
 * flowchart fetches roughly 720 KB instead of the 3.5 MB single-file build.
 * That only works if the chunks keep their exact relative paths, so the whole
 * directory is copied rather than named file by file.
 *
 * It is deliberately not in `libraries` above: those are the files every visit
 * loads, and none of these are fetched until a document actually contains a
 * mermaid fence.
 */
const libraryTrees = [
  {
    pkg: "mermaid",
    source: "dist/mermaid.esm.min.mjs",
    tree: "dist/chunks/mermaid.esm.min",
    target: "mermaid",
  },
];

async function collectTree(root) {
  const found = [];

  async function walk(relative) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });

    for (const entry of entries) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(next);
      } else if (next.endsWith(".mjs")) {
        // Source maps are for debugging Mermaid itself and would triple what
        // ships for no benefit here.
        found.push(next);
      }
    }
  }

  await walk("");
  return found.sort();
}

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

  for (const { pkg, source, tree, target } of libraryTrees) {
    const version = await readPackageVersion(pkg).catch(() => null);

    if (!version) {
      problems.push(`Missing ${pkg}. Run "npm install" first.`);
      continue;
    }

    const entryContents = await readFile(join(projectRoot, "node_modules", pkg, source)).catch(() => null);

    if (!entryContents) {
      problems.push(`Missing ${pkg}/${source}. Run "npm install" first.`);
      continue;
    }

    const treeRoot = join(projectRoot, "node_modules", pkg, tree);
    const files = await collectTree(treeRoot).catch(() => null);

    if (!files) {
      problems.push(`Missing ${pkg}/${tree}. Run "npm install" first.`);
      continue;
    }

    const entryName = source.split("/").pop();
    const copies = [
      { from: join(projectRoot, "node_modules", pkg, source), to: join(vendorDir, target, entryName), name: `${target}/${entryName}` },
      ...files.map((file) => ({
        from: join(treeRoot, file),
        // The entry imports these by their path relative to itself, so the
        // shape under vendor/ has to match the shape under dist/.
        to: join(vendorDir, target, "chunks", "mermaid.esm.min", file),
        name: `${target}/chunks/mermaid.esm.min/${file}`,
      })),
    ];

    let bytes = 0;

    for (const copy of copies) {
      const contents = await readFile(copy.from);

      bytes += contents.length;

      if (checkOnly) {
        const existing = await readFile(copy.to).catch(() => null);

        if (!existing) {
          problems.push(`vendor/${copy.name} is missing. Run "npm run vendor".`);
        } else if (sha256(existing) !== sha256(contents)) {
          problems.push(`vendor/${copy.name} does not match ${pkg}@${version}. Run "npm run vendor".`);
        }

        continue;
      }

      await mkdir(dirname(copy.to), { recursive: true });
      await writeFile(copy.to, contents);
    }

    entries[`${target}/`] = { package: pkg, version, files: copies.length, bytes };

    if (!checkOnly) {
      console.log(`vendored ${pkg}@${version} -> vendor/${target}/ (${copies.length} files, ${(bytes / 1048576).toFixed(1)} MB)`);
    }
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
