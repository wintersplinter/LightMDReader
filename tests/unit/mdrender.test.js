import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * MDrender.js is a browser script that configures markdown-it and publishes
 * window.renderMarkdown, so it is loaded here the way the page loads it: the
 * vendored libraries first, then the file itself, in a context that stands in
 * for `window`.
 *
 * What these tests protect is the custom comment syntax and the accuracy of
 * data-source-line. Block editing splits documents using markdown-it's line
 * maps, and the editor maps the caret to the preview with data-source-line, so
 * a line number that does not match the real file is a correctness bug, not a
 * cosmetic one.
 */
let renderMarkdown;

beforeAll(() => {
  const context = { console };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  context.Event = class { constructor(type) { this.type = type; } };
  context.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  context.dispatchEvent = () => {};
  vm.createContext(context);

  const load = (relative) => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: relative });
  };

  [
    "markdown-it.min.js",
    "markdown-it-footnote.min.js",
    "markdown-it-deflist.min.js",
    "markdown-it-sub.min.js",
    "markdown-it-sup.min.js",
    "markdown-it-mark.min.js",
    "markdown-it-attrs.browser.js",
    "markdown-it-task-lists.min.js",
  ].forEach((name) => load(`../../vendor/${name}`));

  load("../../MDrender.js");

  expect(context.markdownReady).toBe(true);
  renderMarkdown = context.renderMarkdown;
});

describe("custom comments", () => {
  it("renders a visible comment as a dot with its tooltip", () => {
    const html = renderMarkdown("text ((:a note:)) after\n");
    expect(html).toContain('class="md-comment-dot"');
    expect(html).toContain("a note");
    expect(html).not.toContain("((:");
  });

  it("renders a hidden comment as nothing", () => {
    const html = renderMarkdown("text ((::secret::)) after\n");
    expect(html).not.toContain("secret");
    expect(html).toContain("text");
    expect(html).toContain("after");
  });

  it("leaves no paragraph behind for a block that is only a hidden comment", () => {
    expect(renderMarkdown("before\n\n((::secret::))\n\nafter\n"))
      .toBe('<p data-source-line="1">before</p>\n<p data-source-line="5">after</p>\n');
  });

  it("does the same for a multi-line hidden comment", () => {
    const html = renderMarkdown("before\n\n((::secret\nover two lines::))\n\nafter\n");
    expect(html).not.toContain("<p></p>");
    expect(html).not.toContain("secret");
  });

  it("leaves a comment written inside a fenced code block alone", () => {
    // Documentation shows this syntax; it must survive as literal text.
    const html = renderMarkdown("```\n((::secret::))\n((:visible:))\n```\n");
    expect(html).toContain("((::secret::))");
    expect(html).toContain("((:visible:))");
    expect(html).not.toContain("md-comment-dot");
  });

  it("leaves a comment written in indented code alone", () => {
    expect(renderMarkdown("    ((::secret::))\n\npara\n")).toContain("((::secret::))");
  });

  it("does not treat an unclosed comment as a comment", () => {
    expect(renderMarkdown("text ((: never closed\n\nnext\n")).toContain("((: never closed");
  });

  it("ignores a comment whose delimiters are escaped", () => {
    const html = renderMarkdown("(\\(:: not a comment ::))\n");
    expect(html).toContain("not a comment");
  });

  it("handles several comments on one line", () => {
    const html = renderMarkdown("a ((:one:)) b ((:two:)) c\n");
    expect(html.match(/md-comment-dot/g)).toHaveLength(2);
  });

  it("escapes comment content rather than injecting it", () => {
    const html = renderMarkdown('text ((:<img src=x onerror="boom">:)) after\n');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("data-source-line", () => {
  const lineOf = (html, needle) => {
    const match = new RegExp(`data-source-line="(\\d+)"[^>]*>[^<]*${needle}`).exec(html);
    return match ? Number(match[1]) : null;
  };

  it("numbers plain blocks by their real line in the file", () => {
    const html = renderMarkdown("first\n\nsecond\n\nthird\n");
    expect(lineOf(html, "first")).toBe(1);
    expect(lineOf(html, "second")).toBe(3);
    expect(lineOf(html, "third")).toBe(5);
  });

  it("is not shifted by a multi-line comment above it", () => {
    // The old whole-source substitution collapsed the comment before parsing,
    // so every line number after it was reported one or more lines too low.
    const html = renderMarkdown("before\n\n((::secret\nover two lines::))\n\nafter\n");
    expect(lineOf(html, "after")).toBe(6);
  });

  it("is not shifted by a multi-line visible comment either", () => {
    const html = renderMarkdown("before\n\ntext ((:a note\nover two lines:)) end\n\nafter\n");
    expect(lineOf(html, "after")).toBe(6);
  });
});
