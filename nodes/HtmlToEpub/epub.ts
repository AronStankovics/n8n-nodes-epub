import { randomUUID } from 'node:crypto';

import type { FetchedImage } from './images';
import { buildZip, type ZipEntry } from './zip';

export interface EpubInput {
	html: string;
	title: string;
	author?: string;
	language?: string;
	identifier?: string;
	publisher?: string;
	description?: string;
	images?: FetchedImage[];
	generateTocFromHeadings?: boolean;
}

interface Heading {
	level: 1 | 2 | 3;
	id: string;
	text: string;
}

interface HeadingNode extends Heading {
	children: HeadingNode[];
}

const DEFAULT_STYLE = `body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 1em;
  line-height: 1.5;
  max-width: 45em;
  margin: 0 auto;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.25;
}
img {
  max-width: 100%;
  height: auto;
}
figure { margin: 1em 0; }
figcaption { font-size: 0.85em; color: #555; }
blockquote {
  border-left: 3px solid #ccc;
  padding-left: 1em;
  color: #555;
  margin: 1em 0;
}
pre, code {
  font-family: "SF Mono", Consolas, Menlo, monospace;
  background: #f4f4f4;
}
code { padding: 0.1em 0.25em; border-radius: 3px; }
pre { padding: 0.8em; overflow-x: auto; border-radius: 3px; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid #ccc; margin: 2em 0; }
table { border-collapse: collapse; margin: 1em 0; }
td, th { border: 1px solid #ccc; padding: 0.4em 0.6em; }
.byline { color: #666; margin: 0.5em 0 1em; }
.toc-title { margin: 1em 0; }
.toc-list { list-style-type: none; padding-left: 0; margin: 2em 0; }
.toc-list li { margin: 1em 0; }
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

export function xmlEscape(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// Convert loose HTML into XHTML-safe markup — enough for EPUB readers to parse.
// Not a sanitizer: strips scripts/iframes/event handlers, self-closes voids,
// escapes stray `&`, extracts `<body>` when present.
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

	body = body.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
	body = body.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');

	for (const tag of VOID_ELEMENTS) {
		const re = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
		body = body.replace(re, '<$1$2/>');
	}

	body = body.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');

	return body.trim();
}

const HEADING_RE = /<(h[1-3])\b([^>]*)>([\s\S]*?)<\/h[1-3]\s*>/gi;
const ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/i;

function decodeBasicEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&');
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

// Walk `<h1>`–`<h3>` tags, assign synthetic IDs where missing, and collect a
// flat ordered list of headings. The returned `annotatedHtml` is identical to
// the input except for the injected `id` attributes, so the chapter XHTML and
// the TOC point at matching anchors.
function extractHeadings(html: string): { annotatedHtml: string; headings: Heading[] } {
	const headings: Heading[] = [];
	const used = new Set<string>();
	let fallback = 0;

	const annotated = html.replace(HEADING_RE, (_match, tag: string, attrs: string, inner: string) => {
		const level = parseInt(tag[1], 10) as 1 | 2 | 3;
		const text = decodeBasicEntities(inner.replace(/<[^>]*>/g, ''))
			.replace(/\s+/g, ' ')
			.trim();

		const idMatch = attrs.match(ID_ATTR_RE);
		const existingId = idMatch ? idMatch[1] || idMatch[2] || idMatch[3] || '' : '';
		let id: string;
		let newAttrs = attrs;
		if (existingId) {
			id = existingId;
		} else {
			const base = slugify(text) || `heading-${++fallback}`;
			let candidate = base;
			let n = 2;
			while (used.has(candidate)) candidate = `${base}-${n++}`;
			id = candidate;
			newAttrs = `${attrs} id="${id}"`;
		}
		used.add(id);
		headings.push({ level, id, text });
		return `<${tag}${newAttrs}>${inner}</${tag}>`;
	});

	return { annotatedHtml: annotated, headings };
}

function buildHeadingTree(headings: Heading[]): HeadingNode[] {
	const roots: HeadingNode[] = [];
	const stack: HeadingNode[] = [];
	for (const h of headings) {
		const node: HeadingNode = { ...h, children: [] };
		while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
		if (stack.length === 0) roots.push(node);
		else stack[stack.length - 1].children.push(node);
		stack.push(node);
	}
	return roots;
}

function renderTocNav(nodes: HeadingNode[], chapterHref: string): string {
	if (nodes.length === 0) return '';
	const items = nodes
		.map((n) => {
			const sub = n.children.length > 0 ? `\n${renderTocNav(n.children, chapterHref)}` : '';
			return `<li><a href="${chapterHref}#${n.id}">${xmlEscape(n.text)}</a>${sub}</li>`;
		})
		.join('\n');
	return `<ol>\n${items}\n</ol>`;
}

function renderNcxNavPoints(
	nodes: HeadingNode[],
	chapterHref: string,
	counter: { n: number },
): string {
	return nodes
		.map((node) => {
			counter.n += 1;
			const playOrder = counter.n;
			const children =
				node.children.length > 0
					? `\n${renderNcxNavPoints(node.children, chapterHref, counter)}`
					: '';
			return `<navPoint id="nav-${playOrder}" playOrder="${playOrder}">
