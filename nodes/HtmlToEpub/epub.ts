import { randomUUID } from 'node:crypto';

import { buildZip, type ZipEntry } from './zip';

export interface EpubInput {
	html: string;
	title: string;
	author?: string;
	language?: string;
	identifier?: string;
	publisher?: string;
	description?: string;
}

const DEFAULT_STYLE = `body { font-family: serif; line-height: 1.6; margin: 1em; }
h1, h2, h3, h4 { font-family: sans-serif; line-height: 1.25; }
img { max-width: 100%; height: auto; }
figure { margin: 1em 0; }
figure figcaption { font-size: 0.85em; color: #555; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; margin: 1em 0; }
pre, code { font-family: monospace; background: #f4f4f4; }
code { padding: 0.1em 0.25em; border-radius: 3px; }
pre { padding: 0.8em; overflow-x: auto; border-radius: 3px; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid #ccc; margin: 2em 0; }
table { border-collapse: collapse; margin: 1em 0; }
td, th { border: 1px solid #ccc; padding: 0.4em 0.6em; }
`;

const VOID_ELEMENTS = [
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr',
];

// Escape characters that have special meaning in XML text nodes and attributes.
export function xmlEscape(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// Convert a loose chunk of HTML into something close enough to XHTML that
// EPUB readers will parse it. This is not a full DOM sanitizer — it:
//   - extracts body content if wrapped in <html><body>
//   - strips <script>, <style>, <iframe>, <object>, <embed>, <applet> blocks
//   - strips inline event handlers (onclick, onload, ...)
//   - self-closes void elements (<br>, <img>, <hr>, ...)
//   - escapes bare `&` characters that aren't already part of an entity
export function htmlToXhtmlBody(html: string): string {
	let body: string;
	const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
	if (bodyMatch) {
		body = bodyMatch[1];
	} else {
		const headEnd = html.search(/<\/head\s*>/i);
		body = headEnd >= 0 ? html.slice(headEnd + 7) : html;
	}

	body = body.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
	body = body.replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
	body = body.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '');
	body = body.replace(/<object\b[\s\S]*?<\/object\s*>/gi, '');
	body = body.replace(/<embed\b[\s\S]*?<\/embed\s*>/gi, '');
	body = body.replace(/<applet\b[\s\S]*?<\/applet\s*>/gi, '');
	body = body.replace(/<!--[\s\S]*?-->/g, '');

	// Strip inline event handler attributes (onclick="..." etc.).
	body = body.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
	body = body.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');

	// Self-close each void element that isn't already self-closed.
	for (const tag of VOID_ELEMENTS) {
		const re = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
		body = body.replace(re, '<$1$2/>');
	}

	// Escape stray `&` not part of an entity.
	body = body.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');

	return body.trim();
}

function renderChapter(input: EpubInput): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
	const author = input.author ? `<p class="byline">${xmlEscape(input.author)}</p>` : '';
	const body = htmlToXhtmlBody(input.html);
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head>
<title>${title}</title>
<meta charset="utf-8"/>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<h1>${title}</h1>
${author}
${body}
</body>
</html>
`;
}

function renderOpf(input: EpubInput, uid: string): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
	const author = input.author ? `<dc:creator>${xmlEscape(input.author)}</dc:creator>` : '';
	const publisher = input.publisher
		? `<dc:publisher>${xmlEscape(input.publisher)}</dc:publisher>`
		: '';
	const description = input.description
		? `<dc:description>${xmlEscape(input.description)}</dc:description>`
		: '';
	const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${uid}</dc:identifier>
<dc:title>${title}</dc:title>
<dc:language>${lang}</dc:language>
${author}
${publisher}
${description}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="style" href="style.css" media-type="text/css"/>
</manifest>
<spine toc="ncx">
<itemref idref="chapter"/>
</spine>
</package>
`;
}

function renderNav(input: EpubInput): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<title>${title}</title>
<meta charset="utf-8"/>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>${title}</h1>
<ol>
<li><a href="chapter.xhtml">${title}</a></li>
</ol>
</nav>
</body>
</html>
`;
}

function renderNcx(input: EpubInput, uid: string): string {
	const title = xmlEscape(input.title);
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:${uid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${title}</text></docTitle>
<navMap>
<navPoint id="navpoint-1" playOrder="1">
<navLabel><text>${title}</text></navLabel>
<content src="chapter.xhtml"/>
</navPoint>
</navMap>
</ncx>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

export function buildEpub(input: EpubInput): Uint8Array {
	const uid = (input.identifier && input.identifier.trim()) || randomUUID();
	const encoder = new TextEncoder();

	// EPUB requires `mimetype` to be the first entry in the archive.
	const entries: ZipEntry[] = [
		{ path: 'mimetype', data: encoder.encode('application/epub+zip') },
		{ path: 'META-INF/container.xml', data: encoder.encode(CONTAINER_XML) },
		{ path: 'OEBPS/content.opf', data: encoder.encode(renderOpf(input, uid)) },
		{ path: 'OEBPS/nav.xhtml', data: encoder.encode(renderNav(input)) },
		{ path: 'OEBPS/toc.ncx', data: encoder.encode(renderNcx(input, uid)) },
		{ path: 'OEBPS/chapter.xhtml', data: encoder.encode(renderChapter(input)) },
		{ path: 'OEBPS/style.css', data: encoder.encode(DEFAULT_STYLE) },
	];

	return buildZip(entries);
}
