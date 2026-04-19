# n8n-nodes-epub

[![npm version](https://img.shields.io/npm/v/n8n-nodes-epub.svg)](https://www.npmjs.com/package/n8n-nodes-epub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An [n8n](https://n8n.io) community node that turns **HTML → EPUB** entirely in memory — **zero runtime dependencies**, so it's eligible for n8n Cloud verification.

Good fit for newsletter-to-Kindle pipelines, archiving articles to your e-reader, replacing Readbetter/Pocket-to-Kindle on your own infra.

## Features

- **HTML to EPUB** in a single node, no external binary or CLI required
- Zero runtime dependencies — builds the ZIP container and OPF/XHTML templates from scratch
- Works on **n8n Cloud** as well as self-hosted
- Valid EPUB 3 output (with EPUB 2 `toc.ncx` compatibility)
- Sensible default stylesheet
- Strips scripts, iframes, and inline event handlers from the input HTML

## Install

In the n8n UI: **Settings → Community Nodes → Install**, then enter `n8n-nodes-epub`.

## Quick usage

Wire up:

1. **HTTP Request** (or Gmail / whatever produces the article HTML)
2. **HTML to EPUB** — set *Title*, pass the HTML through
3. **Gmail / Dropbox / Webhook** to deliver the resulting `.epub` (e.g. to `your-kindle@kindle.com`)

### Newsletter-to-Kindle example

```
Gmail Trigger (label: to-kindle)
   └▶ Code (extract text/html MIME part)
       └▶ HTML to EPUB (title = email subject, HTML = decoded body)
           └▶ Gmail Send (to your-kindle@kindle.com, attachment from binary property)
```

## Node parameters

| Parameter | Description |
|---|---|
| Input Source | `HTML String` or `Binary` |
| HTML | The raw HTML article (when Input Source = HTML String) |
| Input Binary Property | Binary property name holding the HTML bytes (when Input Source = Binary) |
| Title | Required. Used as book title, chapter heading, and TOC label. |
| Output Binary Property | Property name to write the generated EPUB to. Defaults to `data`. |

### Additional fields

| Field | Stored as |
|---|---|
| Author | `dc:creator` |
| Description | `dc:description` |
| File Name | Override output filename (default: slugified title) |
| Identifier (UUID) | Stable `dc:identifier`. Random UUID if omitted. |
| Language | BCP-47 tag, stored as `dc:language`. Default `en`. |
| Publisher | `dc:publisher` |

## How it works

- The input HTML is lightly sanitized (scripts, iframes, inline handlers removed; void elements self-closed) and wrapped in a valid XHTML chapter.
- Seven files are assembled in memory:
  - `mimetype`, `META-INF/container.xml`
  - `OEBPS/content.opf`, `OEBPS/nav.xhtml`, `OEBPS/toc.ncx`
  - `OEBPS/chapter.xhtml`, `OEBPS/style.css`
- The files are packed into a ZIP archive using the **STORE** method (no DEFLATE, since no compression library is allowed for verified community nodes). A manual CRC32 is computed per entry.
- `mimetype` is written first, uncompressed, as required by the EPUB spec.

Produced files typically range 10–100 KB and open cleanly in Apple Books, Kindle, Kobo, Calibre, and Readium.

## Development

```bash
npm install
npm run lint
npm run build
npm run dev        # live-reload against a local n8n instance
```

Release (after committing changes):

```bash
npm run release
```

This uses `@n8n/node-cli` and the bundled GitHub Actions workflow (`.github/workflows/publish.yml`) to publish to npm with an attached provenance statement, satisfying the verified-node requirements introduced in May 2026.

## License

[MIT](./LICENSE)
