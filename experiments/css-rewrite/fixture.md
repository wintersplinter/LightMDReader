# Fixture — a document that exercises every styled element

The standfirst. Every element the six style files touch appears somewhere below, so a
screenshot of this document in one style is a complete picture of that style.

A comment lives here ((:a visible comment, which renders as a dot with a tooltip:)) inside a
sentence, and a hidden one follows it. ((::this one leaves no trace at all::))

Ordinary body text for comparison, with **strong**, *emphasis*, `inline code`, a
[link](https://example.com), ~~strikethrough~~, ==marked text==, H~2~O, x^2^, <small>small
text</small>, <kbd>Ctrl</kbd>+<kbd>S</kbd>, and <del>deleted</del> beside <s>struck</s>.

## Second level heading

A paragraph under an h2, to fix the spacing between them.

### Third level heading

A paragraph under an h3.

#### Fourth level heading

A paragraph under an h4.

##### Fifth level heading

A paragraph under an h5.

###### Sixth level heading

A paragraph under an h6.

## Lists

- First item at depth one
- Second item, long enough to wrap onto a second line so the hanging marker and the text
  indent can both be judged against the paragraph edge
  - Nested item at depth two
  - Another at depth two
    - Depth three
- Fourth item

1. Ordered, first
2. Ordered, second
   1. Nested ordered
   2. And another
3. Ordered, third

- [ ] An unchecked task
- [x] A checked task, which some styles colour differently

## Quotation, rule and code

> A blockquote, long enough to wrap, so its left border, padding and colour can all be
> seen against the body text beside it.
>
> A second paragraph inside the same quotation.

---

```js
// A fenced code block, wide enough to need a horizontal scrollbar in a narrow pane
const scale = { h1: "2.4em", h2: "1.55em", h3: "1.22em", h4: "1em", h5: "0.9em" };
export function measure(style) { return Object.entries(scale).map(([k, v]) => [k, v]); }
```

    An indented code block, which is a different element path from a fenced one.

## A table

| Left | Centre | Right | Notes |
| :--- | :----: | ----: | :---- |
| one | two | 3 | first row |
| four | five | 6 | second row, striped in some styles |
| seven | eight | 9 | third row |

## Definitions

Term one
: The definition of the first term.

Term two
: The definition of the second term, long enough to wrap onto another line.

## A figure

![A plain image, which markdown wraps in a paragraph](../../icons/icon-192.png)

<figure>
  <img src="../../icons/icon-192.png" alt="An image inside a real figure element">
  <figcaption>A figcaption, which several styles set smaller and dimmer.</figcaption>
</figure>

Raw inline HTML that markdown never emits on its own: <b>bold b</b> and <i>italic i</i>,
which some styles treat differently from <strong>strong</strong> and <em>em</em>.

## Disclosure

<details>
<summary>A summary that opens a disclosure</summary>

Content inside the disclosure, which several styles give a border and a background.

</details>

## Footnotes

A sentence carrying a footnote reference.[^one] And a second one.[^two]

[^one]: The first footnote, which lands in the footnote list at the end.
[^two]: The second footnote.

# A second h1, to check every section opens the same way

Its own standfirst, so multi-section documents are covered too.

Body text after the second section's standfirst.

# A closing title, with nothing after it