<navLabel><text>${xmlEscape(node.text)}</text></navLabel>
<content src="${chapterHref}#${node.id}"/>${children}
</navPoint>`;
		})
		.join('\n');
}

function treeDepth(nodes: HeadingNode[]): number {
	if (nodes.length === 0) return 0;
	let max = 1;
	for (const n of nodes) {
		if (n.children.length > 0) max = Math.max(max, 1 + treeDepth(n.children));
	}
	return max;
}

function renderChapter(input: EpubInput, htmlOverride?: string): string {
	const title = xmlEscape(input.title);
	const bodyHtml = htmlToXhtmlBody(htmlOverride ?? input.html);
	const byline = input.author
		? `<p class="byline">By ${xmlEscape(input.author)}</p>\n<hr/>\n`
		: '';
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section epub:type="chapter">
<h1>${title}</h1>
${byline}${bodyHtml}
</section>
</body>
</html>
`;
}

function renderOpf(input: EpubInput, uid: string, images: FetchedImage[]): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
	const author = input.author ? `<dc:creator id="creator">${xmlEscape(input.author)}</dc:creator>` : '';
	const publisher = input.publisher
		? `<dc:publisher>${xmlEscape(input.publisher)}</dc:publisher>`
		: '';
	const description = input.description
		? `<dc:description>${xmlEscape(input.description)}</dc:description>`
		: '';
	const now = new Date();
	const datePart = now.toISOString().slice(0, 10);
	const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const imageItems = images
		.map(
			(img) =>
				`<item id="${img.id}" href="${img.localPath}" media-type="${img.mimeType}"/>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         version="3.0"
         unique-identifier="BookId"
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:dcterms="http://purl.org/dc/terms/"
         xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="BookId">urn:uuid:${uid}</dc:identifier>
<dc:title>${title}</dc:title>
<dc:language>${lang}</dc:language>
${author}
${publisher}
${description}
<dc:date>${datePart}</dc:date>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="chapter-1" href="article_content.xhtml" media-type="application/xhtml+xml"/>
${imageItems}
</manifest>
<spine toc="ncx">
<itemref idref="chapter-1"/>
</spine>
<guide>
<reference type="text" title="Table of Content" href="toc.xhtml"/>
</guide>
</package>
`;
}

function renderToc(input: EpubInput, headings: Heading[]): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
	const tree = buildHeadingTree(headings);
	const subNav = tree.length > 0 ? `\n${renderTocNav(tree, 'article_content.xhtml')}\n` : '';
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<title>${title}</title>
<meta charset="UTF-8"/>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<h2 class="toc-title">Table of Contents</h2>
<nav id="toc" epub:type="toc">
<ol class="toc-list">
<li class="table-of-content">
<a href="article_content.xhtml">1. ${title}</a>${subNav}</li>
</ol>
</nav>
</body>
</html>
`;
}

function renderNcx(input: EpubInput, uid: string, headings: Heading[]): string {
	const title = xmlEscape(input.title);
	const tree = buildHeadingTree(headings);
	// Chapter is depth 1; each extra level of headings adds one to dtb:depth.
	const depth = 1 + treeDepth(tree);
	const counter = { n: 1 };
	const nested =
		tree.length > 0 ? `\n${renderNcxNavPoints(tree, 'article_content.xhtml', counter)}` : '';
	return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:${uid}"/>
<meta name="dtb:depth" content="${depth}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${title}</text></docTitle>
<navMap>
<navPoint id="chapter-1" playOrder="1">
<navLabel><text>1. ${title}</text></navLabel>
<content src="article_content.xhtml"/>${nested}
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
	const images = input.images || [];

	let chapterHtml = input.html;
	let headings: Heading[] = [];
	if (input.generateTocFromHeadings ?? true) {
		const extracted = extractHeadings(input.html);
		chapterHtml = extracted.annotatedHtml;
		headings = extracted.headings;
	}

	const entries: ZipEntry[] = [
		{ path: 'mimetype', data: encoder.encode('application/epub+zip') },
		{ path: 'META-INF/container.xml', data: encoder.encode(CONTAINER_XML) },
		{ path: 'OEBPS/content.opf', data: encoder.encode(renderOpf(input, uid, images)) },
		{ path: 'OEBPS/toc.xhtml', data: encoder.encode(renderToc(input, headings)) },
		{ path: 'OEBPS/toc.ncx', data: encoder.encode(renderNcx(input, uid, headings)) },
		{ path: 'OEBPS/article_content.xhtml', data: encoder.encode(renderChapter(input, chapterHtml)) },
		{ path: 'OEBPS/style.css', data: encoder.encode(DEFAULT_STYLE) },
	];

	for (const img of images) {
		entries.push({ path: `OEBPS/${img.localPath}`, data: img.data });
	}

	return buildZip(entries);
}
