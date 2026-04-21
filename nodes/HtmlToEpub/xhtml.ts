// HTML → XHTML conversion and XML escaping.
// Scoped to what EPUB readers tolerate: void-element self-closing, stripped
// scripts/iframes/event handlers, escaped stray `&`. Not a general sanitizer.

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
