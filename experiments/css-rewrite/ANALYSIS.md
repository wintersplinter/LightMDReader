# CSS rewrite — analysis

Working document. Measured from commit `e072bcc`, 2026-09-11.

((::Everything here is derived by parsing the six style files with a real brace-matching reader, not by grep. Comments stripped, @media kept as context, one row per declaration. A rule inside customMarkdown.css that is style-scoped is attributed to that style, not to the base.::))

## The constraint

Structural change only. **Nothing may look different.** The check is a screenshot of every document, in every style, in every theme, on screen and in print, before and after. That oracle only works if the rewrite's diff contains no intended visual change — so any design change waits for a separate commit.

## What is actually there

Six style files, plus a base, plus a light palette, a brown palette and a print layer.

| file | declarations | selectors |
| --- | --- | --- |
| customMarkdown.css (base + Signature) | 376 | 108 |
| standard | 206 | 50 |
| studio | 246 | 53 |
| editorial | 233 | 53 |
| refined | 218 | 53 |
| graphite | 251 | 53 |
| light / brown / print | 49 / 25 / 105 | 5 / 4 / 24 |

## Finding 1 — the base is a style, not a foundation

`customMarkdown.css` holds 371 unscoped declarations. Of those:

- **85 are overridden by all five other styles.** Every style pays to undo them.
- 34 more are overridden by four of the five.
- 215 are overridden by nobody. That is the real foundation.

What the all-five list contains is exactly Signature's art direction: `h1 { display: flex; font-size: 5em }`, the `• •` dots on `h1::before/::after`, `padding: 1.2em 0.5em 0.2em 0.5em` on every heading, `text-decoration: underline` on h3 and h4, the brown heading colours, `hr::before`, the yellow `mark`.

Graphite says so out loud: *"Signature puts a brown one here; it is switched off in the reset above."*

**So: the most decorated of the six styles occupies the foundation, and the other five open by dismantling it.** Standard — the plainest style — is the worst affected, because Standard is almost entirely "undo Signature".

## Finding 2 — 22% of the style files is noise

Of the 1114 declarations written across the five style files:

- **250 (22%)** either restate a base value byte-for-byte, or exist only to reset one.
- 864 say something true about their own style.

The 250 is what a neutral foundation deletes outright.

## Finding 3 — the rewrite will not make the CSS smaller

This one is worth being blunt about, because it is the opposite of what "clean it up" usually promises.

Across all six styles there are **533 distinct (selector, property) pairs**:

- **215 (40%)** hold the same value in all six — the shared foundation.
- **318 (59%)** differ somewhere — genuine, irreducible per-style typography.

Restructured onto a neutral base, the total declaration count lands within a percent of where it is now. The 250 noise declarations go, and a similar number of things Standard currently inherits *by accident* have to become explicit.

**What improves is truthfulness, not size.** Today a reader cannot tell an intended value from an inherited accident. Afterwards every declaration is there because someone meant it.

There is a real size win available on top of this, but it is a **design** change, not a refactor: some of what the styles inherit by accident is probably unwanted, and dropping it changes pixels. That belongs to the per-style view/print/edit pass, not here.

## Finding 4 — the variation is bimodal, and that is the design

Of the 318 pairs that differ between styles:

```
declared by 6/6 styles : 156  #######################################
declared by 5/6 styles :  37  #########
declared by 4/6 styles :  18  ####
declared by 3/6 styles :   7  #
declared by 2/6 styles :   6  #
declared by 1/6 styles :  94  #######################
```

Two populations, barely anything in between:

- **156 pairs every style declares with a different value.** Body size, line height, heading scale, code padding, footnote spacing, link underline. This is one idea — *a typographic scale* — written out six times as six selector blocks.
- **94 pairs exactly one style declares.** Graphite's hairline masthead, Studio's accent bar, Editorial's drop cap. Real art direction, belonging to one style only.

The first group is what makes the files feel repetitive, and it is the group a token layer removes.

## The proposal — three layers

**1. Foundation.** The 215 declarations identical everywhere, plus document structure. No aesthetic opinions, so no style ever resets it. Signature moves out into its own file like every other style.

**2. A scale, expressed as tokens.** For the 156 shared-selector pairs, the foundation carries the *rule* once:

```css
.markdown-body h2 { font-size: var(--md-h2-size); font-weight: var(--md-h2-weight); }
```

and a style carries only *values*:

```css
html[data-document-style="studio"] .markdown-body {
  --md-h2-size: 1.55em;
  --md-h2-weight: 600;
}
```

Six selector blocks become one rule and six values. A style file stops being fifty selector blocks and becomes a legible list of what that style is. The `@media (max-width: 700px)` block — which today repeats the heading rules in all six files — becomes a redefinition of four size tokens.

**3. Per-style rules.** The ~94 single-style declarations stay as ordinary scoped rules, because they *are* specific to one style and pretending otherwise would be worse.

### What this fixes beyond tidiness

- **The specificity minefield.** A property set in one place cannot be outranked. Project memory records this trap biting three times: print token blocks needing `html[data-theme]`, the print `.reader { padding: 0 }` losing to per-style padding, and the editor preview inheriting a style's reading measure.
- **The mobile blocks.** Today an edit to a heading size has to be made twice, and it is easy to edit the unreachable copy — that has happened before.
- **Accidental inheritance becomes visible**, which is the input the later design pass needs.

