/* eslint-disable */
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { HtmlToEpub } from '../nodes/HtmlToEpub/HtmlToEpub.node';
import {
	htmlWithImages,
	makeExecuteFunctionsMock,
	pngPixel,
	simpleHtml,
	type ExecuteMock,
	type HttpResponse,
} from './test-data';

type Params = Record<string, unknown>;

const defaultAdditional = {
	inlineImages: false,
	imageTimeoutMs: 30000,
	imageMaxBytes: 10 * 1024 * 1024,
};

function buildParams(overrides: Params = {}): Params {
	return {
		inputSource: 'string',
		html: simpleHtml,
		title: 'My Article',
		outputBinaryProperty: 'data',
		inputBinaryProperty: 'data',
		additionalFields: defaultAdditional,
		...overrides,
	};
}

async function runExecute(mockBundle: ExecuteMock) {
	const node = new HtmlToEpub();
	return node.execute.call(mockBundle.mock);
}

describe('nodes/HtmlToEpub/HtmlToEpub.node.ts', () => {
	describe('description metadata', () => {
		it('should define a valid node description', () => {
			const node = new HtmlToEpub();
			expect(node.description.name).toBe('htmlToEpub');
			expect(node.description.displayName).toBe('HTML to EPUB');
			expect(node.description.usableAsTool).toBe(true);
			const propertyNames = node.description.properties.map((p) => p.name);
			expect(propertyNames).toEqual(
				expect.arrayContaining([
					'inputSource',
					'html',
					'title',
					'outputBinaryProperty',
					'additionalFields',
				]),
			);
		});
	});

	describe('execute() — happy path', () => {
		it('should return a binary EPUB and correct JSON metadata', async () => {
			const bundle = makeExecuteFunctionsMock({ parameters: buildParams() });
			const result = await runExecute(bundle);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(1);
			const output = result[0];
			expect(output).toHaveLength(1);
			const json = output[0].json as Record<string, unknown>;
			expect(json.title).toBe('My Article');
			expect(json.fileName).toBe('My Article.epub');
			expect(json.imagesBundled).toBe(0);
			expect(typeof json.size).toBe('number');
			expect(json.size as number).toBeGreaterThan(0);
			expect(output[0].binary).toHaveProperty('data');
			expect(output[0].pairedItem).toEqual({ item: 0 });
		});

		it('should call helpers.prepareBinaryData with the correct file name and mime type', async () => {
			const bundle = makeExecuteFunctionsMock({ parameters: buildParams() });
			await runExecute(bundle);
			expect(bundle.calls.prepareBinaryData).toHaveLength(1);
			const call = bundle.calls.prepareBinaryData[0];
			expect(call.fileName).toBe('My Article.epub');
			expect(call.mimeType).toBe('application/epub+zip');
			expect(call.size).toBeGreaterThan(0);
		});

		it('should honor a custom output binary property name', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ outputBinaryProperty: 'myEpub' }),
			});
			const result = await runExecute(bundle);
			expect(result[0][0].binary).toHaveProperty('myEpub');
			expect(result[0][0].binary).not.toHaveProperty('data');
		});

		it('should honor an explicit file name override', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					additionalFields: { ...defaultAdditional, fileName: 'custom-name' },
				}),
			});
			const result = await runExecute(bundle);
			expect((result[0][0].json as Record<string, unknown>).fileName).toBe('custom-name.epub');
		});

		it('should not add a second .epub suffix when override already has one', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					additionalFields: { ...defaultAdditional, fileName: 'already.epub' },
				}),
			});
			const result = await runExecute(bundle);
			expect((result[0][0].json as Record<string, unknown>).fileName).toBe('already.epub');
		});

		it('should sanitise unsafe characters out of the default file name', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: 'My / Article: "Hello" | foo*?<>' }),
			});
			const result = await runExecute(bundle);
			const fileName = (result[0][0].json as Record<string, unknown>).fileName as string;
			expect(fileName).not.toMatch(/[\\/:"*?<>|]/);
			expect(fileName.endsWith('.epub')).toBe(true);
		});
	});

	describe('execute() — binary input source', () => {
		it('should read HTML from a binary property when inputSource=binary', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					inputSource: 'binary',
					inputBinaryProperty: 'html',
				}),
				getBinaryDataBuffer: async () => Buffer.from(simpleHtml, 'utf-8'),
			});
			await runExecute(bundle);
			expect(bundle.calls.getBinaryDataBuffer).toHaveLength(1);
			expect(bundle.calls.getBinaryDataBuffer[0]).toEqual({
				itemIndex: 0,
				property: 'html',
			});
		});

		it('should error out when the binary property resolves to empty bytes', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ inputSource: 'binary' }),
				getBinaryDataBuffer: async () => Buffer.from(''),
			});
			const err = await runExecute(bundle).catch((e) => e as unknown);
			expect(err).toBeInstanceOf(NodeOperationError);
			expect((err as Error).message).toMatch(/HTML input is empty/);
		});
	});

	describe('execute() — validation', () => {
		it('should throw NodeOperationError when title is missing', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '' }),
			});
			const err = await runExecute(bundle).catch((e) => e as unknown);
			expect(err).toBeInstanceOf(NodeOperationError);
			expect((err as Error).message).toMatch(/Title/);
		});

		it('should throw NodeOperationError when title is only whitespace', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '   \t  ' }),
			});
			const err = await runExecute(bundle).catch((e) => e as unknown);
			expect(err).toBeInstanceOf(NodeOperationError);
			expect((err as Error).message).toMatch(/Title/);
		});

		it('should throw NodeOperationError when HTML is blank', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ html: '   ' }),
			});
			const err = await runExecute(bundle).catch((e) => e as unknown);
			expect(err).toBeInstanceOf(NodeOperationError);
			expect((err as Error).message).toMatch(/HTML input is empty/);
		});

		it('should include itemIndex on the thrown NodeOperationError', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '' }),
			});
			const err = await runExecute(bundle).catch((e) => e as unknown);
			expect(err).toBeInstanceOf(NodeOperationError);
			expect((err as { context?: { itemIndex?: number } }).context?.itemIndex).toBe(0);
		});
	});

	describe('execute() — continueOnFail', () => {
		it('should yield an error item and keep processing remaining items', async () => {
			const bundle = makeExecuteFunctionsMock({
				continueOnFail: true,
				inputData: [{ json: {} }, { json: {} }],
				parameters: (name, itemIndex) => {
					if (name === 'title') return itemIndex === 0 ? '' : 'Second';
					if (name === 'html') return simpleHtml;
					if (name === 'inputSource') return 'string';
					if (name === 'outputBinaryProperty') return 'data';
					if (name === 'additionalFields') return defaultAdditional;
					return undefined;
				},
			});
			const result = await runExecute(bundle);
			expect(result[0]).toHaveLength(2);
			expect(typeof (result[0][0].json as Record<string, unknown>).error).toBe('string');
			expect((result[0][1].json as Record<string, unknown>).title).toBe('Second');
		});
	});

	describe('execute() — image inlining', () => {
		it('should call httpRequest once per unique remote image when inlineImages=true', async () => {
			const response: HttpResponse = {
				body: pngPixel,
				headers: { 'content-type': 'image/png' },
			};
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					html: htmlWithImages,
					additionalFields: { ...defaultAdditional, inlineImages: true },
				}),
				httpRequest: async () => response,
			});
			const result = await runExecute(bundle);
			expect(bundle.calls.httpRequest).toHaveLength(3);
			const imagesBundled = (result[0][0].json as Record<string, unknown>).imagesBundled;
			expect(imagesBundled).toBe(3);
		});

		it('should skip image fetching when inlineImages=false', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					html: htmlWithImages,
					additionalFields: { ...defaultAdditional, inlineImages: false },
				}),
			});
			await runExecute(bundle);
			expect(bundle.calls.httpRequest).toHaveLength(0);
		});

		it('should still succeed when every image fetch fails', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					html: htmlWithImages,
					additionalFields: { ...defaultAdditional, inlineImages: true },
				}),
				httpRequest: async () => {
					throw new Error('network down');
				},
			});
			const result = await runExecute(bundle);
			expect((result[0][0].json as Record<string, unknown>).imagesBundled).toBe(0);
			expect((result[0][0].json as Record<string, unknown>).size as number).toBeGreaterThan(0);
		});

		it('should forward custom timeoutMs and maxBytes to fetchImages', async () => {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					html: '<body><img src="https://example.com/a.png"></body>',
					additionalFields: {
						...defaultAdditional,
						inlineImages: true,
						imageTimeoutMs: 1234,
						imageMaxBytes: 100,
					},
				}),
				httpRequest: async () => ({
					body: pngPixel,
					headers: { 'content-type': 'image/png' },
				}),
			});
			await runExecute(bundle);
			expect(bundle.calls.httpRequest[0].timeout).toBe(1234);
		});
	});
});
