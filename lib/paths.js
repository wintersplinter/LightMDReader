/**
 * Path and heading helpers for folder mode.
 *
 * Everything here is pure and free of DOM access so that it can be unit
 * tested directly. The important property is that no function throws on
 * malformed input: a bad link in a document must affect that link only, never
 * the surrounding render.
 */

export function normalizePath(path) {
  const parts = [];

  String(path ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .forEach((part) => {
      if (!part || part === ".") return;

      if (part === "..") {
        parts.pop();
        return;
      }

      parts.push(part);
    });

  return parts.join("/");
}

export function dirname(path) {
  const index = String(path ?? "").lastIndexOf("/");

  return index >= 0 ? String(path).slice(0, index) : "";
}

/**
 * decodeURIComponent throws a URIError on sequences such as "%ZZ" or a lone
 * "%". Hand-written markdown contains those regularly, so decoding failure
 * falls back to the original text instead of aborting the caller.
 */
export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits "chapter.md?x=1#section" into its path and fragment. */
export function splitLocalHref(href) {
  const value = String(href ?? "");
  const hashIndex = value.indexOf("#");
  const fragment = hashIndex >= 0 ? value.slice(hashIndex + 1) : "";
  const beforeFragment = hashIndex >= 0 ? value.slice(0, hashIndex) : value;

  return { path: beforeFragment.split("?")[0], fragment };
}

export function resolveRelativePath(fromPath, targetPath) {
  const decodedTarget = safeDecodeURIComponent(splitLocalHref(targetPath).path);
  const basePath = dirname(fromPath);

  return normalizePath(basePath ? `${basePath}/${decodedTarget}` : decodedTarget);
}

export function slugifyHeading(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** True for anything that would cause a network request to another origin. */
export function isRemoteResourceUrl(value) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) return false;
  if (/^(?:data|blob):/i.test(trimmed)) return false;

  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed);
}
