import { randomUUID } from 'node:crypto';

import type { FetchedImage } from './images';
import { htmlToXhtmlBody, xmlEscape } from './xhtml';
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
	cover?: FetchedImage;
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

function renderChapter(input: EpubInput): string {
	const title = xmlEscape(input.title);
	const bodyHtml = htmlToXhtmlBody(input.html);
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

function renderOpf(
	input: EpubInput,
	uid: string,
	images: FetchedImage[],
	cover: FetchedImage | undefined,
): string {
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
	// EPUB 2 fallback meta for readers that don't understand properties="cover-image".
	const coverMeta = cover ? `<meta name="cover" content="cover-image"/>` : '';
	const coverManifestItems = cover
		? `<item id="cover-image" properties="cover-image" href="${xmlEscape(cover.localPath)}" media-type="${xmlEscape(cover.mimeType)}"/>\n<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`
		: '';
	const coverSpineItem = cover ? `<itemref idref="cover-page"/>` : '';
	const coverGuideRef = cover
		? `<reference type="cover" title="Cover" href="cover.xhtml"/>`
		: '';
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
${coverMeta}
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="chapter-1" href="article_content.xhtml" media-type="application/xhtml+xml"/>
${coverManifestItems}
${imageItems}
</manifest>
<spine toc="ncx">
${coverSpineItem}
<itemref idref="chapter-1"/>
</spine>
<guide>
${coverGuideRef}
<reference type="text" title="Table of Content" href="toc.xhtml"/>
</guide>
</package>
`;
}

function renderCoverPage(cover: FetchedImage, title: string): string {
	const escapedTitle = xmlEscape(title);
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>Cover</title>
<style type="text/css">
body { margin: 0; padding: 0; text-align: center; }
img { max-width: 100%; max-height: 100vh; }
</style>
</head>
<body epub:type="cover">
<section>
<img src="${xmlEscape(cover.localPath)}" alt="${escapedTitle}"/>
</section>
</body>
</html>
`;
}

function renderToc(input: EpubInput): string {
	const lang = input.language || 'en';
	const title = xmlEscape(input.title);
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
<a href="article_content.xhtml">1. ${title}</a>
</li>
</ol>
</nav>
</body>
</html>
`;
}

function renderNcx(input: EpubInput, uid: string): string {
	const title = xmlEscape(input.title);
	return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:${uid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${title}</text></docTitle>
<navMap>
<navPoint id="chapter-1" playOrder="1">
<navLabel><text>1. ${title}</text></navLabel>
<content src="article_content.xhtml"/>
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
	const cover = input.cover;

	const entries: ZipEntry[] = [
		{ path: 'mimetype', data: encoder.encode('application/epub+zip') },
		{ path: 'META-INF/container.xml', data: encoder.encode(CONTAINER_XML) },
		{ path: 'OEBPS/content.opf', data: encoder.encode(renderOpf(input, uid, images, cover)) },
		{ path: 'OEBPS/toc.xhtml', data: encoder.encode(renderToc(input)) },
		{ path: 'OEBPS/toc.ncx', data: encoder.encode(renderNcx(input, uid)) },
		{ path: 'OEBPS/article_content.xhtml', data: encoder.encode(renderChapter(input)) },
		{ path: 'OEBPS/style.css', data: encoder.encode(DEFAULT_STYLE) },
	];

	if (cover) {
		entries.push({
			path: 'OEBPS/cover.xhtml',
			data: encoder.encode(renderCoverPage(cover, input.title)),
		});
		entries.push({ path: `OEBPS/${cover.localPath}`, data: cover.data });
	}

	for (const img of images) {
		entries.push({ path: `OEBPS/${img.localPath}`, data: img.data });
	}

	return buildZip(entries);
}
