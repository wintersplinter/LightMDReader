more info at https://www.markdownguide.org/basic-syntax/  
\* some elements that are supported here are custom markdown specifically for this application
### ### Heading 3  (headings can be from 1 to 6)

double spaces⎵ ⎵    
for new line

double enter↲  
↲  
for new paragraph

3 dashes (\-\-\-)
↲  
\-\-\- makes a horizontal separator  
↲


\*\***Bold text**\*\*  
\__italic text_\_.   
\=\===Highlighted text==\=\=  
\~\~~~Strikethrough text~~\~\~  
\~~subscript~\~  
\^^superscript^\^

\[[Inline link](https://example.com)](https://example.com)  
\[[Link with title](https://example.com "This is a title")](https://example.com "This is a title")  
\[[Reference style link][1]]\[1\]  -- -- needs: `[1]: https://example.com` elsewhere in the document  
\[[ID link](#custom-id)\](#custom-id)  -- -- needs: `{#custom-id}` elsewhere in the document  
text \[^footnotelabel] [^footnotelabel]  -- -- needs: `[^footnotelabel]: footnote text` elsewhere in the document  

[^footnotelabel]: This is the footnote with a [link][1] in it

[1]: https://example.com
{#custom-id2}

\``Inline code`\`  
> \> blockquote  
> > \> \> nested blockquote  

```python
` ` `python
# Python code block
def use(backticks):
    return f"use 3 {backticks} without spaces inbetween!"
` `‎ `
```

unordered list:
- \- unordered list item
  - \- nested unordered list item

ordered list:
1. ordered list item
   1. ordered ordered item  
- [x] - [x] Completed task
- [ ] - [ ] Incomplete task


![Alt Text](  
![Placeholder image](https://picsum.photos/800/400 "Random placeholder")  
)

term
: \: definition

| \| table header 1 \|   | table header2 \| |
| --------- | ----------- |
| \| --------- \| (separator) |  ----------- \| |
| \| item 1 \| | property 1 \| |
| \| item 2 \| | property 2 \| |

in document comment with tooltip -> ((: ((: this is visible in the tooltip⎵ ⎵   
this is also visible in the tooltip \:\)\) :))  
 
in document comment without tooltip:  
(\(:: this is not visible in  
the rendered document ::)) 