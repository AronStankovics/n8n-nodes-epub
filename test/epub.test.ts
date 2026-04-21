/* eslint-disable */
import { describe, expect, it } from 'vitest';

import { buildEpub } from '../nodes/HtmlToEpub/epub';
import type { FetchedImage } from '../nodes/HtmlToEpub/images';
import { pngPixel } from './test-data';

const decoder = new TextDecoder('utf-8');

describe('nodes/HtmlToEpub/epub.ts', () => {
	describe('buildEpub()', () => {
		function extractFile(bytes: Uint8Array, name: string): string | null {
			const nameBytes = new TextEncoder().encode(name);
			const SIG = [0x50, 0x4b, 0x03, 0x04];
			for (let i = 0; i < bytes.length - 30; i++) {
				if (
					bytes[i] === SIG[0] &&
					bytes[i + 1] === SIG[1] &&
					bytes[i + 2] === SIG[2] &&
					bytes[i + 3] === SIG[3]
				) {
					const dv = new DataView(bytes.buffer, bytes.byteOffset + i);
					const compSize = dv.getUint32(18, true);
					const nameLen = dv.getUint16(26, true);
					const extraLen = dv.getUint16(28, true);
					const entryName = decoder.decode(bytes.subarray(i + 30, i + 30 + nameLen));
					if (entryName === name) {
						const dataStart = i + 30 + nameLen + extraLen;
						return decoder.decode(bytes.subarray(dataStart, dataStart + compSize));
					}
					i = i + 30 + nameLen + extraLen + compSize - 1;
				}
			}
			if (name === 'mimetype') {
				for (let i = 0; i < bytes.length - nameBytes.length; i++) {
					let ok = true;
					for (let j = 0; j < nameBytes.length; j++) {
						if (bytes[i + j] !== nameBytes[j]) {
							ok = false;
							break;
						}
					}
					if (ok) return decoder.decode(bytes.subarray(i, i + nameBytes.length));
				}
			}
			return null;
		}

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
