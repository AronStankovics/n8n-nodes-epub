import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildEpub, type EpubInput } from './epub';
import {
	coverFromBinary,
	extractImageUrls,
	fetchCoverImage,
	fetchImages,
	rewriteImgSrc,
	type FetchedImage,
} from './images';

type InputSource = 'string' | 'binary';

export class HtmlToEpub implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTML to EPUB',
		name: 'htmlToEpub',
		icon: { light: 'file:htmlToEpub.svg', dark: 'file:htmlToEpub.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["title"]}}',
		description:
			'Convert an HTML article into a valid EPUB e-book. Runs entirely in memory with zero runtime dependencies.',
		defaults: {
			name: 'HTML to EPUB',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				default: 'string',
				options: [
					{
						name: 'HTML String',
						value: 'string',
						description: 'Pass HTML directly as a string',
					},
					{
						name: 'Binary',
						value: 'binary',
						description: 'Read HTML from a binary property on the input item',
					},
				],
			},
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				required: true,
				placeholder: '<html>…</html>',
				displayOptions: { show: { inputSource: ['string'] } },
			},
			{
				displayName: 'Input Binary Property',
				name: 'inputBinaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property that holds the HTML',
				displayOptions: { show: { inputSource: ['binary'] } },
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'My Newsletter',
				description: 'Title of the e-book — also used as chapter heading and navigation label',
			},
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property the generated EPUB will be written to',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				options: [
					{
						displayName: 'Author',
						name: 'author',
						type: 'string',
						default: '',
						description: 'Author of the article, stored as dc:creator',
					},
					{
						displayName: 'Cover Binary Property',
						name: 'coverBinaryProperty',
						type: 'string',
						default: '',
						placeholder: 'cover',
						description:
							'Name of a binary property on the input item to use as the book cover. Takes precedence over Cover URL.',
					},
					{
						displayName: 'Cover URL',
						name: 'coverUrl',
						type: 'string',
						default: '',
						placeholder: 'https://example.com/cover.jpg',
						description:
							'URL of an image to download and use as the book cover. Ignored when Cover Binary Property is set.',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Short description stored as dc:description',
					},
					{
						displayName: 'Fetch Image Timeout (Ms)',
						name: 'imageTimeoutMs',
						type: 'number',
						default: 30000,
						description:
							'How long to wait for each image download before giving up. Failed images keep their remote src as a fallback.',
					},
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						placeholder: 'article.epub',
						description:
							'Override the output file name. Defaults to the title plus ".epub".',
					},
					{
						displayName: 'Identifier (UUID)',
						name: 'identifier',
						type: 'string',
						default: '',
						placeholder: '00000000-0000-0000-0000-000000000000',
						description:
							'Stable identifier for the book. When empty, a random UUID is generated on every run.',
					},
					{
						displayName: 'Inline Images',
						name: 'inlineImages',
						type: 'boolean',
						default: true,
						description:
							'Whether to download every remote image in the HTML and bundle it inside the EPUB. Needed for offline reading on Kindle/Kobo.',
					},
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: 'en',
						placeholder: 'en',
						description: 'BCP-47 language tag (e.g. en, en-US, de, fr). Defaults to "en".',
					},
					{
						displayName: 'Max Image Bytes',
						name: 'imageMaxBytes',
						type: 'number',
						default: 10485760,
						description: 'Skip any single image larger than this number of bytes',
					},
					{
						displayName: 'Publisher',
						name: 'publisher',
						type: 'string',
						default: '',
						description: 'Publisher stored as dc:publisher',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputSource = this.getNodeParameter('inputSource', itemIndex) as InputSource;
				const title = (this.getNodeParameter('title', itemIndex) as string).trim();
				const outputBinaryProperty = this.getNodeParameter(
					'outputBinaryProperty',
					itemIndex,
				) as string;
				const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as {
					author?: string;
					coverBinaryProperty?: string;
					coverUrl?: string;
					description?: string;
					fileName?: string;
					identifier?: string;
					imageMaxBytes?: number;
					imageTimeoutMs?: number;
					inlineImages?: boolean;
					language?: string;
					publisher?: string;
				};

				if (!title) {
					throw new NodeOperationError(
						this.getNode(),
						'The "Title" parameter is required.',
						{ itemIndex },
					);
				}

				let html: string;
				if (inputSource === 'string') {
					html = this.getNodeParameter('html', itemIndex) as string;
				} else {
					const binaryProperty = this.getNodeParameter(
						'inputBinaryProperty',
						itemIndex,
					) as string;
					const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryProperty);
					html = buffer.toString('utf-8');
				}

				if (!html.trim()) {
					throw new NodeOperationError(
						this.getNode(),
						'The HTML input is empty. Provide the article HTML via the "HTML" field or a binary property.',
						{ itemIndex },
					);
				}

				const imageTimeoutMs = additionalFields.imageTimeoutMs ?? 30000;
				const imageMaxBytes = additionalFields.imageMaxBytes ?? 10 * 1024 * 1024;

				let finalHtml = html;
				const fetchedImages = [];
				const inlineImages = additionalFields.inlineImages ?? true;
				if (inlineImages) {
					const urls = extractImageUrls(html);
					if (urls.length > 0) {
						const imageMap = await fetchImages(this, urls, {
							timeoutMs: imageTimeoutMs,
							maxBytes: imageMaxBytes,
							userAgent: 'n8n-nodes-epub/1.0',
						});
						finalHtml = rewriteImgSrc(html, imageMap);
						for (const img of imageMap.values()) fetchedImages.push(img);
					}
				}

				let cover: FetchedImage | undefined;
				const coverBinaryProperty = additionalFields.coverBinaryProperty?.trim();
				const coverUrl = additionalFields.coverUrl?.trim();
				if (coverBinaryProperty) {
					const binary = this.helpers.assertBinaryData(itemIndex, coverBinaryProperty);
					const buffer = await this.helpers.getBinaryDataBuffer(
						itemIndex,
						coverBinaryProperty,
					);
					cover = coverFromBinary(new Uint8Array(buffer), binary.mimeType || '');
				} else if (coverUrl) {
					cover = await fetchCoverImage(this, coverUrl, {
						timeoutMs: imageTimeoutMs,
						maxBytes: imageMaxBytes,
						userAgent: 'n8n-nodes-epub/1.0',
					});
				}

				const epubInput: EpubInput = {
					html: finalHtml,
					title,
					author: additionalFields.author?.trim() || undefined,
					description: additionalFields.description?.trim() || undefined,
					identifier: additionalFields.identifier?.trim() || undefined,
					language: additionalFields.language?.trim() || undefined,
					publisher: additionalFields.publisher?.trim() || undefined,
					images: fetchedImages,
					cover,
				};

				const epubBytes = buildEpub(epubInput);

				const fileName = resolveFileName(additionalFields.fileName, title);
				const binaryData = await this.helpers.prepareBinaryData(
					Buffer.from(epubBytes),
					fileName,
					'application/epub+zip',
				);

				returnData.push({
					json: {
						fileName,
						size: epubBytes.length,
						title,
						imagesBundled: fetchedImages.length,
						hasCover: cover != null,
					},
					binary: { [outputBinaryProperty]: binaryData },
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeOperationError) throw error;
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}

function resolveFileName(override: string | undefined, title: string): string {
	const trimmed = override?.trim();
	if (trimmed) {
		return trimmed.toLowerCase().endsWith('.epub') ? trimmed : `${trimmed}.epub`;
	}
	const safe = title
		.replace(/[/\\:*?"<>|]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s.]+|[\s.]+$/g, '')
		.slice(0, 200);
	return `${safe || 'article'}.epub`;
}
