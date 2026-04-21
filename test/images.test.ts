/* eslint-disable */
import { describe, expect, it } from 'vitest';

import {
	coverFromBinary,
	extractImageUrls,
	fetchCoverImage,
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

describe('nodes/HtmlToEpub/images.ts', () => {
	describe('extractImageUrls()', () => {
		it('should extract double-quoted, single-quoted, and bare <img src> values', () => {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls).toContain('https://example.com/a.jpg');
			expect(urls).toContain('https://example.com/b.png');
			expect(urls).toContain('https://example.com/c.gif');
		});

		it('should deduplicate repeated URLs', () => {
			const urls = extractImageUrls(htmlWithImages);
			const occurrences = urls.filter((u) => u === 'https://example.com/a.jpg');
			expect(occurrences).toHaveLength(1);
		});

		it('should skip data: URIs', () => {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls.some((u) => u.startsWith('data:'))).toBe(false);
		});

		it('should skip relative paths without an http(s) scheme', () => {
			const urls = extractImageUrls(htmlWithImages);
			expect(urls).not.toContain('/local/d.png');
		});

		it('should return an empty array when there are no <img> tags', () => {
			expect(extractImageUrls('<p>text only</p>')).toEqual([]);
		});

		it('should not crash on malformed <img> tags', () => {
			expect(() => extractImageUrls('<img src=')).not.toThrow();
			expect(() => extractImageUrls('<img>')).not.toThrow();
		});

		it('should support https:// URLs', () => {
			const urls = extractImageUrls('<img src="https://cdn.example/foo.jpg">');
			expect(urls).toEqual(['https://cdn.example/foo.jpg']);
		});

		it('should ignore ftp:// or other non-http schemes', () => {
			const urls = extractImageUrls('<img src="ftp://example.com/x.png">');
			expect(urls).toEqual([]);
		});
	});

	describe('fetchImages()', () => {
		function stubResponse(
			body: Buffer | Uint8Array,
			contentType = 'image/png',
		): HttpResponse {
			return {
				body,
				headers: { 'content-type': contentType },
			};
		}

		it('should call helpers.httpRequest with url, arraybuffer encoding, timeout, and UA', async () => {
			const { mock, calls } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel),
			});
			await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 5000,
				maxBytes: 10_000_000,
				userAgent: 'test-agent/1.0',
			});
			expect(calls.httpRequest).toHaveLength(1);
			const opts = calls.httpRequest[0];
			expect(opts.url).toBe('https://example.com/a.png');
			expect(opts.method).toBe('GET');
			expect(opts.encoding).toBe('arraybuffer');
			expect(opts.returnFullResponse).toBe(true);
			expect(opts.timeout).toBe(5000);
			expect(opts.headers).toEqual({ 'User-Agent': 'test-agent/1.0' });
		});

		it('should return a Map keyed by URL with mime type inferred from content-type', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/png'),
			});
			const map = await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/a.png');
			expect(entry).toBeDefined();
			expect(entry!.mimeType).toBe('image/png');
			expect(entry!.localPath).toMatch(/^images\/img[0-9a-f]{32}\.png$/);
			expect(entry!.id).toMatch(/^img[0-9a-f]{32}$/);
			expect(entry!.data.byteLength).toBe(pngPixel.length);
		});

		it('should pick the extension from the URL when Content-Type is missing or generic', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'application/octet-stream'),
			});
			const map = await fetchImages(mock, ['https://example.com/foo.jpg'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/foo.jpg');
			expect(entry).toBeDefined();
			expect(entry!.localPath).toMatch(/\.jpeg$/);
			expect(entry!.mimeType).toBe('image/jpeg');
		});

		it('should default to jpeg when neither header nor URL give a hint', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, ''),
			});
			const map = await fetchImages(mock, ['https://example.com/noext'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			const entry = map.get('https://example.com/noext');
			expect(entry!.localPath).toMatch(/\.jpeg$/);
		});

		it('should silently drop URLs whose request rejects', async () => {
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
			expect(map.has('https://example.com/good')).toBe(true);
			expect(map.has('https://example.com/bad')).toBe(false);
		});

		it('should skip responses larger than maxBytes', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(Buffer.alloc(100), 'image/png'),
			});
			const map = await fetchImages(mock, ['https://example.com/big.png'], {
				timeoutMs: 1000,
				maxBytes: 50,
				userAgent: 'ua',
			});
			expect(map.size).toBe(0);
		});

		it('should strip content-type parameters (e.g. "image/png; charset=utf-8")', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/png; charset=utf-8'),
			});
			const map = await fetchImages(mock, ['https://example.com/a.png'], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(map.get('https://example.com/a.png')!.mimeType).toBe('image/png');
		});

		it('should accept body returned as an ArrayBuffer', async () => {
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
			expect(map.get('https://example.com/a.png')!.data.byteLength).toBe(pngPixel.length);
		});

		it('should be stable: the same URL always hashes to the same local path', async () => {
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
			expect(mapA.get('https://example.com/a.png')!.localPath).toBe(
				mapB.get('https://example.com/a.png')!.localPath,
			);
		});

		it('should return an empty map for an empty url list', async () => {
			const { mock, calls } = makeExecuteFunctionsMock();
			const map = await fetchImages(mock, [], {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(map.size).toBe(0);
			expect(calls.httpRequest).toHaveLength(0);
		});
	});

	describe('fetchCoverImage()', () => {
		function stubResponse(
			body: Buffer | Uint8Array,
			contentType = 'image/jpeg',
		): HttpResponse {
			return { body, headers: { 'content-type': contentType } };
		}

		it('should return a FetchedImage tagged as the cover', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/png'),
			});
			const cover = await fetchCoverImage(mock, 'https://example.com/c.png', {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(cover.id).toBe('cover-image');
			expect(cover.mimeType).toBe('image/png');
			expect(cover.localPath).toBe('images/cover.png');
			expect(cover.data.byteLength).toBe(pngPixel.length);
		});

		it('should throw when the response exceeds maxBytes (unlike fetchImages which skips)', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(Buffer.alloc(200), 'image/jpeg'),
			});
			await expect(
				fetchCoverImage(mock, 'https://example.com/big.jpg', {
					timeoutMs: 1000,
					maxBytes: 100,
					userAgent: 'ua',
				}),
			).rejects.toThrow(/larger than the configured maximum/);
		});

		it('should redact query/fragment/credentials from the size-limit error URL', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(Buffer.alloc(200), 'image/jpeg'),
			});
			const signedUrl =
				'https://user:secret@example.com/cover.jpg?token=LEAKED_SECRET&sig=ALSO_LEAKED#frag';
			const err = await fetchCoverImage(mock, signedUrl, {
				timeoutMs: 1000,
				maxBytes: 100,
				userAgent: 'ua',
			}).catch((e) => e as Error);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).not.toContain('LEAKED_SECRET');
			expect(err.message).not.toContain('ALSO_LEAKED');
			expect(err.message).not.toContain('secret');
			expect(err.message).not.toContain('#frag');
			expect(err.message).toContain('example.com/cover.jpg');
		});

		it('should fall back to the URL extension when the Content-Type header is missing', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, ''),
			});
			const cover = await fetchCoverImage(mock, 'https://example.com/x.png', {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(cover.localPath).toBe('images/cover.png');
			expect(cover.mimeType).toBe('image/png');
		});

		it('should default to jpeg when neither header nor URL give a hint', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'application/octet-stream'),
			});
			const cover = await fetchCoverImage(mock, 'https://example.com/noext', {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(cover.localPath).toBe('images/cover.jpeg');
			expect(cover.mimeType).toBe('image/jpeg');
		});

		it('should map modern image MIMEs (AVIF/HEIC) when the header is recognised', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/avif'),
			});
			const cover = await fetchCoverImage(mock, 'https://example.com/pic', {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(cover.mimeType).toBe('image/avif');
			expect(cover.localPath).toBe('images/cover.avif');
		});

		it('should reject an unrecognised MIME and fall back to the safe mapping instead of embedding it', async () => {
			const { mock } = makeExecuteFunctionsMock({
				httpRequest: async () => stubResponse(pngPixel, 'image/jpeg"><script>x'),
			});
			const cover = await fetchCoverImage(mock, 'https://example.com/x.png', {
				timeoutMs: 1000,
				maxBytes: 1_000_000,
				userAgent: 'ua',
			});
			expect(cover.mimeType).toBe('image/png');
			expect(cover.mimeType).not.toContain('<script');
		});
	});

	describe('coverFromBinary()', () => {
		it('should map a recognised image MIME to the right extension', () => {
			const cover = coverFromBinary(new Uint8Array(pngPixel), 'image/png');
			expect(cover.id).toBe('cover-image');
			expect(cover.mimeType).toBe('image/png');
			expect(cover.localPath).toBe('images/cover.png');
		});

		it('should support modern image MIMEs like image/avif', () => {
			const cover = coverFromBinary(new Uint8Array(pngPixel), 'image/avif');
			expect(cover.mimeType).toBe('image/avif');
			expect(cover.localPath).toBe('images/cover.avif');
		});

		it('should strip parameters from the declared MIME (e.g. "image/png; name=foo")', () => {
			const cover = coverFromBinary(new Uint8Array(pngPixel), 'image/png; name=foo');
			expect(cover.mimeType).toBe('image/png');
		});

		it('should default to jpeg when the declared MIME is empty or unknown', () => {
			expect(coverFromBinary(new Uint8Array(pngPixel), '').mimeType).toBe('image/jpeg');
			expect(coverFromBinary(new Uint8Array(pngPixel), 'application/pdf').mimeType).toBe(
				'image/jpeg',
			);
		});

		it('should not echo an untrusted header value into mimeType', () => {
			const cover = coverFromBinary(new Uint8Array(pngPixel), 'image/jpeg"><inject');
			expect(cover.mimeType).toBe('image/jpeg');
			expect(cover.mimeType).not.toContain('<inject');
		});
	});

	describe('rewriteImgSrc()', () => {
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

		it('should replace matching URLs with their local path', () => {
			const map = makeMap(remote, 'images/imgabc.jpeg');
			const out = rewriteImgSrc(`<p><img src="${remote}" alt="x"></p>`, map);
			expect(out).toContain('images/imgabc.jpeg');
			expect(out).not.toContain(remote);
		});

		it('should preserve tags whose URL was not fetched', () => {
			const map = makeMap(remote, 'images/imgabc.jpeg');
			const other = 'https://example.com/other.png';
			const out = rewriteImgSrc(`<img src="${other}">`, map);
			expect(out).toContain(other);
		});

		it('should handle quoted and bare attributes uniformly', () => {
			const map = makeMap(remote, 'local/a.jpeg');
			const html = `<img src="${remote}">|<img src='${remote}'>|<img src=${remote}>`;
			const out = rewriteImgSrc(html, map);
			const occurrences = out.split('local/a.jpeg').length - 1;
			expect(occurrences).toBe(3);
		});

		it('should return the input unchanged when the map is empty', () => {
			const html = `<img src="${remote}">`;
			expect(rewriteImgSrc(html, new Map())).toBe(html);
		});
	});
});
