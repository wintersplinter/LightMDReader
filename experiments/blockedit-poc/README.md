# Block Edit — proof of concept

A standalone test of one idea: **the block the cursor is in is shown as Markdown
source; every other block is shown rendered.** Nothing here is wired into the
PWA. It is a separate folder with its own `index.html`, its own CSS, and its own
copy of the vendored parser.

## Run it

```bash
cd experiments/blockedit-poc
python -m http.server 5174
```

Then open `http://localhost:5174/`. It also works straight off `file://`, because
there is no CSP and no ES modules here — unlike the real app.

## Answering the question you asked

> do we need to define what a block is? the double enter is already something
> that is recognized in markdown, i think?

Yes and yes — but the blank line is not sufficient on its own.

- A blank line **does** separate paragraphs in Markdown, so a double enter does
  create a new block. That part of your intuition is right.
- But a blank line inside a fenced code block, or between the items of a loose
  list, does **not** start a new block. Splitting on blank lines alone would cut
  a code fence in half and produce invalid Markdown.

So the POC does not define blocks itself. It asks `markdown-it` — the parser the
app already uses — and takes the **line map** of each top-level token. A block is
one top-level Markdown construct: one paragraph, one heading, one whole list, one
whole table, one whole fence, one whole blockquote.

Per the choice made when this was built, a list is **one block**, not one block
per item.

## The safety model

You were right to worry about accidental edits. Three mechanisms, in order of
importance:

**1. The document is a partition of its own lines.**

```
seps[0] blocks[0] seps[1] blocks[1] ... blocks[n-1] seps[n]
```

Every source line lands in exactly one slot, in order. Separators keep the blank
lines verbatim. Serialising is therefore byte-identical to the input *by
construction* — not by a normalisation pass that happens to be lossless today.

**2. Identical text is never written back.**

Leaving a block compares the editor's text with the text that went in. If they
match, the function returns before touching anything: no splice, no re-parse, no
re-render of neighbours. Navigating through the whole document cannot change it,
even in principle.

**3. Structural changes are visible.**

Every commit is logged in the side panel with its kind (edited, split, merged,
removed), and an integrity read-out shows whether the document still matches the
loaded baseline. If a block edit silently ate something, you see it.

`Esc` discards the current edit outright.

## Interaction

| Action | Result |
| --- | --- |
| Click a rendered block | it becomes Markdown source, caret at the end |
| Click another block | the first one renders again |
| `Esc` | discard the edit, render again |
| Blank line inside a block | commits as two blocks |
| `Backspace` at the very start | merge into the block above |
| `Delete` at the very end | pull the next block up |
| Arrow up at the very start, arrow down at the very end | move to the neighbouring block |
| `Ctrl`/`Cmd` + `Enter` | commit and open a new empty block below |

An empty new block that is left empty is discarded — it never enters the
document.

Note one honest consequence of Markdown's own rules: merging a heading into the
paragraph above it does **not** reduce the block count, because an ATX heading
interrupts a paragraph. The heading survives as its own block. That is correct
behaviour, not a bug, but it is the kind of thing that will surprise users.

## Self-test

The **Run round-trip self-test** button checks, in the live document:

1. parse then serialise is byte-identical
2. nine tricky sources (fences with blank lines, loose lists, no trailing
   newline, empty document, runs of blank lines, tables) round-trip identically
3. entering and leaving every block leaves the source identical
4. no commits are logged while merely visiting blocks
5. `Esc` discards an edit
6. every block renders on its own without throwing

## Scope of the POC

Included on purpose:

- the real vendored `markdown-it`, plus `attrs` and `mark`
- DOMPurify sanitising, as in the app
- one custom Markdown item: the app's `((:comment:))` syntax, with its dot and
  tooltip
- one visual style only, written from scratch — the app's own cascade is
  deliberately **not** imported, so this folder stays independent

## Known limitations — read before judging the idea

These follow from the POC's simplifications, not from the concept:

- **Blocks are rendered in isolation.** Anything that spans blocks therefore
  breaks: footnote definitions, reference-style links and images defined
  elsewhere, and a list interrupted by another block. A real implementation
  would render the whole document once and map elements back to blocks via the
  `data-source-line` attribute `MDrender.js` already emits.
- **The caret always lands at the end of a clicked block.** There is no mapping
  from a position in the rendered HTML back to a position in the source. This is
  the single biggest UX gap, and the hardest part of doing this properly.
- **No cross-block selection.** You cannot drag-select from one rendered block
  into another and copy or delete.
- **Undo is per-block and dies on leaving.** The browser's native textarea undo
  is all there is; there is no document-level undo stack.
- **Arrow navigation uses absolute start and end**, not the visual first and last
  line, so on a soft-wrapped paragraph you must reach the true start or end to
  jump to a neighbour.
- **Editing a table or a long list means editing its raw source.** Correct, but
  not pleasant — a real version probably wants a different affordance for those.
