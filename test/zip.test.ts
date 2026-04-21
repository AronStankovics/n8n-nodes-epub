/* eslint-disable */
import { expect } from 'chai';
import { buildZip, crc32, type ZipEntry } from '../nodes/HtmlToEpub/zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

describe('nodes/HtmlToEpub/zip.ts', function () {
	describe('crc32()', function () {
		it('should return 0 for the empty input', function () {
			expect(crc32(new Uint8Array())).to.equal(0);
		});

		it('should match the known CRC32 of "a"', function () {
			expect(crc32(encoder.encode('a'))).to.equal(0xe8b7be43);
		});

		it('should match the known CRC32 of "abc"', function () {
			expect(crc32(encoder.encode('abc'))).to.equal(0x352441c2);
		});

		it('should match the known CRC32 of the pangram', function () {
			const msg = 'The quick brown fox jumps over the lazy dog';
			expect(crc32(encoder.encode(msg))).to.equal(0x414fa339);
		});

		it('should always return an unsigned 32-bit integer', function () {
			for (const s of ['x', 'abcdefghij', 'ÿþý', 'mixed 123 ~!']) {
				const c = crc32(encoder.encode(s));
				expect(c).to.be.a('number');
				expect(c).to.be.at.least(0);
				expect(c).to.be.at.most(0xffffffff);
			}
		});
	});

	describe('buildZip()', function () {
		function readU32(bytes: Uint8Array, offset: number): number {
			return new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0, true);
		}

		function readU16(bytes: Uint8Array, offset: number): number {
			return new DataView(bytes.buffer, bytes.byteOffset + offset).getUint16(0, true);
		}

		function findEocd(bytes: Uint8Array): number {
			for (let i = bytes.length - 22; i >= 0; i--) {
				if (readU32(bytes, i) === EOCD_SIG) return i;
			}
			return -1;
		}

		function parseZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; method: number; crc: number }> {
			const eocdOffset = findEocd(bytes);
			expect(eocdOffset).to.be.at.least(0);
			const totalEntries = readU16(bytes, eocdOffset + 10);
			const centralDirOffset = readU32(bytes, eocdOffset + 16);
			const entries: Array<{ name: string; data: Uint8Array; method: number; crc: number }> = [];
			let cursor = centralDirOffset;
			for (let i = 0; i < totalEntries; i++) {
				expect(readU32(bytes, cursor)).to.equal(CENTRAL_DIR_SIG);
				const method = readU16(bytes, cursor + 10);
				const crc = readU32(bytes, cursor + 16);
				const compSize = readU32(bytes, cursor + 20);
				const nameLen = readU16(bytes, cursor + 28);
				const extraLen = readU16(bytes, cursor + 30);
				const commentLen = readU16(bytes, cursor + 32);
				const localOffset = readU32(bytes, cursor + 42);
				const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

				expect(readU32(bytes, localOffset)).to.equal(LOCAL_HEADER_SIG);
				const localNameLen = readU16(bytes, localOffset + 26);
				const localExtraLen = readU16(bytes, localOffset + 28);
				const dataStart = localOffset + 30 + localNameLen + localExtraLen;
				const data = bytes.subarray(dataStart, dataStart + compSize);
				entries.push({ name, data, method, crc });
				cursor += 46 + nameLen + extraLen + commentLen;
			}
			return entries;
		}

		it('should produce output that begins with the local-file-header signature', function () {
			const out = buildZip([{ path: 'a.txt', data: encoder.encode('hello') }]);
			expect(readU32(out, 0)).to.equal(LOCAL_HEADER_SIG);
		});

		it('should end with an end-of-central-directory record', function () {
			const out = buildZip([{ path: 'a.txt', data: encoder.encode('hello') }]);
			const eocd = findEocd(out);
			expect(eocd).to.equal(out.length - 22);
			expect(readU16(out, eocd + 10)).to.equal(1); // total entries
		});

		it('should store every entry uncompressed (method = 0)', function () {
			const entries: ZipEntry[] = [
				{ path: 'a.txt', data: encoder.encode('hello') },
				{ path: 'b.bin', data: new Uint8Array([1, 2, 3, 4]) },
			];
			const out = buildZip(entries);
			const parsed = parseZip(out);
			expect(parsed).to.have.length(2);
			for (const entry of parsed) {
				expect(entry.method).to.equal(0);
			}
		});

		it('should preserve byte-identical payloads', function () {
			const entries: ZipEntry[] = [
				{ path: 'mimetype', data: encoder.encode('application/epub+zip') },
				{ path: 'OEBPS/file.txt', data: encoder.encode('hello world') },
			];
			const out = buildZip(entries);
			const parsed = parseZip(out);
			expect(decoder.decode(parsed[0].data)).to.equal('application/epub+zip');
			expect(decoder.decode(parsed[1].data)).to.equal('hello world');
		});

		it('should write the mimetype entry first, matching EPUB spec', function () {
			const entries: ZipEntry[] = [
				{ path: 'mimetype', data: encoder.encode('application/epub+zip') },
				{ path: 'meta.xml', data: encoder.encode('<x/>') },
			];
			const out = buildZip(entries);
			const parsed = parseZip(out);
			expect(parsed[0].name).to.equal('mimetype');
		});

		it('should record a correct CRC32 for each entry', function () {
			const data = encoder.encode('abc');
			const out = buildZip([{ path: 'x', data }]);
			const parsed = parseZip(out);
			expect(parsed[0].crc).to.equal(0x352441c2);
		});

		it('should store UTF-8 file names verbatim', function () {
			const entries: ZipEntry[] = [{ path: 'folder/ünïcödé.txt', data: encoder.encode('hi') }];
			const out = buildZip(entries);
			const parsed = parseZip(out);
			expect(parsed[0].name).to.equal('folder/ünïcödé.txt');
		});

		it('should build a zero-entry archive as a valid EOCD-only ZIP', function () {
			const out = buildZip([]);
			const eocd = findEocd(out);
			expect(eocd).to.equal(out.length - 22);
			expect(readU16(out, eocd + 10)).to.equal(0);
		});

		it('should preserve insertion order of entries', function () {
			const entries: ZipEntry[] = [
				{ path: 'one', data: encoder.encode('1') },
				{ path: 'two', data: encoder.encode('2') },
				{ path: 'three', data: encoder.encode('3') },
			];
			const out = buildZip(entries);
			const parsed = parseZip(out);
			expect(parsed.map((p) => p.name)).to.deep.equal(['one', 'two', 'three']);
		});
	});
});
