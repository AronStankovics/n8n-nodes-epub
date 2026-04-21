/* eslint-disable */
import { expect } from 'chai';
import { TextDecoder } from 'node:util';

import { buildEpub, htmlToXhtmlBody, xmlEscape } from '../nodes/HtmlToEpub/epub';
import type { FetchedImage } from '../nodes/HtmlToEpub/images';
import {
	htmlWithEventHandlers,
	htmlWithScripts,
	htmlWithVoidElements,
	htmlWithAmpersands,
	malformedHtml,
	pngPixel,
	simpleHtml,
} from './test-data';

const decoder = new TextDecoder('utf-8');

describe('nodes/HtmlToEpub/epub.ts', function () {
	describe('xmlEscape()', function () {
		it('should escape all five XML special characters', function () {
			expect(xmlEscape(`<a href="x">1 & 2 'q'</a>`)).to.equal(
				'&lt;a href=&quot;x&quot;&gt;1 &amp; 2 &apos;q&apos;&lt;/a&gt;',
			);
		});

		it('should double-escape already-escaped ampersands', function () {
			expect(xmlEscape('fish &amp; chips')).to.equal('fish &amp;amp; chips');
		});

		it('should return empty string unchanged', function () {
			expect(xmlEscape('')).to.equal('');
		});

		it('should leave plain text untouched', function () {
			expect(xmlEscape('hello world 123')).to.equal('hello world 123');
		});
	});

	describe('htmlToXhtmlBody()', function () {
		it('should extract the body when <body> is present', function () {
			const out = htmlToXhtmlBody(simpleHtml);
			expect(out).to.include('<h1>Hello</h1>');
			expect(out).to.include('<strong>bold</strong>');
			expect(out).to.not.include('Ignore me');
			expect(out).to.not.include('<title>');
		});

		it('should fall back to the raw html when no <body> tag exists', function () {
			const out = htmlToXhtmlBody('<p>just a paragraph</p>');
			expect(out).to.include('<p>just a paragraph</p>');
		});

		it('should slice after </head> when there is no body', function () {
			const out = htmlToXhtmlBody('<head><meta charset="utf-8"/></head><p>after</p>');
			expect(out).to.not.include('<meta');
			expect(out).to.include('<p>after</p>');
		});

		it('should strip <script>, <iframe>, <style>, and <noscript>', function () {
			const out = htmlToXhtmlBody(htmlWithScripts);
			expect(out).to.not.include('<script');
			expect(out).to.not.include("alert('xss')");
			expect(out).to.not.include('<iframe');
			expect(out).to.not.include('<style');
			expect(out).to.not.include('.evil');
			expect(out).to.include('Before');
			expect(out).to.include('Middle');
			expect(out).to.include('After');
		});

		it('should strip on* event handlers from attributes', function () {
			const out = htmlToXhtmlBody(htmlWithEventHandlers);
			expect(out).to.not.include('onclick');
			expect(out).to.not.include('onmouseover');
			expect(out).to.not.include('onload');
			expect(out).to.not.include('alert(1)');
			expect(out).to.not.include('stealCookies');
			expect(out).to.include('Click');
		});

		it('should self-close every void element', function () {
			const out = htmlToXhtmlBody(htmlWithVoidElements);
			expect(out).to.match(/<br\s*\/>/);
			expect(out).to.match(/<hr\s*\/>/);
			expect(out).to.match(/<img[^>]*\/>/);
			expect(out).to.match(/<meta[^>]*\/>/);
			expect(out).to.match(/<input[^>]*\/>/);
			expect(out).to.match(/<link[^>]*\/>/);
			expect(out).to.not.match(/<br>/);
			expect(out).to.not.match(/<hr>/);
		});

		it('should not double-close already self-closed void elements', function () {
			const out = htmlToXhtmlBody('<body><img src="x"/><br/></body>');
			expect(out).to.not.include('//');
			expect(out).to.match(/<img[^>]*\/>/);
		});

		it('should escape stray ampersands but leave existing entities alone', function () {
			const out = htmlToXhtmlBody(htmlWithAmpersands);
			expect(out).to.include('salt &amp; vinegar');
			expect(out).to.include('Fish &amp; chips');
			expect(out).to.include('&#233;');
			expect(out).to.include('&eacute;');
		});

		it('should remove HTML comments', function () {
			const out = htmlToXhtmlBody('<body><!-- hidden --><p>visible</p></body>');
			expect(out).to.not.include('hidden');
			expect(out).to.include('visible');
		});

		it('should not throw on malformed HTML', function () {
			expect(() => htmlToXhtmlBody(malformedHtml)).to.not.throw();
		});

		it('should trim whitespace from the output', function () {
			const out = htmlToXhtmlBody('<body>   <p>x</p>\n\n   </body>');
			expect(out.startsWith('<p>')).to.equal(true);
			expect(out.endsWith('</p>')).to.equal(true);
		});
	});

	describe('buildEpub()', function () {
		function extractFile(bytes: Uint8Array, name: string): string | null {
			// Locate a STORE'd file by the name and return its utf-8 decoded payload.
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
					// Skip ahead past this entry to avoid matching signatures inside payload.
					i = i + 30 + nameLen + extraLen + compSize - 1;
				}
			}
			if (name === 'mimetype') {
				// mimetype is the first entry — its exact bytes match.
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

		it('should return a Uint8Array', function () {
			const out = buildEpub(baseInput);
			expect(out).to.be.instanceOf(Uint8Array);
			expect(out.byteLength).to.be.greaterThan(0);
		});

		it('should start with a local file header signature', function () {
			const out = buildEpub(baseInput);
			expect(out[0]).to.equal(0x50);
			expect(out[1]).to.equal(0x4b);
			expect(out[2]).to.equal(0x03);
			expect(out[3]).to.equal(0x04);
		});

		it('should end with the end-of-central-directory signature', function () {
			const out = buildEpub(baseInput);
			const eocd = out.subarray(out.length - 22, out.length - 18);
			expect([...eocd]).to.deep.equal([0x50, 0x4b, 0x05, 0x06]);
		});

		it('should include a mimetype entry with the correct payload', function () {
			const out = buildEpub(baseInput);
			const mimetype = extractFile(out, 'mimetype');
			expect(mimetype).to.equal('application/epub+zip');
		});

		it('should include the META-INF/container.xml pointing at content.opf', function () {
			const out = buildEpub(baseInput);
			const container = extractFile(out, 'META-INF/container.xml');
			expect(container).to.not.be.null;
			expect(container!).to.include('full-path="OEBPS/content.opf"');
		});

		it('should include all metadata in the OPF when supplied', function () {
			const out = buildEpub({
				...baseInput,
				author: 'Jane Doe',
				publisher: 'ACME',
				description: 'A short book',
				identifier: 'abc-123',
				language: 'de',
			});
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf).to.not.be.null;
			expect(opf!).to.include('<dc:creator id="creator">Jane Doe</dc:creator>');
			expect(opf!).to.include('<dc:publisher>ACME</dc:publisher>');
			expect(opf!).to.include('<dc:description>A short book</dc:description>');
			expect(opf!).to.include('<dc:identifier id="BookId">urn:uuid:abc-123</dc:identifier>');
			expect(opf!).to.include('<dc:language>de</dc:language>');
			expect(opf!).to.include('xml:lang="de"');
		});

		it('should default to language "en" and a random UUID identifier when omitted', function () {
			const out = buildEpub(baseInput);
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).to.include('<dc:language>en</dc:language>');
			expect(opf!).to.match(/urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
		});

		it('should XML-escape the title in every place it appears', function () {
			const out = buildEpub({ ...baseInput, title: 'A & B <c>' });
			const opf = extractFile(out, 'OEBPS/content.opf');
			const ncx = extractFile(out, 'OEBPS/toc.ncx');
			const toc = extractFile(out, 'OEBPS/toc.xhtml');
			const chapter = extractFile(out, 'OEBPS/article_content.xhtml');
			for (const doc of [opf, ncx, toc, chapter]) {
				expect(doc).to.not.be.null;
				expect(doc!).to.include('A &amp; B &lt;c&gt;');
				expect(doc!).to.not.include('<c>');
			}
		});

		it('should embed the chapter HTML body in article_content.xhtml', function () {
			const out = buildEpub({ ...baseInput, html: '<body><p>chapter body</p></body>' });
			const chapter = extractFile(out, 'OEBPS/article_content.xhtml');
			expect(chapter).to.not.be.null;
			expect(chapter!).to.include('<p>chapter body</p>');
			expect(chapter!).to.include('<section epub:type="chapter">');
		});

		it('should include a byline only when an author is provided', function () {
			const withoutAuthor = buildEpub(baseInput);
			const withAuthor = buildEpub({ ...baseInput, author: 'Jane Doe' });
			expect(extractFile(withoutAuthor, 'OEBPS/article_content.xhtml')!).to.not.include('class="byline"');
			expect(extractFile(withAuthor, 'OEBPS/article_content.xhtml')!).to.include(
				'<p class="byline">By Jane Doe</p>',
			);
		});

		it('should include image manifest entries and image data when images are supplied', function () {
			const img: FetchedImage = {
				id: 'imgabc',
				localPath: 'images/imgabc.png',
				mimeType: 'image/png',
				data: new Uint8Array(pngPixel),
			};
			const out = buildEpub({ ...baseInput, images: [img] });
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).to.include(
				'<item id="imgabc" href="images/imgabc.png" media-type="image/png"/>',
			);
			// Image payload should appear as a ZIP entry too.
			expect(extractFile(out, 'OEBPS/images/imgabc.png')).to.not.be.null;
		});

		it('should include the stylesheet, toc, and ncx entries', function () {
			const out = buildEpub(baseInput);
			expect(extractFile(out, 'OEBPS/style.css')).to.include('font-family');
			const toc = extractFile(out, 'OEBPS/toc.xhtml');
			expect(toc!).to.include('Table of Contents');
			const ncx = extractFile(out, 'OEBPS/toc.ncx');
			expect(ncx!).to.include('<docTitle><text>My Book</text></docTitle>');
			expect(ncx!).to.include('<navPoint id="chapter-1" playOrder="1">');
		});

		it('should treat a whitespace-only identifier as "no identifier"', function () {
			const out = buildEpub({ ...baseInput, identifier: '   ' });
			const opf = extractFile(out, 'OEBPS/content.opf');
			expect(opf!).to.match(/urn:uuid:[0-9a-f-]{36}/);
		});
	});
});
