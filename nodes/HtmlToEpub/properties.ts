import type { INodeProperties } from 'n8n-workflow';

export const properties: INodeProperties[] = [
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
				displayName: 'CSS Mode',
				name: 'cssMode',
				type: 'options',
				default: 'append',
				options: [
					{
						name: 'Append to Default',
						value: 'append',
						description:
							'Add Custom CSS after the built-in stylesheet so it can override individual rules',
					},
					{
						name: 'Replace Default',
						value: 'replace',
						description:
							'Use Custom CSS as the only stylesheet — the built-in styles are dropped',
					},
				],
				description: 'How Custom CSS combines with the built-in stylesheet. Ignored when Custom CSS is empty.',
			},
			{
				displayName: 'Custom CSS',
				name: 'customCss',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				placeholder: 'body { font-family: Georgia, serif; }',
				description:
					'Extra CSS bundled into the EPUB as style.css. Combined with the built-in stylesheet according to CSS Mode.',
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
];
