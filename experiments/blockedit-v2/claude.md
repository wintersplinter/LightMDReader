This is the working copy of the block-edit experiment. It is editable.

Its frozen ancestor is `../blockedit-poc/` — never edit that one; copy from it instead.

Solved here (see README.md):
- definition blocks: link references and footnote definitions have no token and
  no line map, so they used to fall into separators and were unreachable
- one parse of the whole document, then a token-slice render per block, so
  reference links resolve across blocks and footnotes number document-wide
- the footnote tail as a derived, non-editable region that traces back to its
  definition block
- the custom comment syntax moved out of the pre-parse string pass, which used
  to shift line maps

The block model itself is NOT in this folder. It is `lib/blockModel.js`, unit
tested in `tests/unit/blockModel.test.js` (`npm test`). Change it there, not here.
This page imports it, so it must be served from the repo root, not opened from disk.

The safety guarantees must survive any further change:
- the document stays a strict line partition (`seps[0] blocks[0] seps[1] ...`)
- identical text is never written back on leaving a block
- invalidation is derived by comparing rendered HTML, never predicted from what
  was edited
- the self-test button must keep passing
