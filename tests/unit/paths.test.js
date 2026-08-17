import { describe, expect, it } from "vitest";

import {
  dirname,
  isRemoteResourceUrl,
  normalizePath,
  resolveRelativePath,
  safeDecodeURIComponent,
  slugifyHeading,
  splitLocalHref,
} from "../../lib/paths.js";

describe("normalizePath", () => {
  it("collapses separators, dots, and backslashes", () => {
    expect(normalizePath("a//b/./c")).toBe("a/b/c");
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
    expect(normalizePath("a/b/../c")).toBe("a/c");
  });

  it("cannot escape above the root", () => {
    expect(normalizePath("../../etc/passwd")).toBe("etc/passwd");
    expect(normalizePath("a/../../../b")).toBe("b");
  });
});

describe("dirname", () => {
  it("returns the parent path, or empty at the top level", () => {
    expect(dirname("docs/guide/intro.md")).toBe("docs/guide");
    expect(dirname("intro.md")).toBe("");
  });
});

describe("safeDecodeURIComponent", () => {
  // Regression: decodeURIComponent used to throw straight out of the render
  // pipeline, which blanked the document and, while editing, hid the editor
  // together with the unsaved text in it.
  it("returns the input unchanged instead of throwing on malformed encoding", () => {
    expect(safeDecodeURIComponent("%ZZ")).toBe("%ZZ");
    expect(safeDecodeURIComponent("%")).toBe("%");
    expect(safeDecodeURIComponent("100%-done")).toBe("100%-done");
    expect(safeDecodeURIComponent("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("still decodes valid sequences", () => {
    expect(safeDecodeURIComponent("my%20file.md")).toBe("my file.md");
    expect(safeDecodeURIComponent("caf%C3%A9.md")).toBe("café.md");
  });
});

describe("splitLocalHref", () => {
  it("separates path, query, and fragment", () => {
    expect(splitLocalHref("chapter.md#install")).toEqual({ path: "chapter.md", fragment: "install" });
    expect(splitLocalHref("chapter.md?v=2#install")).toEqual({ path: "chapter.md", fragment: "install" });
    expect(splitLocalHref("chapter.md")).toEqual({ path: "chapter.md", fragment: "" });
  });

  it("keeps fragments that contain their own hashes", () => {
    expect(splitLocalHref("a.md#one#two").fragment).toBe("one#two");
  });
});

describe("resolveRelativePath", () => {
  it("resolves relative to the containing directory", () => {
    expect(resolveRelativePath("docs/guide/intro.md", "images/x.png")).toBe("docs/guide/images/x.png");
    expect(resolveRelativePath("docs/guide/intro.md", "../shared/y.png")).toBe("docs/shared/y.png");
    expect(resolveRelativePath("intro.md", "y.png")).toBe("y.png");
  });

  it("drops the fragment so links land on the right file", () => {
    expect(resolveRelativePath("docs/a.md", "b.md#section")).toBe("docs/b.md");
  });

  it("does not throw on malformed encoding", () => {
    expect(() => resolveRelativePath("docs/a.md", "%ZZ.png")).not.toThrow();
    expect(resolveRelativePath("docs/a.md", "%ZZ.png")).toBe("docs/%ZZ.png");
  });
});

describe("slugifyHeading", () => {
  it("produces stable anchor ids", () => {
    expect(slugifyHeading("Getting Started")).toBe("getting-started");
    expect(slugifyHeading("  Multiple   Spaces  ")).toBe("multiple-spaces");
    expect(slugifyHeading("Punctuation!? Removed.")).toBe("punctuation-removed");
  });

  it("keeps letters and numbers from other scripts", () => {
    expect(slugifyHeading("Café münü")).toBe("café-münü");
    expect(slugifyHeading("第一章")).toBe("第一章");
  });
});

describe("isRemoteResourceUrl", () => {
  it("flags anything that would leave the machine", () => {
    expect(isRemoteResourceUrl("https://example.com/a.png")).toBe(true);
    expect(isRemoteResourceUrl("http://example.com/a.png")).toBe(true);
    expect(isRemoteResourceUrl("//example.com/a.png")).toBe(true);
    expect(isRemoteResourceUrl("  https://example.com/a.png  ")).toBe(true);
  });

  it("treats local and self-contained references as safe", () => {
    expect(isRemoteResourceUrl("images/a.png")).toBe(false);
    expect(isRemoteResourceUrl("./a.png")).toBe(false);
    expect(isRemoteResourceUrl("../a.png")).toBe(false);
    expect(isRemoteResourceUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isRemoteResourceUrl("blob:http://localhost/abc")).toBe(false);
    expect(isRemoteResourceUrl("")).toBe(false);
  });
});
