import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildEpub, type EpubInput } from './epub';

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
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Short description stored as dc:description',
					},
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						placeholder: 'article.epub',
						description:
							'Override the output file name. Defaults to a slugified title or "article.epub".',
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
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: 'en',
						placeholder: 'en',
						description: 'BCP-47 language tag (e.g. en, en-US, de, fr). Defaults to "en".',
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
					description?: string;
					fileName?: string;
					identifier?: string;
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

				const epubInput: EpubInput = {
					html,
					title,
					author: additionalFields.author?.trim() || undefined,
					description: additionalFields.description?.trim() || undefined,
					identifier: additionalFields.identifier?.trim() || undefined,
					language: additionalFields.language?.trim() || undefined,
					publisher: additionalFields.publisher?.trim() || undefined,
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
