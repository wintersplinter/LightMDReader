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
    "temml.min.js",
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

/**
 * The standfirst.
 *
 * These pin the decision that used to live in five stylesheets as `h1 + p`.
 * The point of moving it here is that the answer no longer depends on what
 * happens to sit next to the heading in the DOM, so the cases worth protecting
 * are the ones where something does.
 *
 * Assertions match the class without assuming attribute order:
 * `source_line_attrs` stamps data-source-line onto paragraph_open first, so the
 * tag renders as `<p data-source-line="3" class="standfirst">`. An
 * order-dependent check passes vacuously and reports nothing.
 */
describe("standfirst", () => {
  const leads = (markdown) => (renderMarkdown(markdown).match(/<p[^>]*class="[^"]*standfirst/g) || []).length;
  const leadText = (markdown) => {
    const match = renderMarkdown(markdown).match(/<p[^>]*class="[^"]*standfirst[^>]*>([\s\S]*?)<\/p>/);
    return match ? match[1].replace(/<[^>]*>/g, "").trim() : null;
  };

  it("marks the paragraph that opens a section", () => {
    expect(leadText("# Title\n\nThe lede.\n\nBody text.\n")).toBe("The lede.");
  });

  it("marks only the first paragraph", () => {
    expect(leads("# Title\n\nThe lede.\n\nBody text.\n")).toBe(1);
  });

  it("marks every h1, not only the first", () => {
    expect(leads("# A\n\nLede A.\n\n# B\n\nLede B.\n\n# C\n\nLede C.\n")).toBe(3);
  });

  it("steps over a hidden comment", () => {
    expect(leadText("# Title\n\n((::note::))\n\nThe lede.\n")).toBe("The lede.");
  });

  it("steps over a visible comment instead of marking it", () => {
    expect(leadText("# Title\n\n((:note:))\n\nThe lede.\n")).toBe("The lede.");
  });

  it("steps over several comments in a row", () => {
    expect(leadText("# Title\n\n((:a:))\n\n((:b:))\n\nThe lede.\n")).toBe("The lede.");
  });

  it("stops at a lone image rather than marking the picture", () => {
    expect(leads("# Title\n\n![alt](x.png)\n\nThe lede.\n")).toBe(0);
  });

  it("steps over a link reference definition", () => {
    expect(leadText("# Title\n\n[x]: http://example.com\n\nThe lede.\n")).toBe("The lede.");
  });

  it("keeps a comment written inside the lede", () => {
    expect(leads("# Title\n\nThe ((:note:)) lede.\n")).toBe(1);
  });

  it.each([
    ["a list", "# Title\n\n- one\n\nNot a lede.\n"],
    ["a blockquote", "# Title\n\n> quoted\n\nNot a lede.\n"],
    ["a code fence", "# Title\n\n```js\nx\n```\n\nNot a lede.\n"],
    ["a rule", "# Title\n\n---\n\nNot a lede.\n"],
    ["an h2", "# Title\n\n## Section\n\nNot a lede.\n"],
    ["an h3", "# Title\n\n### Subtitle\n\nNot a lede.\n"],
    ["a table", "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nNot a lede.\n"],
    ["an image", "# Title\n\n![alt](x.png)\n\nNot a lede.\n"],
  ])("marks nothing when a section opens with %s", (_label, markdown) => {
    expect(leads(markdown)).toBe(0);
  });

  /*
   * The rule that keeps this honest: only what a reader cannot see is stepped
   * over. Anything visible is content, and content is not a lede.
   *
   * It matters beyond tidiness. buildTitlePages() in app.js has to carry the
   * same things onto a PDF title page; if the two lists ever disagree, a
   * standfirst can exist that its title page cannot reach, and it prints
   * stranded on the following page. An earlier version stepped over images
   * here but not there, and did exactly that.
   */
  it("steps over only what is invisible in the rendered document", () => {
    const invisible = [
      "# Title\n\n((::hidden::))\n\nThe lede.\n",
      "# Title\n\n((:visible dot:))\n\nThe lede.\n",
      "# Title\n\n[ref]: http://example.com\n\nThe lede.\n",
    ];
    const visible = [
      "# Title\n\n![alt](x.png)\n\nThe lede.\n",
      "# Title\n\n- item\n\nThe lede.\n",
      "# Title\n\n> quoted\n\nThe lede.\n",
      "# Title\n\n---\n\nThe lede.\n",
    ];

    invisible.forEach((markdown) => expect(leadText(markdown)).toBe("The lede."));
    visible.forEach((markdown) => expect(leads(markdown)).toBe(0));
  });

  it("ignores an h1 nested in a blockquote", () => {
    expect(leads("> # Quoted\n>\n> Not a lede.\n")).toBe(0);
  });

  it("ignores an h1 nested in a list item", () => {
    expect(leads("- # Quoted\n\n  Not a lede.\n")).toBe(0);
  });

  it("marks nothing for a title with no body", () => {
    expect(leads("# Title\n")).toBe(0);
  });

  it("leaves paragraphs before the first h1 alone", () => {
    expect(leadText("Intro.\n\n# Title\n\nThe lede.\n")).toBe("The lede.");
  });
});
