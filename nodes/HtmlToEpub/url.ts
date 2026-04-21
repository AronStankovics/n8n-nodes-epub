// Strip query string and fragment (and any embedded credentials) so error
// messages can't leak signed-URL tokens into logs/UI.
export function redactUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.search = '';
		parsed.hash = '';
		parsed.username = '';
		parsed.password = '';
		return parsed.toString();
	} catch {
		return '[redacted]';
	}
}
