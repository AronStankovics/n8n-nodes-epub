/* eslint-disable */
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as chai from 'chai';
import { NodeOperationError } from 'n8n-workflow';

import { HtmlToEpub } from '../nodes/HtmlToEpub/HtmlToEpub.node';
import {
	htmlWithImages,
	makeExecuteFunctionsMock,
	pngPixel,
	simpleHtml,
	type ExecuteMock,
	type HttpResponse,
} from './test-data';

chai.use(chaiAsPromised);

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

describe('nodes/HtmlToEpub/HtmlToEpub.node.ts', function () {
	describe('description metadata', function () {
		it('should define a valid node description', function () {
			const node = new HtmlToEpub();
			expect(node.description.name).to.equal('htmlToEpub');
			expect(node.description.displayName).to.equal('HTML to EPUB');
			expect(node.description.usableAsTool).to.equal(true);
			const propertyNames = node.description.properties.map((p) => p.name);
			expect(propertyNames).to.include.members([
				'inputSource',
				'html',
				'title',
				'outputBinaryProperty',
				'additionalFields',
			]);
		});
	});

	describe('execute() — happy path', function () {
		it('should return a binary EPUB and correct JSON metadata', async function () {
			const bundle = makeExecuteFunctionsMock({ parameters: buildParams() });
			const result = await runExecute(bundle);
			expect(result).to.be.an('array').with.length(1);
			const output = result[0];
			expect(output).to.have.length(1);
			const json = output[0].json as Record<string, unknown>;
			expect(json.title).to.equal('My Article');
			expect(json.fileName).to.equal('My Article.epub');
			expect(json.imagesBundled).to.equal(0);
			expect(json.size).to.be.a('number').and.greaterThan(0);
			expect(output[0].binary).to.have.property('data');
			expect(output[0].pairedItem).to.deep.equal({ item: 0 });
		});

		it('should call helpers.prepareBinaryData with the correct file name and mime type', async function () {
			const bundle = makeExecuteFunctionsMock({ parameters: buildParams() });
			await runExecute(bundle);
			expect(bundle.calls.prepareBinaryData).to.have.length(1);
			const call = bundle.calls.prepareBinaryData[0];
			expect(call.fileName).to.equal('My Article.epub');
			expect(call.mimeType).to.equal('application/epub+zip');
			expect(call.size).to.be.greaterThan(0);
		});

		it('should honor a custom output binary property name', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ outputBinaryProperty: 'myEpub' }),
			});
			const result = await runExecute(bundle);
			expect(result[0][0].binary).to.have.property('myEpub');
			expect(result[0][0].binary).to.not.have.property('data');
		});

		it('should honor an explicit file name override', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					additionalFields: { ...defaultAdditional, fileName: 'custom-name' },
				}),
			});
			const result = await runExecute(bundle);
			expect((result[0][0].json as Record<string, unknown>).fileName).to.equal('custom-name.epub');
		});

		it('should not add a second .epub suffix when override already has one', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					additionalFields: { ...defaultAdditional, fileName: 'already.epub' },
				}),
			});
			const result = await runExecute(bundle);
			expect((result[0][0].json as Record<string, unknown>).fileName).to.equal('already.epub');
		});

		it('should sanitise unsafe characters out of the default file name', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: 'My / Article: "Hello" | foo*?<>' }),
			});
			const result = await runExecute(bundle);
			const fileName = (result[0][0].json as Record<string, unknown>).fileName as string;
			expect(fileName).to.not.match(/[\\/:"*?<>|]/);
			expect(fileName.endsWith('.epub')).to.equal(true);
		});
	});

	describe('execute() — binary input source', function () {
		it('should read HTML from a binary property when inputSource=binary', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					inputSource: 'binary',
					inputBinaryProperty: 'html',
				}),
				getBinaryDataBuffer: async () => Buffer.from(simpleHtml, 'utf-8'),
			});
			await runExecute(bundle);
			expect(bundle.calls.getBinaryDataBuffer).to.have.length(1);
			expect(bundle.calls.getBinaryDataBuffer[0]).to.deep.equal({
				itemIndex: 0,
				property: 'html',
			});
		});

		it('should error out when the binary property resolves to empty bytes', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ inputSource: 'binary' }),
				getBinaryDataBuffer: async () => Buffer.from(''),
			});
			await expect(runExecute(bundle)).to.be.rejectedWith(NodeOperationError, /HTML input is empty/);
		});
	});

	describe('execute() — validation', function () {
		it('should throw NodeOperationError when title is missing', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '' }),
			});
			await expect(runExecute(bundle)).to.be.rejectedWith(NodeOperationError, /Title/);
		});

		it('should throw NodeOperationError when title is only whitespace', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '   \t  ' }),
			});
			await expect(runExecute(bundle)).to.be.rejectedWith(NodeOperationError, /Title/);
		});

		it('should throw NodeOperationError when HTML is blank', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ html: '   ' }),
			});
			await expect(runExecute(bundle)).to.be.rejectedWith(NodeOperationError, /HTML input is empty/);
		});

		it('should include itemIndex on the thrown NodeOperationError', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({ title: '' }),
			});
			try {
				await runExecute(bundle);
				expect.fail('expected NodeOperationError');
			} catch (err) {
				expect(err).to.be.instanceOf(NodeOperationError);
				expect((err as { context?: { itemIndex?: number } }).context?.itemIndex).to.equal(0);
			}
		});
	});

	describe('execute() — continueOnFail', function () {
		it('should yield an error item and keep processing remaining items', async function () {
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
			expect(result[0]).to.have.length(2);
			expect((result[0][0].json as Record<string, unknown>).error).to.be.a('string');
			expect((result[0][1].json as Record<string, unknown>).title).to.equal('Second');
		});
	});

	describe('execute() — image inlining', function () {
		it('should call httpRequest once per unique remote image when inlineImages=true', async function () {
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
			// htmlWithImages has 3 unique remote URLs (a.jpg, b.png, c.gif)
			expect(bundle.calls.httpRequest).to.have.length(3);
			const imagesBundled = (result[0][0].json as Record<string, unknown>).imagesBundled;
			expect(imagesBundled).to.equal(3);
		});

		it('should skip image fetching when inlineImages=false', async function () {
			const bundle = makeExecuteFunctionsMock({
				parameters: buildParams({
					html: htmlWithImages,
					additionalFields: { ...defaultAdditional, inlineImages: false },
				}),
			});
			await runExecute(bundle);
			expect(bundle.calls.httpRequest).to.have.length(0);
		});

		it('should still succeed when every image fetch fails', async function () {
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
			expect((result[0][0].json as Record<string, unknown>).imagesBundled).to.equal(0);
			expect((result[0][0].json as Record<string, unknown>).size).to.be.greaterThan(0);
		});

		it('should forward custom timeoutMs and maxBytes to fetchImages', async function () {
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
			expect(bundle.calls.httpRequest[0].timeout).to.equal(1234);
		});
	});
});
