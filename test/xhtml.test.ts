/* eslint-disable */
import { describe, expect, it } from 'vitest';

import { htmlToXhtmlBody, xmlEscape } from '../nodes/HtmlToEpub/xhtml';
import {
	htmlWithAmpersands,
	htmlWithEventHandlers,
	htmlWithScripts,
	htmlWithVoidElements,
	malformedHtml,
	simpleHtml,
} from './test-data';

describe('nodes/HtmlToEpub/xhtml.ts', () => {
	describe('xmlEscape()', () => {
		it('should escape all five XML special characters', () => {
			expect(xmlEscape(`<a href="x">1 & 2 'q'</a>`)).toBe(
				'&lt;a href=&quot;x&quot;&gt;1 &amp; 2 &apos;q&apos;&lt;/a&gt;',
			);
		});

		it('should double-escape already-escaped ampersands', () => {
			expect(xmlEscape('fish &amp; chips')).toBe('fish &amp;amp; chips');
		});

		it('should return empty string unchanged', () => {
			expect(xmlEscape('')).toBe('');
		});

		it('should leave plain text untouched', () => {
			expect(xmlEscape('hello world 123')).toBe('hello world 123');
		});
	});

	describe('htmlToXhtmlBody()', () => {
		it('should extract the body when <body> is present', () => {
			const out = htmlToXhtmlBody(simpleHtml);
			expect(out).toContain('<h1>Hello</h1>');
			expect(out).toContain('<strong>bold</strong>');
			expect(out).not.toContain('Ignore me');
			expect(out).not.toContain('<title>');
		});

		it('should fall back to the raw html when no <body> tag exists', () => {
			const out = htmlToXhtmlBody('<p>just a paragraph</p>');
			expect(out).toContain('<p>just a paragraph</p>');
		});

		it('should slice after </head> when there is no body', () => {
			const out = htmlToXhtmlBody('<head><meta charset="utf-8"/></head><p>after</p>');
			expect(out).not.toContain('<meta');
			expect(out).toContain('<p>after</p>');
		});

		it('should strip <script>, <iframe>, <style>, and <noscript>', () => {
			const out = htmlToXhtmlBody(htmlWithScripts);
			expect(out).not.toContain('<script');
			expect(out).not.toContain("alert('xss')");
			expect(out).not.toContain('<iframe');
			expect(out).not.toContain('<style');
			expect(out).not.toContain('.evil');
			expect(out).toContain('Before');
			expect(out).toContain('Middle');
			expect(out).toContain('After');
		});

		it('should strip on* event handlers from attributes', () => {
			const out = htmlToXhtmlBody(htmlWithEventHandlers);
			expect(out).not.toContain('onclick');
			expect(out).not.toContain('onmouseover');
			expect(out).not.toContain('onload');
			expect(out).not.toContain('alert(1)');
			expect(out).not.toContain('stealCookies');
			expect(out).toContain('Click');
		});

		it('should self-close every void element', () => {
			const out = htmlToXhtmlBody(htmlWithVoidElements);
			expect(out).toMatch(/<br\s*\/>/);
			expect(out).toMatch(/<hr\s*\/>/);
			expect(out).toMatch(/<img[^>]*\/>/);
			expect(out).toMatch(/<meta[^>]*\/>/);
			expect(out).toMatch(/<input[^>]*\/>/);
			expect(out).toMatch(/<link[^>]*\/>/);
			expect(out).not.toMatch(/<br>/);
			expect(out).not.toMatch(/<hr>/);
		});

		it('should not double-close already self-closed void elements', () => {
			const out = htmlToXhtmlBody('<body><img src="x"/><br/></body>');
			expect(out).not.toContain('//');
			expect(out).toMatch(/<img[^>]*\/>/);
		});

		it('should escape stray ampersands but leave existing entities alone', () => {
			const out = htmlToXhtmlBody(htmlWithAmpersands);
			expect(out).toContain('salt &amp; vinegar');
			expect(out).toContain('Fish &amp; chips');
			expect(out).toContain('&#233;');
			expect(out).toContain('&eacute;');
		});

		it('should remove HTML comments', () => {
			const out = htmlToXhtmlBody('<body><!-- hidden --><p>visible</p></body>');
			expect(out).not.toContain('hidden');
			expect(out).toContain('visible');
		});

		it('should not throw on malformed HTML', () => {
			expect(() => htmlToXhtmlBody(malformedHtml)).not.toThrow();
		});

		it('should trim whitespace from the output', () => {
			const out = htmlToXhtmlBody('<body>   <p>x</p>\n\n   </body>');
			expect(out.startsWith('<p>')).toBe(true);
			expect(out.endsWith('</p>')).toBe(true);
		});
	});
});
