import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

// -----------------------------------------------------------------------------
// HTML fixtures
// -----------------------------------------------------------------------------

export const simpleHtml = `
<html>
<head><title>Ignore me</title></head>
<body>
<h1>Hello</h1>
<p>Simple article with <strong>bold</strong> text.</p>
</body>
</html>
`;

export const htmlWithScripts = `
<html>
<body>
<p>Before</p>
<script>alert('xss');</script>
<p>Middle</p>
<iframe src="https://example.com"></iframe>
<noscript>no js</noscript>
<style>.evil { color: red }</style>
<p>After</p>
</body>
</html>
`;

export const htmlWithEventHandlers = `
<html>
<body>
<a href="https://example.com" onclick="alert(1)">Click</a>
<div onmouseover='stealCookies()'>Hover</div>
<img src="https://example.com/img.png" onload="boom()"/>
</body>
</html>
`;

export const htmlWithVoidElements = `
<html>
<body>
<p>Line 1<br>Line 2</p>
<hr>
<img src="https://example.com/cat.jpeg" alt="cat">
<meta name="author" content="Anon">
<input type="text" value="hi">
<link rel="stylesheet" href="x.css">
</body>
</html>
`;

export const htmlWithImages = `
<html>
<body>
<h1>Gallery</h1>
<p>
<img src="https://example.com/a.jpg" alt="a">
<img src='https://example.com/b.png' alt="b">
<img src=https://example.com/c.gif alt="c">
</p>
<p>Relative <img src="/local/d.png"> and data <img src="data:image/png;base64,AAAA"/></p>
<p>Duplicate <img src="https://example.com/a.jpg"></p>
</body>
</html>
`;

export const htmlWithAmpersands = `
<html>
<body>
<p>Fish &amp; chips, salt & vinegar, &#233; accent, &eacute; entity.</p>
</body>
</html>
`;

export const malformedHtml = `<p>unclosed <strong>tag <em>double`;

// Tiny valid 1x1 transparent PNG (67 bytes).
export const pngPixel: Buffer = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
		'890000000d49444154789c626001000000050001' +
		'0d0a2db40000000049454e44ae426082',
	'hex',
);

// Tiny valid JPEG (SOI + EOI only — not valid visually, but valid byte-wise).
export const jpegStub: Buffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

// -----------------------------------------------------------------------------
// IExecuteFunctions mock
// -----------------------------------------------------------------------------

export interface HttpRequestOptions {
	method?: string;
	url: string;
	returnFullResponse?: boolean;
	encoding?: string;
	timeout?: number;
	headers?: Record<string, string>;
}

export interface HttpResponse {
	body: Buffer | ArrayBuffer | Uint8Array;
	headers: Record<string, string>;
}

export interface ExecuteMockOptions {
	inputData?: INodeExecutionData[];
	parameters?: Record<string, unknown> | ((name: string, itemIndex: number) => unknown);
	continueOnFail?: boolean;
	httpRequest?: (options: HttpRequestOptions) => Promise<HttpResponse | Uint8Array | Buffer>;
	getBinaryDataBuffer?: (itemIndex: number, property: string) => Promise<Buffer>;
	prepareBinaryData?: (
		data: Buffer,
		fileName?: string,
		mimeType?: string,
	) => Promise<Record<string, unknown>>;
	assertBinaryData?: (itemIndex: number, property: string) => { mimeType?: string };
}

export interface ExecuteMock {
	mock: IExecuteFunctions;
	calls: {
		httpRequest: HttpRequestOptions[];
		prepareBinaryData: Array<{ fileName?: string; mimeType?: string; size: number }>;
		getBinaryDataBuffer: Array<{ itemIndex: number; property: string }>;
	};
}

// Builds a minimally-typed IExecuteFunctions stub that is good enough to run
// HtmlToEpub.execute() in tests. Every helper is recorded in `calls` so tests
// can assert on what the node did.
export function makeExecuteFunctionsMock(opts: ExecuteMockOptions = {}): ExecuteMock {
	const calls: ExecuteMock['calls'] = {
		httpRequest: [],
		prepareBinaryData: [],
		getBinaryDataBuffer: [],
	};

	const resolveParam = (name: string, itemIndex: number, defaultValue?: unknown): unknown => {
		if (typeof opts.parameters === 'function') {
			const result = opts.parameters(name, itemIndex);
			return result === undefined ? defaultValue : result;
		}
		const map = opts.parameters ?? {};
		if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
		return defaultValue;
	};

	const httpRequest =
		opts.httpRequest ??
		(async (): Promise<HttpResponse> => ({
			body: new Uint8Array(),
			headers: { 'content-type': 'application/octet-stream' },
		}));

	const getBinaryDataBuffer =
		opts.getBinaryDataBuffer ?? (async (): Promise<Buffer> => Buffer.from(''));

	const prepareBinaryData =
		opts.prepareBinaryData ??
		(async (
			data: Buffer,
			fileName?: string,
			mimeType?: string,
		): Promise<Record<string, unknown>> => ({
			data: data.toString('base64'),
			mimeType: mimeType ?? 'application/octet-stream',
			fileName,
			fileExtension: fileName?.split('.').pop(),
			fileSize: data.length,
		}));

	const assertBinaryData =
		opts.assertBinaryData ??
		((): { mimeType?: string } => ({ mimeType: 'application/octet-stream' }));

	const mock = {
		getInputData: () => opts.inputData ?? ([{ json: {} }] as INodeExecutionData[]),
		getNode: () => ({
			id: 'test-node-id',
			name: 'HtmlToEpub',
			type: 'htmlToEpub',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		}),
		getNodeParameter: (name: string, itemIndex: number, defaultValue?: unknown) =>
			resolveParam(name, itemIndex, defaultValue),
		continueOnFail: () => opts.continueOnFail ?? false,
		helpers: {
			httpRequest: async (options: HttpRequestOptions) => {
				calls.httpRequest.push(options);
				return httpRequest(options);
			},
			getBinaryDataBuffer: async (itemIndex: number, property: string) => {
				calls.getBinaryDataBuffer.push({ itemIndex, property });
				return getBinaryDataBuffer(itemIndex, property);
			},
			prepareBinaryData: async (data: Buffer, fileName?: string, mimeType?: string) => {
				calls.prepareBinaryData.push({ fileName, mimeType, size: data.length });
				return prepareBinaryData(data, fileName, mimeType);
			},
			assertBinaryData: (itemIndex: number, property: string) =>
				assertBinaryData(itemIndex, property),
		},
	};

	return { mock: mock as unknown as IExecuteFunctions, calls };
}
