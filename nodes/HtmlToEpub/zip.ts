// Pure-JS ZIP writer with the STORE method (no compression).
// Zero runtime dependencies — safe for n8n Cloud verified nodes.
// EPUB-compliant: the first entry can be written uncompressed with
// a proper CRC, which is all EPUB readers require for `mimetype`.

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

// Precomputed CRC32 table (polynomial 0xEDB88320).
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		const idx = (c ^ bytes[i]) & 0xff;
		c = (CRC_TABLE[idx] ^ (c >>> 8)) >>> 0;
	}
	return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	path: string;
	data: Uint8Array;
}

// DOS time/date encoding used inside ZIP headers.
function dosDateTime(d: Date): { time: number; date: number } {
	const time =
		((d.getHours() & 0x1f) << 11) |
		((d.getMinutes() & 0x3f) << 5) |
		((d.getSeconds() >> 1) & 0x1f);
	const year = d.getFullYear();
	const date =
		(((year - 1980) & 0x7f) << 9) |
		(((d.getMonth() + 1) & 0x0f) << 5) |
		(d.getDate() & 0x1f);
	return { time, date };
}

function writeU16(view: DataView, offset: number, value: number): void {
	view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
	view.setUint32(offset, value >>> 0, true);
}

function utf8(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

// Build a ZIP archive from the given entries.
// All entries are stored uncompressed (method=0). This is valid per the ZIP
// and EPUB specifications; EPUB readers tolerate STORE-only containers.
export function buildZip(entries: ZipEntry[]): Uint8Array {
	const now = new Date();
	const { time, date } = dosDateTime(now);

	interface Pending {
		nameBytes: Uint8Array;
		data: Uint8Array;
		crc: number;
		localHeaderOffset: number;
	}

	const pending: Pending[] = [];
	let offset = 0;

	// First pass: compute local-file headers and data sizes.
	const chunks: Uint8Array[] = [];
	for (const entry of entries) {
		const nameBytes = utf8(entry.path);
		const crc = crc32(entry.data);
		const headerSize = 30 + nameBytes.length;
		const header = new Uint8Array(headerSize);
		const view = new DataView(header.buffer);
		writeU32(view, 0, LOCAL_FILE_HEADER_SIG);
		writeU16(view, 4, 20); // version needed to extract
		writeU16(view, 6, 0); // general purpose flag
		writeU16(view, 8, 0); // compression method (0 = STORE)
		writeU16(view, 10, time);
		writeU16(view, 12, date);
		writeU32(view, 14, crc);
		writeU32(view, 18, entry.data.length); // compressed size
		writeU32(view, 22, entry.data.length); // uncompressed size
		writeU16(view, 26, nameBytes.length);
		writeU16(view, 28, 0); // extra field length
		header.set(nameBytes, 30);
		chunks.push(header);
		chunks.push(entry.data);

		pending.push({ nameBytes, data: entry.data, crc, localHeaderOffset: offset });
		offset += headerSize + entry.data.length;
	}

	// Central directory.
	const centralDirStart = offset;
	for (const p of pending) {
		const entrySize = 46 + p.nameBytes.length;
		const cdEntry = new Uint8Array(entrySize);
		const view = new DataView(cdEntry.buffer);
		writeU32(view, 0, CENTRAL_DIR_SIG);
		writeU16(view, 4, 20); // version made by
		writeU16(view, 6, 20); // version needed to extract
		writeU16(view, 8, 0); // general purpose flag
		writeU16(view, 10, 0); // compression method
		writeU16(view, 12, time);
		writeU16(view, 14, date);
		writeU32(view, 16, p.crc);
		writeU32(view, 20, p.data.length); // compressed size
		writeU32(view, 24, p.data.length); // uncompressed size
		writeU16(view, 28, p.nameBytes.length);
		writeU16(view, 30, 0); // extra field length
		writeU16(view, 32, 0); // file comment length
		writeU16(view, 34, 0); // disk number start
		writeU16(view, 36, 0); // internal file attributes
		writeU32(view, 38, 0); // external file attributes
		writeU32(view, 42, p.localHeaderOffset);
		cdEntry.set(p.nameBytes, 46);
		chunks.push(cdEntry);
		offset += entrySize;
	}
	const centralDirSize = offset - centralDirStart;

	// End-of-central-directory record.
	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	writeU32(eocdView, 0, END_OF_CENTRAL_DIR_SIG);
	writeU16(eocdView, 4, 0); // disk number
	writeU16(eocdView, 6, 0); // disk with central dir
	writeU16(eocdView, 8, pending.length); // entries this disk
	writeU16(eocdView, 10, pending.length); // total entries
	writeU32(eocdView, 12, centralDirSize);
	writeU32(eocdView, 16, centralDirStart);
	writeU16(eocdView, 20, 0); // comment length
	chunks.push(eocd);

	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const c of chunks) {
		out.set(c, pos);
		pos += c.length;
	}
	return out;
}
