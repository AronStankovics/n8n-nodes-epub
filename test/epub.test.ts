/* eslint-disable */
import { describe, expect, it } from 'vitest';

import { buildEpub } from '../nodes/HtmlToEpub/epub';
import type { FetchedImage } from '../nodes/HtmlToEpub/images';
import {
	extractZipEntry,
	htmlWithEventHandlers,
	htmlWithScripts,
	htmlWithVoidElements,
	htmlWithAmpersands,
	malformedHtml,
	pngPixel,
	simpleHtml,
} from './test-data';

describe('nodes/HtmlToEpub/epub.ts', () => {
	describe('buildEpub()', () => {
		const extractFile = extractZipEntry;

		const baseInput = {
			title: 'My Book',
			html: '<body><p>chapter body</p></body>',
		};

		it('should return a Uint8Array', () => {
			const out = buildEpub(baseInput);
			expect(out).toBeInstanceOf(Uint8Array);
			expect(out.byteLength).toBeGreaterThan(0);
		});

		it('should start with a local file header signature', () => {
			const out = buildEpub(baseInput);
			expect(out[0]).toBe(0x50);
			expect(out[1]).toBe(0x4b);
			expect(out[2]).toBe(0x03);
			expect(out[3]).toBe(0x04);
		});

		it('should end with the end-of-central-directory signature', () => {
			const out = buildEpub(baseInput);
			const eocd = out.subarray(out.length - 22, out.length - 18);
			expect([...eocd]).toEqual([0x50, 0x4b, 0x05, 0x06]);
		});

		it('should include a mimetype entry with the correct payload', () => {
			const out = buildEpub(baseInput);
			const mimetype = extractFile(out, 'mimetype');
			expect(mimetype).toBe('application/epub+zip');
		});

		it('should include the META-INF/container.xml pointing at content.opf', () => {
			const out = buildEpub(baseInput);
			const container = extractFile(out, 'META-INF/container.xml');
			expect(container).not.toBeNull();
			expect(container!).toContain('full-path="OEBPS/content.opf"');
		});

		it('should include all metadata in the OPF when supplied', () => {
			const out = buildEpub({
				...baseInput,
				author: 'Jane Doe',
				publisher: 'ACME',
				description: 'A short book',
				identifier: 'abc-123',
				language: 'de',
			});
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf).not.toBeNull();
			expect(opf!).toContain('<dc:creator id="creator">Jane Doe</dc:creator>');
			expect(opf!).toContain('<dc:publisher>ACME</dc:publisher>');
			expect(opf!).toContain('<dc:description>A short book</dc:description>');
			expect(opf!).toContain('<dc:identifier id="BookId">urn:uuid:abc-123</dc:identifier>');
			expect(opf!).toContain('<dc:language>de</dc:language>');
			expect(opf!).toContain('xml:lang="de"');
		});

		it('should default to language "en" and a random UUID identifier when omitted', () => {
			const out = buildEpub(baseInput);
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).toContain('<dc:language>en</dc:language>');
			expect(opf!).toMatch(/urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
		});

		it('should XML-escape the title in every place it appears', () => {
			const out = buildEpub({ ...baseInput, title: 'A & B <c>' });
			const opf = extractFile(out, 'OEBPS/content.opf');
			const ncx = extractFile(out, 'OEBPS/toc.ncx');
			const toc = extractFile(out, 'OEBPS/toc.xhtml');
			const chapter = extractFile(out, 'OEBPS/article_content.xhtml');
			for (const doc of [opf, ncx, toc, chapter]) {
				expect(doc).not.toBeNull();
				expect(doc!).toContain('A &amp; B &lt;c&gt;');
				expect(doc!).not.toContain('<c>');
			}
		});

		it('should embed the chapter HTML body in article_content.xhtml', () => {
			const out = buildEpub({ ...baseInput, html: '<body><p>chapter body</p></body>' });
			const chapter = extractFile(out, 'OEBPS/article_content.xhtml');
			expect(chapter).not.toBeNull();
			expect(chapter!).toContain('<p>chapter body</p>');
			expect(chapter!).toContain('<section epub:type="chapter">');
		});

		it('should include a byline only when an author is provided', () => {
			const withoutAuthor = buildEpub(baseInput);
			const withAuthor = buildEpub({ ...baseInput, author: 'Jane Doe' });
			expect(extractFile(withoutAuthor, 'OEBPS/article_content.xhtml')!).not.toContain('class="byline"');
			expect(extractFile(withAuthor, 'OEBPS/article_content.xhtml')!).toContain(
				'<p class="byline">By Jane Doe</p>',
			);
		});

		it('should include image manifest entries and image data when images are supplied', () => {
			const img: FetchedImage = {
				id: 'imgabc',
				localPath: 'images/imgabc.png',
				mimeType: 'image/png',
				data: new Uint8Array(pngPixel),
			};
			const out = buildEpub({ ...baseInput, images: [img] });
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).toContain(
				'<item id="imgabc" href="images/imgabc.png" media-type="image/png"/>',
			);
			expect(extractFile(out, 'OEBPS/images/imgabc.png')).not.toBeNull();
		});

		it('should include the stylesheet, toc, and ncx entries', () => {
			const out = buildEpub(baseInput);
			expect(extractFile(out, 'OEBPS/style.css')).toContain('font-family');
			const toc = extractFile(out, 'OEBPS/toc.xhtml');
			expect(toc!).toContain('Table of Contents');
			const ncx = extractFile(out, 'OEBPS/toc.ncx');
			expect(ncx!).toContain('<docTitle><text>My Book</text></docTitle>');
			expect(ncx!).toContain('<navPoint id="chapter-1" playOrder="1">');
		});

		it('should treat a whitespace-only identifier as "no identifier"', () => {
			const out = buildEpub({ ...baseInput, identifier: '   ' });
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).toMatch(/urn:uuid:[0-9a-f-]{36}/);
		});

		describe('custom CSS', () => {
			const customCss = 'body { font-family: Georgia, serif; } p { color: tomato; }';

			it('should emit only the default stylesheet when customCss is not supplied', () => {
				const out = buildEpub(baseInput);
				const css = extractFile(out, 'OEBPS/style.css');
				expect(css).not.toBeNull();
				expect(css!).toContain('font-family');
				expect(css!).toContain('.toc-list');
				expect(css!).not.toContain('tomato');
			});

			it('should append customCss after the default stylesheet by default', () => {
				const out = buildEpub({ ...baseInput, customCss });
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('.toc-list');
				expect(css).toContain('tomato');
				expect(css.indexOf('.toc-list')).toBeLessThan(css.indexOf('tomato'));
			});

			it('should append customCss after the default when cssMode=append', () => {
				const out = buildEpub({ ...baseInput, customCss, cssMode: 'append' });
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('.toc-list');
				expect(css).toContain('Georgia, serif');
				expect(css.indexOf('.toc-list')).toBeLessThan(css.indexOf('Georgia, serif'));
			});

			it('should drop the default stylesheet when cssMode=replace', () => {
				const out = buildEpub({ ...baseInput, customCss, cssMode: 'replace' });
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('tomato');
				expect(css).not.toContain('.toc-list');
				expect(css).not.toContain('BlinkMacSystemFont');
			});

			it('should ignore empty customCss and emit the default stylesheet', () => {
				const out = buildEpub({ ...baseInput, customCss: '', cssMode: 'replace' });
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('.toc-list');
				expect(css).toContain('BlinkMacSystemFont');
			});

			it('should treat whitespace-only customCss as unset even in replace mode', () => {
				const out = buildEpub({ ...baseInput, customCss: '   \n\t  ', cssMode: 'replace' });
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('.toc-list');
				expect(css).toContain('BlinkMacSystemFont');
			});

			it('should trim surrounding whitespace on customCss before bundling', () => {
				const out = buildEpub({
					...baseInput,
					customCss: '\n\n  p { color: red; }  \n\n',
					cssMode: 'replace',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css.startsWith('p { color: red; }')).toBe(true);
				expect(css.endsWith('\n')).toBe(true);
			});

			it('should keep the stylesheet manifest entry regardless of CSS mode', () => {
				for (const mode of ['append', 'replace'] as const) {
					const out = buildEpub({ ...baseInput, customCss, cssMode: mode });
					const opf = extractFile(out, 'OEBPS/content.opf')!;
					expect(opf).toContain('<item id="css" href="style.css" media-type="text/css"/>');
				}
			});

			it('should not double-escape CSS content (style.css is not XML-escaped)', () => {
				const out = buildEpub({
					...baseInput,
					customCss: 'a[href^="https://"] { color: green; }',
					cssMode: 'replace',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('a[href^="https://"]');
				expect(css).not.toContain('&quot;');
				expect(css).not.toContain('&amp;');
			});

			it('should hoist leading @charset above the default stylesheet in append mode', () => {
				const out = buildEpub({
					...baseInput,
					customCss: '@charset "utf-8";\nbody { color: red; }',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css.startsWith('@charset "utf-8";')).toBe(true);
				const charsetIdx = css.indexOf('@charset');
				const defaultIdx = css.indexOf('BlinkMacSystemFont');
				const userIdx = css.indexOf('color: red');
				expect(charsetIdx).toBeLessThan(defaultIdx);
				expect(defaultIdx).toBeLessThan(userIdx);
			});

			it('should hoist leading @import rules above the default stylesheet in append mode', () => {
				const out = buildEpub({
					...baseInput,
					customCss:
						'@import url("https://fonts.example.com/font.css");\nbody { font-family: MyFont; }',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				const importIdx = css.indexOf('@import');
				const defaultIdx = css.indexOf('BlinkMacSystemFont');
				const userIdx = css.indexOf('MyFont');
				expect(importIdx).toBeGreaterThanOrEqual(0);
				expect(importIdx).toBeLessThan(defaultIdx);
				expect(defaultIdx).toBeLessThan(userIdx);
			});

			it('should hoist multiple @import rules preserving their order', () => {
				const out = buildEpub({
					...baseInput,
					customCss:
						"@import 'a.css';\n@import url(b.css);\nbody { color: red; }",
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				const aIdx = css.indexOf("@import 'a.css';");
				const bIdx = css.indexOf('@import url(b.css);');
				const defaultIdx = css.indexOf('BlinkMacSystemFont');
				expect(aIdx).toBeGreaterThanOrEqual(0);
				expect(bIdx).toBeGreaterThan(aIdx);
				expect(bIdx).toBeLessThan(defaultIdx);
			});

			it('should hoist @charset before @import even when written in either order', () => {
				const out = buildEpub({
					...baseInput,
					customCss: '@import "a.css";\n@charset "utf-8";\nbody { color: red; }',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				const charsetIdx = css.indexOf('@charset "utf-8";');
				const importIdx = css.indexOf('@import "a.css";');
				const defaultIdx = css.indexOf('BlinkMacSystemFont');
				expect(charsetIdx).toBeGreaterThanOrEqual(0);
				expect(importIdx).toBeGreaterThanOrEqual(0);
				expect(charsetIdx).toBeLessThan(importIdx);
				expect(importIdx).toBeLessThan(defaultIdx);
			});

			it('should keep only the first @charset when multiple are supplied', () => {
				const out = buildEpub({
					...baseInput,
					customCss:
						'@charset "utf-8";\n@charset "iso-8859-1";\nbody { color: red; }',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css).toContain('@charset "utf-8";');
				expect(css).not.toContain('@charset "iso-8859-1";');
			});

			it('should not hoist @import that appears after other rules', () => {
				const out = buildEpub({
					...baseInput,
					customCss: 'body { color: red; }\n@import url("late.css");',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				const defaultIdx = css.indexOf('BlinkMacSystemFont');
				const lateImport = css.indexOf('@import url("late.css")');
				expect(lateImport).toBeGreaterThan(defaultIdx);
			});

			it('should leave user CSS untouched when it only contains @charset/@import rules', () => {
				const out = buildEpub({
					...baseInput,
					customCss: '@charset "utf-8";\n@import url("only.css");',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css.startsWith('@charset "utf-8";')).toBe(true);
				expect(css).toContain('@import url("only.css");');
				expect(css).toContain('BlinkMacSystemFont');
				expect(css.indexOf('@import')).toBeLessThan(css.indexOf('BlinkMacSystemFont'));
			});

			it('should not hoist at-rules when cssMode=replace (user CSS is the whole sheet)', () => {
				const out = buildEpub({
					...baseInput,
					customCss: '@import url("a.css");\nbody { color: red; }',
					cssMode: 'replace',
				});
				const css = extractFile(out, 'OEBPS/style.css')!;
				expect(css.startsWith('@import url("a.css");')).toBe(true);
				expect(css).not.toContain('BlinkMacSystemFont');
			});
		});

		it('should embed the cover page, image, and OPF metadata when input.cover is set', () => {
			const cover: FetchedImage = {
				id: 'cover-image',
				localPath: 'images/cover.png',
				mimeType: 'image/png',
				data: new Uint8Array(pngPixel),
			};
			const out = buildEpub({ ...baseInput, cover });

			expect(extractFile(out, 'OEBPS/cover.xhtml')).not.toBeNull();
			expect(extractFile(out, 'OEBPS/images/cover.png')).not.toBeNull();

			const opf = extractFile(out, 'OEBPS/content.opf')!;
			expect(opf).toContain(
				'<item id="cover-image" properties="cover-image" href="images/cover.png" media-type="image/png"/>',
			);
			expect(opf).toContain(
				'<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
			);
			expect(opf).toContain('<itemref idref="cover-page"/>');
			// EPUB 2 fallback meta so older readers still recognise the cover.
			expect(opf).toContain('<meta name="cover" content="cover-image"/>');
			expect(opf).toContain('<reference type="cover" title="Cover" href="cover.xhtml"/>');
		});

		it('should omit cover-related OPF entries when input.cover is undefined', () => {
			const out = buildEpub(baseInput);
			expect(extractFile(out, 'OEBPS/cover.xhtml')).toBeNull();
			const opf = extractFile(out, 'OEBPS/content.opf')!;
			expect(opf).not.toContain('cover-image');
			expect(opf).not.toContain('cover.xhtml');
		});

		it('should XML-escape cover.localPath and cover.mimeType in OPF attributes and cover.xhtml', () => {
			// A pathological cover that an external caller could theoretically construct.
			// Current callers build safe values, but buildEpub/EpubInput are exported.
			const cover: FetchedImage = {
				id: 'cover-image',
				localPath: `images/cover".jpg`,
				mimeType: `image/jpeg" injected="x`,
				data: new Uint8Array(pngPixel),
			};
			const out = buildEpub({ ...baseInput, cover });
			const opf = extractFile(out, 'OEBPS/content.opf')!;
			const coverXhtml = extractFile(out, 'OEBPS/cover.xhtml')!;
			for (const doc of [opf, coverXhtml]) {
				expect(doc).not.toContain('" injected="');
				expect(doc).not.toContain(`cover".jpg`);
			}
			expect(opf).toContain('&quot;');
		});

		describe('TOC from headings', () => {
			const nestedArticle = `<body>
<h1>Part One</h1>
<p>Intro.</p>
<h2>Chapter 1</h2>
<p>Text.</p>
<h2>Chapter 2</h2>
<p>Text.</p>
<h1>Part Two</h1>
<p>End.</p>
</body>`;

			it('should build a nested TOC tree from h1-h3 headings by default', () => {
				const out = buildEpub({ title: 'Book', html: nestedArticle });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;

				expect(toc).toContain('<a href="article_content.xhtml#part-one">Part One</a>');
				expect(toc).toContain('<a href="article_content.xhtml#chapter-1">Chapter 1</a>');
				expect(toc).toContain('<a href="article_content.xhtml#chapter-2">Chapter 2</a>');
				expect(toc).toContain('<a href="article_content.xhtml#part-two">Part Two</a>');

				// chapter-1 and chapter-2 are nested inside part-one, before part-two.
				const partOneIdx = toc.indexOf('#part-one');
				const chap1Idx = toc.indexOf('#chapter-1');
				const chap2Idx = toc.indexOf('#chapter-2');
				const partTwoIdx = toc.indexOf('#part-two');
				expect(partOneIdx).toBeLessThan(chap1Idx);
				expect(chap1Idx).toBeLessThan(chap2Idx);
				expect(chap2Idx).toBeLessThan(partTwoIdx);
			});

			it('should inject synthetic slug ids into id-less headings in the chapter body', () => {
				const out = buildEpub({ title: 'Book', html: nestedArticle });
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;

				expect(chapter).toContain('id="part-one"');
				expect(chapter).toContain('id="chapter-1"');
				expect(chapter).toContain('id="chapter-2"');
				expect(chapter).toContain('id="part-two"');
			});

			it('should emit ncx navPoints with monotonically increasing playOrder starting after the chapter', () => {
				const out = buildEpub({ title: 'Book', html: nestedArticle });
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;

				// chapter=1, part-one=2, chapter-1=3, chapter-2=4, part-two=5
				for (let i = 1; i <= 5; i++) {
					expect(ncx).toContain(`playOrder="${i}"`);
				}
				expect(ncx).toContain('<content src="article_content.xhtml#part-one"/>');
				expect(ncx).toContain('<content src="article_content.xhtml#chapter-1"/>');
				expect(ncx).toContain('<content src="article_content.xhtml#chapter-2"/>');
				expect(ncx).toContain('<content src="article_content.xhtml#part-two"/>');
			});

			it('should set dtb:depth to 1 + tree depth', () => {
				// Tree is h1 -> [h2, h2], h1 → depth 2 → dtb:depth 3.
				const out = buildEpub({ title: 'Book', html: nestedArticle });
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;
				expect(ncx).toContain('<meta name="dtb:depth" content="3"/>');
			});

			it('should extend dtb:depth to 4 when h3 is present', () => {
				const html = '<body><h1>A</h1><h2>B</h2><h3>C</h3></body>';
				const out = buildEpub({ title: 'Book', html });
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;
				expect(ncx).toContain('<meta name="dtb:depth" content="4"/>');
			});

			it('should skip extraction and id injection when generateTocFromHeadings is false', () => {
				const out = buildEpub({
					title: 'Book',
					html: nestedArticle,
					generateTocFromHeadings: false,
				});
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;

				expect(chapter).not.toContain('id="part-one"');
				expect(chapter).not.toContain('id="chapter-1"');
				expect(toc).not.toContain('#part-one');
				expect(toc).not.toContain('#chapter-1');
				expect(ncx).toContain('<meta name="dtb:depth" content="1"/>');
				expect(ncx).not.toContain('<content src="article_content.xhtml#');
			});

			it('should preserve pre-existing double-quoted heading ids', () => {
				const html = '<body><h1 id="intro">Intro</h1></body>';
				const out = buildEpub({ title: 'Book', html });
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;

				expect(chapter).toContain('id="intro"');
				// No fallback slug is emitted alongside.
				expect(chapter).not.toContain('id="intro-2"');
				expect(toc).toContain('href="article_content.xhtml#intro"');
			});

			it('should preserve pre-existing single-quoted heading ids', () => {
				const html = "<body><h1 id='summary'>Summary</h1></body>";
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				expect(toc).toContain('href="article_content.xhtml#summary"');
			});

			it('should disambiguate duplicate heading text with numeric suffixes', () => {
				const html = '<body><h1>Part</h1><h1>Part</h1><h1>Part</h1></body>';
				const out = buildEpub({ title: 'Book', html });
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;

				expect(chapter).toContain('id="part"');
				expect(chapter).toContain('id="part-2"');
				expect(chapter).toContain('id="part-3"');
				expect(toc).toContain('#part"');
				expect(toc).toContain('#part-2"');
				expect(toc).toContain('#part-3"');
			});

			it('should strip inline markup from TOC labels while keeping it in the chapter body', () => {
				const html = '<body><h1>Intro <em>matters</em></h1></body>';
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;

				// Label is plain text in the TOC.
				expect(toc).toContain('>Intro matters</a>');
				expect(toc).not.toContain('>Intro <em>matters');
				// Slug is derived from the plain-text label.
				expect(toc).toContain('href="article_content.xhtml#intro-matters"');
				// Chapter body still contains the original inline tag.
				expect(chapter).toContain('<em>matters</em>');
			});

			it('should decode HTML entities for slug generation and XML-escape the TOC label', () => {
				const html = '<body><h1>Fish &amp; Chips</h1></body>';
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;

				// "&amp;" decoded to "&", then slugify strips it → "fish-chips".
				expect(toc).toContain('href="article_content.xhtml#fish-chips"');
				// Label is re-escaped for XHTML output.
				expect(toc).toContain('>Fish &amp; Chips</a>');
			});

			it('should detect uppercase heading tags', () => {
				const html = '<body><H1>Bold Header</H1></body>';
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				expect(toc).toContain('href="article_content.xhtml#bold-header"');
			});

			it('should ignore h4-h6 tags', () => {
				const html = '<body><h1>Main</h1><h4>Not in TOC</h4><h5>Also not</h5></body>';
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;

				expect(toc).toContain('href="article_content.xhtml#main"');
				expect(toc).not.toContain('Not in TOC');
				expect(toc).not.toContain('Also not');
				expect(ncx).not.toContain('#not-in-toc');
			});

			it('should emit only the single chapter entry when the input contains no headings', () => {
				const html = '<body><p>just a paragraph</p></body>';
				const out = buildEpub({ title: 'Book', html });
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;
				const ncx = extractFile(out, 'OEBPS/toc.ncx')!;

				expect(toc).toContain('<a href="article_content.xhtml">1. Book</a>');
				expect(toc).not.toContain('article_content.xhtml#');
				expect(ncx).toContain('<meta name="dtb:depth" content="1"/>');
				expect(ncx).not.toContain('<content src="article_content.xhtml#');
			});

			it('should fall back to heading-N ids when heading text has no alphanumeric characters', () => {
				// em-dashes and punctuation are stripped; slugify returns "", so the
				// generator falls back to a synthetic heading-N id.
				const html = '<body><h1>———</h1><h1>!?!</h1></body>';
				const out = buildEpub({ title: 'Book', html });
				const chapter = extractFile(out, 'OEBPS/article_content.xhtml')!;
				const toc = extractFile(out, 'OEBPS/toc.xhtml')!;

				expect(chapter).toContain('id="heading-1"');
				expect(chapter).toContain('id="heading-2"');
				expect(toc).toContain('href="article_content.xhtml#heading-1"');
				expect(toc).toContain('href="article_content.xhtml#heading-2"');
			});
		});
	});
});
