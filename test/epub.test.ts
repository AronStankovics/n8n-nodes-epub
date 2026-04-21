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
	});
});
