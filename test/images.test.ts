/* eslint-disable */
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as chai from 'chai';

import {
	extractImageUrls,
	fetchImages,
	rewriteImgSrc,
	type FetchedImage,
} from '../nodes/HtmlToEpub/images';
import {
	htmlWithImages,
	makeExecuteFunctionsMock,
	pngPixel,
	type HttpResponse,
} from './test-data';

chai.use(chaiAsPromised);

describe('nodes/HtmlToEpub/images.ts', function () {
	describe('extractImageUrls()', function () {
		it('should extract double-quoted, single-quoted, and bare <img src> values', function () {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls).to.include('https://example.com/a.jpg');
			expect(urls).to.include('https://example.com/b.png');
			expect(urls).to.include('https://example.com/c.gif');
		});

		it('should deduplicate repeated URLs', function () {
			const urls = extractImageUrls(htmlWithImages);
			const occurrences = urls.filter((u) => u === 'https://example.com/a.jpg');
			expect(occurrences).to.have.length(1);
		});

		it('should skip data: URIs', function () {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls.some((u) => u.startsWith('data:'))).to.equal(false);
		});

		it('should skip relative paths without an http(s) scheme', function () {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls).to.not.include('/local/d.png');
		});

		it('should return an empty array when there are no <img> tags', function () {
			expect(extractImageUrls('<p>text only</p>')).to.deep.equal([]);
		});

		it('should not crash on malformed <img> tags', function () {
			expect(() => extractImageUrls('<img src=')).to.not.throw();
			expect(() => extractImageUrls('<img>')).to.not.throw();
		});

		it('should support https:// URLs', function () {
			const urls = extractImageUrls('<img src="https://cdn.example/foo.jpg">');
			expect(urls).to.deep.equal(['https://cdn.example/foo.jpg']);
		});

		it('should ignore ftp:// or other non-http schemes', function () {
			const urls = extractImageUrls('<img src="ftp://example.com/x.png">');
			expect(urls).to.deep.equal([]);
		});
	});

	describe('fetchImages()', function () {
		function stubResponse(
			body: Buffer | Uint8Array,
			contentType = 'image/png',
		): HttpResponse {
			return {
				body,
				headers: { 'content-type': contentType },
			};
		}

		it('should call helpers.httpRequest with url, arraybuffer encoding, timeout, and UA', async function () {
			const { mock, calls } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel),
			});
			await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 5000,
				maxBytes: 10_000_000,
				userAgent: 'test-agent/1.0',
			});
			expect(calls.httpRequest).to.have.length(1);
			const opts = calls.httpRequest[0];
			expect(opts.url).to.equal('https://example.com/a.png');
			expect(opts.method).to.equal('GET');
			expect(opts.encoding).to.equal('arraybuffer');
			expect(opts.returnFullResponse).to.equal(true);
			expect(opts.timeout).to.equal(5000);
			expect(opts.headers).to.deep.equal({ 'User-Agent': 'test-agent/1.0' });
		});

		it('should return a Map keyed by URL with mime type inferred from content-type', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/png'),
			});
			const map = await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/a.png');
			expect(entry).to.exist;
			expect(entry!.mimeType).to.equal('image/png');
			expect(entry!.localPath).to.match(/^images\/img[0-9a-f]{32}\.png$/);
			expect(entry!.id).to.match(/^img[0-9a-f]{32}$/);
			expect(entry!.data.byteLength).to.equal(pngPixel.length);
		});

		it('should pick the extension from the URL when Content-Type is missing or generic', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'application/octet-stream'),
			});
			const map = await fetchImages(mock, ['https://example.com/foo.jpg'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/foo.jpg');
			expect(entry).to.exist;
			expect(entry!.localPath).to.match(/\.jpeg$/);
			expect(entry!.mimeType).to.equal('image/jpeg');
		});

		it('should default to jpeg when neither header nor URL give a hint', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, ''),
			});
			const map = await fetchImages(mock, ['https://example.com/noext'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/noext');
			expect(entry!.localPath).to.match(/\.jpeg$/);
		});

		it('should silently drop URLs whose request rejects', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async (options) => {
					if (options.url === 'https://example.com/bad') throw new Error('boom');
					return stubResponse(pngPixel);
				},
			});
			const map = await fetchImages(
				mock,
				['https://example.com/good', 'https://example.com/bad'],
				{ timeoutMs: 1000, maxBytes: 1_000_000, userAgent: 'ua' },
			);
			expect(map.has('https://example.com/good')).to.equal(true);
			expect(map.has('https://example.com/bad')).to.equal(false);
		});

		it('should skip responses larger than maxBytes', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(Buffer.alloc(100), 'image/png'),
			});
			const map = await fetchImages(mock, ['https://example.com/big.png'], {
				timeoutMs: 1000,
				maxBytes: 50,
				userAgent: 'ua',
			});
			expect(map.size).to.equal(0);
		});

		it('should strip content-type parameters (e.g. "image/png; charset=utf-8")', async function () {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/png; charset=utf-8'),
			});
			const map = await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(map.get('https://example.com/a.png')!.mimeType).to.equal('image/png');
		});

		it('should accept body returned as an ArrayBuffer', async function () {
			const ab = new ArrayBuffer(pngPixel.length);
			new Uint8Array(ab).set(pngPixel);
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => ({
					body: ab,
					headers: { 'content-type': 'image/png' },
				}),
			});
			const map = await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(map.get('https://example.com/a.png')!.data.byteLength).to.equal(pngPixel.length);
		});

		it('should be stable: the same URL always hashes to the same local path', async function () {
			const { mock: a } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel),
			});
			const { mock: b } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel),
			});
			const mapA = await fetchImages(a, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const mapB = await fetchImages(b, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(mapA.get('https://example.com/a.png')!.localPath).to.equal(
				mapB.get('https://example.com/a.png')!.localPath,
			);
		});

		it('should return an empty map for an empty url list', async function () {
			const { mock, calls } = makeExecuteFunctionsMock();
			const map = await fetchImages(mock, [], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(map.size).to.equal(0);
			expect(calls.httpRequest).to.have.length(0);
		});
	});

	describe('rewriteImgSrc()', function () {
		const remote = 'https://example.com/a.jpg';
		function makeMap(src: string, localPath: string): Map<string, FetchedImage> {
			const map = new Map<string, FetchedImage>();
			map.set(src, {
				id: 'imgx',
				localPath,
				mimeType: 'image/jpeg',
				data: new Uint8Array(),
			});
			return map;
		}

		it('should replace matching URLs with their local path', function () {
			const map = makeMap(remote, 'images/imgabc.jpeg');
			const out = rewriteImgSrc(`<p><img src="${remote}" alt="x"></p>`, map);
			expect(out).to.include('images/imgabc.jpeg');
			expect(out).to.not.include(remote);
		});

		it('should preserve tags whose URL was not fetched', function () {
			const map = makeMap(remote, 'images/imgabc.jpeg');
			const other = 'https://example.com/other.png';
			const out = rewriteImgSrc(`<img src="${other}">`, map);
			expect(out).to.include(other);
		});

		it('should handle quoted and bare attributes uniformly', function () {
			const map = makeMap(remote, 'local/a.jpeg');
			const html = `<img src="${remote}">|<img src='${remote}'>|<img src=${remote}>`;
			const out = rewriteImgSrc(html, map);
			const occurrences = out.split('local/a.jpeg').length - 1;
			expect(occurrences).to.equal(3);
		});

		it('should return the input unchanged when the map is empty', function () {
			const html = `<img src="${remote}">`;
			expect(rewriteImgSrc(html, new Map())).to.equal(html);
		});
	});
});
