# 1. A paragraph directly after the title

This paragraph is the standfirst. Switch styles to compare: Signature and Refined centre it, Studio, Editorial and Graphite set it larger and lighter, Standard leaves it plain.

This second paragraph is ordinary body text. Only the paragraph that opens the section is marked.

# 2. Every h1 gets one

Each `#` opens a section, and each section's opening paragraph is its standfirst — not only the first in the document.

# 3. A hidden comment in the way

((::this comment is hidden and leaves no trace::))

A hidden comment is invisible in the finished document, so the search steps over it and marks this paragraph.

# 4. A visible comment in the way

((:this comment shows as a dot:))

A visible comment is only an annotation, so the search steps over it too. This paragraph is the standfirst; the dot above is not.

# 5. A link definition in the way

[somewhere]: https://example.com

Definitions render as nothing at all, so they are stepped over as well. This paragraph is the standfirst.

# 6. An image stops the search

![A lone image is content, not a lede](../../icons/icon-192.png)

An image is something the reader can see, so it ends the search exactly as a list would. This section has no standfirst, and this paragraph is ordinary body text.

# 7. But an image with words is a real paragraph

![inline](../../icons/icon-192.png) — this paragraph holds an image *and* text, so it is a paragraph like any other and is marked as the standfirst.

# 8. A list stops the search

- Content, not an annotation.
- The section has no standfirst.

And this paragraph is ordinary body text.

# 9. Any heading stops the search

## A second-level heading

A heading opens something new, so the lede search ends there. This is true for `##` through `######` alike — a standfirst belongs directly under its own title.

# 10. The rule in one line

Only what is invisible in the finished document is stepped over. Everything a reader can see ends the search.

Try the Standfirst switch in the Style menu to turn all of this off.
