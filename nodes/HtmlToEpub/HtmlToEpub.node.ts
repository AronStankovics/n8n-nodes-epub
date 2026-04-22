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
import { properties } from './properties';

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
		properties,
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
					cssMode?: 'append' | 'replace';
					customCss?: string;
					coverBinaryProperty?: string;
					coverUrl?: string;
					description?: string;
					fileName?: string;
					generateTocFromHeadings?: boolean;
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
					if (buffer.length > imageMaxBytes) {
						throw new NodeOperationError(
							this.getNode(),
							`Cover image exceeds the maximum allowed size of ${imageMaxBytes} bytes`,
							{ itemIndex },
						);
					}
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
					generateTocFromHeadings: additionalFields.generateTocFromHeadings,
					customCss: additionalFields.customCss,
					cssMode: additionalFields.cssMode,
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
