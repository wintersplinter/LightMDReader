# Block Edit v2 — definitions and footnotes

Working copy of the frozen `../blockedit-poc/`. Same interaction; the rendering
pipeline underneath it was replaced so that things which span blocks work.

```bash
cd experiments/blockedit-v2
python -m http.server 5174
```

Also runs from `file://`.

## What the POC got wrong

markdown-it swallows link references (`[x]: url`) and footnote definitions
(`[^a]: note`) into its `env` during the block parse. They produce **no token
and no line map**. In the POC those lines therefore fell into *separators*: they
survived a round-trip byte-for-byte, but they were invisible and completely
unreachable — you could not click them, and there was no way to edit them.

That was the real bug. The broken footnote rendering was a symptom.

## The three kinds of thing

| | Has source lines? | Rendered output | Editable |
| --- | --- | --- | --- |
| Ordinary block | yes, from a token line map | yes | yes |
| **Definition block** | yes, claimed by no token | none | **yes** |
| Footnote tail | **no** — synthesised from `env` | yes | no |

**Definition blocks.** One rule: any run of non-blank lines that no token
claimed becomes a block. It is not a footnote special case — it catches anything
markdown-it moves into `env`, including whatever a future plugin does. The line
partition is unchanged, so the round-trip guarantee still holds by construction;
non-blank leftovers simply moved from the separator bucket to the block bucket.

They are shown in place, in source order, as their own raw text at reduced
opacity (full opacity on hover and focus). Click one to edit it, empty it to
delete it, cut it and paste it elsewhere — the generated list at the bottom
renumbers itself, and an orphaned reference falls back to plain `[^label]` text.

**The footnote tail** owns no source lines, so it is not a block and is not
editable here. Clicking an entry jumps to the definition block that produced it.

A block whose rendered output is visually empty gets the same dimmed raw
treatment — which is also how a standalone `((::hidden comment::))` behaves.

## Finding hidden comments

A hidden comment renders to nothing. On its own line that is fine: the block is
visually empty, so it shows as dimmed raw source. But `((::like this::))` in the
middle of a paragraph leaves **no trace at all** — the paragraph renders normally
and there is nothing to tell you a comment is in there.

Blocks carrying one now get a hollow red ring in the left margin. Filled dot
where it stands = visible comment; hollow ring in the margin = hidden comment
somewhere in this block. Click the block (or the ring) to read it.

Both markers use the app's own comment red, `#e53935` (`.reader .md-comment-dot`
in `styles.css`). The POC had them in `--warn` orange, which is the colour this
page uses for "edited" and for warnings in the commit log — a different meaning
wearing the same colour. Comment markers now have their own token,
`--comment-red`, and stay red in both themes exactly as in the app.

The flag is not a text search over the source. The core rule that strips the
comments records the line it stripped them from, into `env.hiddenComments`, and
those lines are mapped to blocks. So a `((::…::))` inside a fenced code block is
neither stripped nor marked — it is literal text there, and the marker agrees
with what actually happened rather than with what the characters look like. A
block that *is* the hidden comment shows no ring, because its dimmed source
already says so.

## One parse, token-slice render

The whole document is parsed **once** into a shared `env`. The top-level tokens
are grouped, each group is assigned to the block whose line range contains its
start line, and each block is rendered from its own slice:

```js
md.renderer.render(slice, md.options, env)
```

Because there is only ever one parse, reference links resolve across blocks and
footnotes are numbered in document order. The self-test asserts that the
concatenated slices are identical to a plain whole-document render.

Cost is one parse plus N small renders — the same total work as one whole-document
render. Measured with this project's full plugin set: 2 KB → 2.3 ms, 22 KB →
7.2 ms, 88 KB → 22 ms, 440 KB → 104 ms. The **Render** stat in the side panel
shows the live figure.

**Invalidation is derived, never predicted.** After a commit, each block's newly
rendered HTML is compared with what is already in the DOM; only the differing
nodes are replaced. Nothing tries to work out *which* blocks a footnote edit
should have affected — blocks that changed produce different HTML and get
replaced, and blocks that did not keep their existing node, their scroll
position and their loaded images.

## The custom comment syntax moved

`((:comment:))` used to be a string substitution over the whole source before
parsing. That is no longer safe: a multi-line comment collapsing into a one-line
span shifts every line map after it, and the block splitter now depends on those
maps.

It now runs as a core rule placed after the block parse and before the inline
parse, rewriting each block's inline content. Block boundaries already exist at
that point, so it cannot move one.

(An inline ruler rule would be the textbook place, but markdown-it's `text` rule
swallows runs of non-terminator characters and `(` is not one of them, so an
inline rule on `((:` is never reached. That was tried first and silently did
nothing.)

## Self-test

**Run round-trip self-test** checks fifteen things, including:

- parse → serialise is byte-identical, on the live document and on thirteen
  tricky sources (fences with blank lines, loose lists, footnote definitions,
  reference definitions, hidden comments, empty document, no trailing newline)
- a hidden comment is flagged, a visible one is not, a plain block is not, and
  one inside a fenced code block is not
- definition lines become blocks rather than vanishing into separators
- entering and leaving every block writes nothing and logs no commit
- the token-slice render equals a plain whole-document render
- every footnote in the tail traces back to a real definition block
- a multi-line comment does not shift a block boundary

## Still open

- **The caret always lands at the end of a clicked block.** No mapping from a
  position in the rendered HTML back to a position in the source. Unchanged from
  the POC, and still the biggest UX gap.
- **No cross-block selection**, and **undo is per-block** and dies on leaving.
- **Arrow navigation uses absolute start and end**, not the visual first and
  last line.
- **A run of adjacent definition lines with no blank line between them is one
  block.** Two footnote definitions on consecutive lines are edited together.
  Splitting them properly would mean re-implementing markdown-it's definition
  parsing; putting a blank line between them is the workaround.
- **Editing a table or a long list still means editing its raw source.**
