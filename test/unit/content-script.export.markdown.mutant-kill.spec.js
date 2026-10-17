import { describe, it, expect } from "vitest";
import "../../content/ds-selectors.js";
import "../../content/content-script.export.markdown.js";

const { parseHtmlToMarkdown, TAG_HANDLERS } = globalThis.__DS_ContentExport_markdown;

function md(html, options) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseHtmlToMarkdown(doc.body.firstElementChild, options);
}

describe("export.markdown mutant killers", () => {

    describe("bold", () => {
        it("wraps in **", () => {
            expect(md("<div><strong>hi</strong></div>")).toBe("**hi**");
        });
        it("empty when whitespace-only", () => {
            expect(md("<div><strong>   </strong></div>")).toBe("");
        });
        it("B also bold", () => {
            expect(md("<div><b>yo</b></div>")).toBe("**yo**");
        });
    });

    describe("italic", () => {
        it("wraps in *", () => {
            expect(md("<div><em>hi</em></div>")).toBe("*hi*");
        });
        it("empty when whitespace-only", () => {
            expect(md("<div><em>   </em></div>")).toBe("");
        });
        it("I also italic", () => {
            expect(md("<div><i>yo</i></div>")).toBe("*yo*");
        });
    });

    describe("code", () => {
        it("wraps inline code in backticks", () => {
            const bt = String.fromCharCode(96);
            expect(md("<div><code>foo</code></div>")).toBe(bt + "foo" + bt);
        });
        it("no backticks inside PRE", () => {
            const bt = String.fromCharCode(96);
            const r = md("<div><pre><code>raw</code></pre></div>");
            expect(r).toContain("raw");
            expect(r).not.toContain(bt + "raw" + bt);
        });
    });

    it("BR = newline", () => {
        expect(md("<div>a<br>b</div>")).toContain("a\nb");
    });

    describe("anchor", () => {
        it("markdown link", () => {
            const r = md("<div><a href=\"https://example.com\">text</a></div>");
            expect(r).toBe("[text](https://example.com/)");
        });
        it("cite hidden when forceReferences=false", () => {
            expect(md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\">1</span></a></div>", { forceReferences: false })).toBe("");
        });
        it("cite shown when forceReferences=true", () => {
            const r = md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\">1</span></a></div>", { forceReferences: true });
            expect(r).toContain("[[link-1]]");
        });
        it("absolute-position span fallback", () => {
            expect(md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\"><span style=\"position: absolute;\">42</span></span></a></div>", { forceReferences: true })).toContain("[[link-42]]");
        });
        it("empty when no number in cite", () => {
            expect(md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\">abc</span></a></div>", { forceReferences: true })).toBe("");
        });
        it("strips non-numeric", () => {
            expect(md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\">[3]</span></a></div>", { forceReferences: true })).toContain("[[link-3]]");
        });
        it("trims fallback span", () => {
            expect(md("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\"><span style=\"position: absolute;\">  7  </span></span></a></div>", { forceReferences: true })).toContain("[[link-7]]");
        });
    });

    describe("blockquote", () => {
        it("prefixes with >", () => {
            expect(md("<div><blockquote>line</blockquote></div>")).toContain("> line");
        });
        it("each line prefixed", () => {
            const r = md("<div><blockquote>a<br>b</blockquote></div>");
            expect(r).toContain("> a");
            expect(r).toContain("> b");
        });
    });

    describe("UL", () => {
        it("dash prefix", () => {
            const r = md("<div><ul><li>one</li><li>two</li></ul></div>");
            expect(r).toContain("- one");
            expect(r).toContain("- two");
        });
        it("only LI children", () => {
            const r = md("<div><ul><li>ok</li><span>no</span></ul></div>");
            expect(r).toContain("- ok");
        });
    });

    describe("OL", () => {
        it("numbers from 1", () => {
            const r = md("<div><ol><li>a</li><li>b</li><li>c</li></ol></div>");
            expect(r).toContain("1. a");
            expect(r).toContain("2. b");
            expect(r).toContain("3. c");
        });
    });

    describe("headings", () => {
        it("H1", () => expect(md("<div><h1>T</h1></div>")).toContain("# T"));
        it("H2", () => expect(md("<div><h2>X</h2></div>")).toContain("## X"));
        it("H3", () => expect(md("<div><h3>S</h3></div>")).toContain("### S"));
        it("H4", () => expect(md("<div><h4>Y</h4></div>")).toContain("#### Y"));
        it("H5", () => expect(md("<div><h5>Z</h5></div>")).toContain("##### Z"));
        it("H6", () => expect(md("<div><h6>D</h6></div>")).toContain("###### D"));
        it("empty heading", () => expect(md("<div><h2>   </h2></div>")).toBe(""));
    });

    describe("pre", () => {
        it("fenced with language", () => {
            const fence = String.fromCharCode(96, 96, 96);
            const r = md("<div><pre class=\"language-py\">x=1</pre></div>");
            expect(r).toContain(fence + "py");
            expect(r).toContain("x=1");
        });
        it("fenced no language", () => {
            const fence = String.fromCharCode(96, 96, 96);
            expect(md("<div><pre>code</pre></div>")).toContain(fence + "\n");
        });
        it("strips language- prefix", () => {
            const fence = String.fromCharCode(96, 96, 96);
            const r = md("<div><pre class=\"language-js\">x</pre></div>");
            expect(r).toContain(fence + "js");
        });
    });

    describe("table", () => {
        it("header separator data", () => {
            const r = md("<div><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></div>");
            expect(r).toContain("| A | B |");
            expect(r).toContain("|-|-|");
            expect(r).toContain("| 1 | 2 |");
        });
        it("empty for no rows", () => {
            expect(md("<div><table></table></div>")).toBe("");
        });
        it("cell newlines to spaces", () => {
            const r = md("<div><table><tr><td>a<br>b</td></tr></table></div>");
            expect(r).toContain("a b");
        });
        it("separator matches columns", () => {
            expect(md("<div><table><tr><th>X</th><th>Y</th><th>Z</th></tr></table></div>")).toContain("|-|-|-|");
        });
    });

    describe("block P/DIV", () => {
        it("empty paragraph", () => {
            expect(md("<div><p>   </p></div>")).toBe("");
        });
        it("code block container span join", () => {
            const fence = String.fromCharCode(96, 96, 96);
            const r = md("<div><div class=\"md-code-block\"><pre class=\"language-js\"><span>const</span><span> x</span></pre></div></div>");
            expect(r).toContain(fence + "js");
            expect(r).toContain("const x");
        });
        it("non-DIV not code container", () => {
            const fence = String.fromCharCode(96, 96, 96);
            expect(md("<div><span class=\"md-code-block\">text</span></div>")).not.toContain(fence);
        });
        it("code block without pre falls through", () => {
            const fence = String.fromCharCode(96, 96, 96);
            const r = md("<div><div class=\"md-code-block\">just text</div></div>");
            expect(r).not.toContain(fence);
            expect(r).toContain("just text");
        });
    });

    describe("top-level", () => {
        it("defaults forceReferences=true", () => {
            const doc = new DOMParser().parseFromString("<div><a href=\"https://x.com\"><span class=\"ds-markdown-cite\">5</span></a></div>", "text/html");
            expect(parseHtmlToMarkdown(doc.body.firstElementChild)).toContain("[[link-5]]");
        });
        it("collapses whitespace", () => {
            expect(md("<div>  a   b  </div>")).toBe("a b");
        });
        it("ignores comments", () => {
            const div = document.createElement("div");
            div.appendChild(document.createComment("hidden"));
            div.appendChild(document.createTextNode("visible"));
            expect(parseHtmlToMarkdown(div, { forceReferences: true })).toBe("visible");
        });
        it("collapses 3+ newlines", () => {
            expect(md("<div><p>a</p><p></p><p></p><p>b</p></div>")).not.toMatch(/\n{3,}/);
        });
        it("trims result", () => {
            const r = md("<div><p>text</p></div>");
            expect(r).toBe(r.trim());
        });
        it("recurses unknown tags", () => {
            expect(md("<div><section><span>deep</span></section></div>")).toContain("deep");
        });
    });

    describe("text nodes", () => {
        it("preserves space between inlines", () => {
            expect(md("<div><strong>a</strong> <em>b</em></div>")).toBe("**a** *b*");
        });
        it("collapses tabs/newlines", () => {
            expect(md("<div>a\t\n  b</div>")).toContain("a b");
        });
    });

    it("TAG_HANDLERS has all tags", () => {
        for (const t of ["BR","STRONG","B","EM","I","CODE","A","BLOCKQUOTE","UL","OL","PRE","H1","H2","H3","H4","H5","H6","TABLE","P","DIV"]) {
            expect(typeof TAG_HANDLERS[t]).toBe("function");
        }
    });

    describe("nested formatting", () => {
        it("bold with nested italic", () => {
            expect(md("<div><strong><em>both</em></strong></div>")).toBe("***both***");
        });
        it("italic with nested code", () => {
            const bt = String.fromCharCode(96);
            const r = md("<div><em><code>x</code></em></div>");
            expect(r).toContain("*");
            expect(r).toContain(bt + "x" + bt);
        });
    });

    describe("edge cases for walk", () => {
        it("text node with only spaces returns space", () => {
            const div = document.createElement("div");
            div.appendChild(document.createTextNode(" "));
            const r = parseHtmlToMarkdown(div, { forceReferences: true });
            expect(r).toBe("");
        });
        it("multiple whitespace-only text nodes", () => {
            const div = document.createElement("div");
            div.appendChild(document.createTextNode("   "));
            const r = parseHtmlToMarkdown(div, { forceReferences: true });
            expect(r).toBe("");
        });
        it("text with multiple consecutive spaces collapses to single", () => {
            const r = md("<div>a     b</div>");
            expect(r).toBe("a b");
            expect(r).not.toContain("  ");
        });
    });

    describe("list with multiple children types", () => {
        it("UL ignores non-LI and renders only LI items", () => {
            const r = md("<div><ul><li>first</li><div>ignored</div><li>second</li></ul></div>");
            expect(r).toContain("- first");
            expect(r).toContain("- second");
            expect(r).not.toMatch(/^- ignored/m);
        });
    });

    describe("table edge cases", () => {
        it("single cell table", () => {
            const r = md("<div><table><tr><td>only</td></tr></table></div>");
            expect(r).toContain("| only |");
            expect(r).toContain("|-|");
        });
        it("ignores non-TH/TD children in rows", () => {
            const r = md("<div><table><tr><th>H</th><span>skip</span></tr></table></div>");
            expect(r).toContain("| H |");
        });
    });

    describe("code block container edge cases", () => {
        it("DIV with classList containing code block class renders spans", () => {
            const fence = String.fromCharCode(96, 96, 96);
            const r = md("<div><div class=\"other md-code-block extra\"><pre class=\"language-ts\"><span>let</span><span> y</span></pre></div></div>");
            expect(r).toContain(fence + "ts");
            expect(r).toContain("let y");
        });
    });

    describe("parseHtmlToMarkdown option defaults", () => {
        it("undefined options defaults forceReferences to true", () => {
            const doc = new DOMParser().parseFromString("<div><a href=\"https://z.com\"><span class=\"ds-markdown-cite\">9</span></a></div>", "text/html");
            const r = parseHtmlToMarkdown(doc.body.firstElementChild, undefined);
            expect(r).toContain("[[link-9]]");
        });
    });
});