## Finding 5 — some of the CSS is unreachable

Checking the fixture's coverage turned up selectors the app can never produce. Grepping
`app.js`, `MDrender.js` and `lib/` for each:

| selector | mentions in the app |
| --- | --- |
| `.table-wrapper` | 0 |
| `.callout` | 0 |
| `.markdown-alert`, `.markdown-alert-title` | 0 |
| `pre[class*="language-"]` | only the sanitizer allowlist |
| `.anchor` | the base's own comment says *"if your renderer adds them later"* |

Deleting a rule nothing can match changes no pixels, so this is safe under the constraint
and is a genuine, if small, reduction. Worth confirming each one before removal.

## The oracle

Built and validated before any code moves. `oracle/` holds it.

**144 renders**: 2 fixtures x 2 widths (1100 and 640, so the 700px mobile block is
crossed) x 2 media x 3 themes x 6 styles. `fixture.md` exercises every styled element;
`fixture-print.md` is a short document that covers the title-page edges a document with
footnotes cannot reach.

It was checked rather than assumed:

- a set against itself reports identical;
- a **0.01em** nudge to Studio's h2 was caught, and correctly isolated to Studio and to
  the wide renders only — the narrow ones legitimately did not move, because the mobile
  block overrides that value;
- a **1/255** colour change to one Graphite token was caught in all twelve Graphite renders;
- two consecutive captures of unchanged code are byte-identical, so a reported difference
  is never noise.

The baseline is captured from committed code, so it is disposable — losing it costs
minutes, not work.

## Stage 1 — what it took

Signature is now `customMarkdown.signature.css`; the base holds only what the styles agree
on. 841 lines became 681, with a 325-line style file beside it, and each of the other five
gained between 2 and 13 declarations it had been inheriting by accident.

Two rules turned out to be load-bearing, and both were found by *breaking* them first.

### Scope with `:where()`, never with a bare attribute prefix

The obvious way to move a rule out of the base is to prefix it with
`html[data-document-style="signature"]`. That adds an attribute selector's worth of
specificity, and the rule immediately starts beating things it used to lose to. **37 of the
144 renders regressed**, in three unrelated-looking ways:

- Signature's `h1` gained a 112px top margin, because the base's own
  `> *:first-child { margin-top: 0 }` reset was suddenly outranked. The same failure hit
  `li > ul` padding, `blockquote > p` margins and `hr` margins.
- Graphite lost its `kbd` and `details` backgrounds **in the light and brown themes only**,
  because `html[data-theme="light"] .markdown-body kbd` now tied on specificity and lost on
  file order.
- Studio's blockquote corners changed, from the `!important` problem below.

`:where()` contributes zero specificity, so a rule moved out of the base keeps exactly the
weight it had there and every cascade relationship survives the move untouched.

### `!important` in the base is global, not Signature's

The base's seven `border-radius: 0 !important` declarations could not be overridden by any
style's ordinary declaration — so what the styles wrote against them never took effect, and
the base's value was the one in force *everywhere*. Moving them to Signature would hand the
other five a value they have never actually shown. They stay put; retiring them is a Stage 3
job, once nothing competes.

A third, smaller trap: a media query adds no specificity, so the base's
`@media (max-width: 700px)` rules beat its main rules only by sitting later in the same
file. Move a main rule to `signature.css` and that inverts, because `signature.css` loads
afterwards — a phone would get the desktop padding. Whatever moves has to take its mobile
counterpart with it.

### Verification

Three independent checks, because a browser was not always available:

1. **Declaration equivalence** — every style computes the same set of declarations. Caught
   three parser bugs that each silently dropped rules: multi-line declarations split in
   half, multi-line *selector lists* losing every selector before the `{`, and a blank line
   inside a rule body swallowing the declaration after it.
2. **Cascade equivalence** — for all 72 combinations of style, theme, media and width, the
   winning declaration for every selector and property is unchanged, accounting for
   specificity, `!important` and file order. This is what caught the mobile-block inversion.
3. **Pixels** — the 144-render oracle.

## Open questions for Sem

1. **"The simplest style should be the default"** — two readings, possibly both wanted. (a) Standard's *values* become the base others build on. (b) The app *selects* Standard on first run, where it currently defaults to Signature. This analysis assumes a neutral foundation rather than (a): if Standard's opinions sit in the base, every other style has to undo *those*, which is the same trap one notch milder. Standard then becomes a thin file, which is the honest expression of "simplest".
2. **Scope.** Six style files plus the light, brown and print layers. `blockedit.css` is out of scope — it is affordances only and explicitly touches no document typography. `styles.css` is app chrome, also out.
3. **Seven `!important` declarations** sit in the base (`border-radius: 0 !important` on headings and blockquote). They can almost certainly go once nothing competes. Confirm before removing — they change nothing visually if the cascade is clean, but they are load-bearing today.

## Method notes

- Fonts are system stacks the container does not have, so a headless render only ever proves the fallback. That is fine for a before/after diff — the fallback is identical on both sides — but it cannot prove the real face.
- Re-stage every file at the start of a measuring round. A stale scratch copy has produced bogus numbers in this project before.
