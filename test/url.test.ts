/* eslint-disable */
import { describe, expect, it } from 'vitest';

import { redactUrl } from '../nodes/HtmlToEpub/url';

describe('nodes/HtmlToEpub/url.ts', () => {
	describe('redactUrl()', () => {
		it('should strip the query string', () => {
			expect(redactUrl('https://example.com/path?token=secret&sig=abc')).toBe(
				'https://example.com/path',
			);
		});

		it('should strip the fragment', () => {
			expect(redactUrl('https://example.com/path#section')).toBe('https://example.com/path');
		});

		it('should strip embedded userinfo (username and password)', () => {
			expect(redactUrl('https://user:pass@example.com/path')).toBe('https://example.com/path');
		});

		it('should strip userinfo when only a username is present', () => {
			expect(redactUrl('https://user@example.com/path')).toBe('https://example.com/path');
		});

		it('should strip query, fragment, and userinfo together', () => {
			expect(
				redactUrl('https://user:secret@example.com/a/b?token=LEAK&x=1#frag'),
			).toBe('https://example.com/a/b');
		});

		it('should preserve the scheme, host, port, and pathname', () => {
			expect(redactUrl('https://example.com:8443/deep/path/file.jpg?q=1')).toBe(
				'https://example.com:8443/deep/path/file.jpg',
			);
		});

		it('should preserve http:// URLs', () => {
			expect(redactUrl('http://example.com/a?b=1')).toBe('http://example.com/a');
		});

		it('should retain the trailing slash on root-only URLs', () => {
			expect(redactUrl('https://example.com/?leak=1')).toBe('https://example.com/');
		});

		it('should return "[redacted]" for an unparseable URL', () => {
			expect(redactUrl('not a url')).toBe('[redacted]');
		});

		it('should return "[redacted]" for the empty string', () => {
			expect(redactUrl('')).toBe('[redacted]');
		});

		it('should not leak sensitive tokens under any supported URL shape', () => {
			const inputs = [
				'https://user:SECRET@example.com/path?token=SECRET#SECRET',
				'https://example.com/path?key=SECRET',
				'https://example.com/path#SECRET',
				'https://SECRET:SECRET@example.com',
			];
			for (const input of inputs) {
				expect(redactUrl(input)).not.toContain('SECRET');
			}
		});
	});
});
