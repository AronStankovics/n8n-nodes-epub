import { createHash } from 'node:crypto';

import type { IExecuteFunctions } from 'n8n-workflow';

import { redactUrl } from './url';

export interface FetchedImage {
	localPath: string; // e.g. "images/img2ebe3c1897c845cc35ffe8c61955be95.jpeg"
	id: string; // manifest id, e.g. "img2ebe3c1897c845cc35ffe8c61955be95"
	mimeType: string;
	data: Uint8Array;
}

interface InlineOptions {
	timeoutMs: number;
	maxBytes: number;
	userAgent: string;
}

const EXT_FOR_MIME: Record<string, string> = {
	'image/jpeg': 'jpeg',
	'image/jpg': 'jpeg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/avif': 'avif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'image/tiff': 'tiff',
};

const EXT_FROM_URL: Record<string, string> = {
	jpg: 'jpeg',
	jpeg: 'jpeg',
	png: 'png',
	gif: 'gif',
	webp: 'webp',
	svg: 'svg',
	bmp: 'bmp',
	avif: 'avif',
	heic: 'heic',
	heif: 'heif',
	tif: 'tiff',
	tiff: 'tiff',
};

// Regex-based URL extraction (no DOM dependency).
// Handles `<img src="...">`, `<img src='...'>`, and `<img src=url>`.
const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

function hashUrl(url: string): string {
	return createHash('md5').update(url).digest('hex');
}

function extForUrl(url: string): string | null {
	const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
	if (!m) return null;
	return EXT_FROM_URL[m[1].toLowerCase()] || null;
}

function mimeForExt(ext: string): string {
	switch (ext) {
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'svg':
			return 'image/svg+xml';
		case 'bmp':
			return 'image/bmp';
		case 'avif':
			return 'image/avif';
		case 'heic':
			return 'image/heic';
		case 'heif':
			return 'image/heif';
		case 'tiff':
			return 'image/tiff';
		default:
			return 'application/octet-stream';
	}
}

// Extract unique remote image URLs from HTML. Skips data: URIs and relative paths
// since they either already contain the bytes or can't be resolved without a base.
export function extractImageUrls(html: string): string[] {
	const urls = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = IMG_SRC_RE.exec(html)) !== null) {
		const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
		if (!raw) continue;
		if (raw.startsWith('data:')) continue;
		if (!/^https?:/i.test(raw)) continue;
		urls.add(raw);
	}
	return Array.from(urls);
}

// Fetch every remote image using n8n's http helper, hash the URL for a stable
// filename, and return the bytes plus the path we'll use inside the EPUB.
// Failures are logged and skipped so one bad image doesn't fail the whole book.
export async function fetchImages(
	executeFns: IExecuteFunctions,
	urls: string[],
	options: InlineOptions,
): Promise<Map<string, FetchedImage>> {
	const result = new Map<string, FetchedImage>();
	for (const url of urls) {
		try {
			const response = (await executeFns.helpers.httpRequest({
				method: 'GET',
				url,
				returnFullResponse: true,
				encoding: 'arraybuffer',
				timeout: options.timeoutMs,
				headers: { 'User-Agent': options.userAgent },
			})) as { body: Buffer | ArrayBuffer | Uint8Array; headers: Record<string, string> };

			const bodyBytes =
				response.body instanceof Uint8Array
					? response.body
					: new Uint8Array(response.body as ArrayBuffer);

			if (bodyBytes.byteLength > options.maxBytes) continue;

			const headerContentType = response.headers['content-type'] || '';
			const normalizedMime = headerContentType.split(';')[0].trim().toLowerCase();
			const extFromHeader = EXT_FOR_MIME[normalizedMime];
			const ext = extFromHeader || extForUrl(url) || 'jpeg';
			const mimeType = extFromHeader ? normalizedMime : mimeForExt(ext);

			const hash = hashUrl(url);
			const filename = `img${hash}.${ext}`;
			result.set(url, {
				localPath: `images/${filename}`,
				id: `img${hash}`,
				mimeType,
				data: bodyBytes,
			});
		} catch {
			// Swallow fetch failures — the img tag keeps its remote src as a fallback.
		}
	}
	return result;
}

// Fetch a single image and register it as the book cover. Unlike fetchImages,
// this throws on failure — if the user explicitly asked for a cover, a silent
// fallback would be surprising.
export async function fetchCoverImage(
	executeFns: IExecuteFunctions,
	url: string,
	options: InlineOptions,
): Promise<FetchedImage> {
	const response = (await executeFns.helpers.httpRequest({
		method: 'GET',
		url,
		returnFullResponse: true,
		encoding: 'arraybuffer',
		timeout: options.timeoutMs,
		headers: { 'User-Agent': options.userAgent },
	})) as { body: Buffer | ArrayBuffer | Uint8Array; headers: Record<string, string> };

	const bodyBytes =
		response.body instanceof Uint8Array
			? response.body
			: new Uint8Array(response.body as ArrayBuffer);

	if (bodyBytes.byteLength > options.maxBytes) {
		throw new Error(
			`Cover image at ${redactUrl(url)} is larger than the configured maximum (${options.maxBytes} bytes).`,
		);
	}

	const headerContentType = response.headers['content-type'] || '';
	const normalizedMime = headerContentType.split(';')[0].trim().toLowerCase();
	const extFromHeader = EXT_FOR_MIME[normalizedMime];
	const ext = extFromHeader || extForUrl(url) || 'jpeg';
	const mimeType = extFromHeader ? normalizedMime : mimeForExt(ext);

	return {
		localPath: `images/cover.${ext}`,
		id: 'cover-image',
		mimeType,
		data: bodyBytes,
	};
}

// Build a cover image descriptor from in-memory bytes (e.g. an n8n binary
// property on the input item). The mime type comes from the binary metadata.
export function coverFromBinary(buffer: Uint8Array, declaredMime: string): FetchedImage {
	const normalizedMime = (declaredMime || '').split(';')[0].trim().toLowerCase();
	const extFromMime = EXT_FOR_MIME[normalizedMime];
	const ext = extFromMime || 'jpeg';
	const mimeType = extFromMime ? normalizedMime : mimeForExt(ext);
	return {
		localPath: `images/cover.${ext}`,
		id: 'cover-image',
		mimeType,
		data: buffer,
	};
}

// Rewrite every `<img src>` to point at the local path inside the EPUB, where
// possible. Unknown/failed URLs are left untouched.
export function rewriteImgSrc(html: string, images: Map<string, FetchedImage>): string {
	if (images.size === 0) return html;
	return html.replace(IMG_SRC_RE, (match, dquoted, squoted, bare) => {
		const url = ((dquoted ?? squoted ?? bare ?? '') as string).trim();
		const img = images.get(url);
		if (!img) return match;
		return match.replace(url, img.localPath);
	});
}
