import { carriesData } from "./tags.js";
import { OscError, type OscArg } from "./types.js";

/**
 * Binary encoder for OSC packets.
 *
 * Follows the OpenSoundControl Specification 1.0. Every atomic type is a
 * multiple of 32 bits, so the encoder emits into 4-byte-aligned chunks and the
 * finished packet is always a multiple of 4 bytes long.
 */

/** Rounds a byte count up to the next multiple of 4. */
function align4(length: number): number {
	return (length + 3) & ~3;
}

/**
 * Encodes an OSC-string: the characters, a terminating null, then 0–3 further
 * nulls so the total is a multiple of 4 bytes.
 *
 * Note that a string whose length is already a multiple of 4 still gains a full
 * 4 bytes of padding — "data" occupies 8 bytes, not 4. This is the single most
 * commonly mis-implemented rule in the format.
 *
 * The spec calls for ASCII. UTF-8 is emitted here because it is a superset of
 * ASCII and is what the wider ecosystem does in practice; anything outside the
 * ASCII range is technically out of spec and may be rejected by a receiver.
 */
export function encodeString(value: string): Buffer {
	if (value.includes("\0")) {
		throw new OscError("OSC-strings cannot contain null characters.");
	}

	const bytes = Buffer.from(value, "utf8");
	const buffer = Buffer.alloc(align4(bytes.length + 1)); // alloc zero-fills, which is the padding
	bytes.copy(buffer);
	return buffer;
}

/**
 * Encodes an OSC-blob: an int32 byte count, the bytes themselves, then 0–3
 * zero bytes of padding.
 *
 * Unlike an OSC-string a blob has no terminator, so a blob of 4 bytes occupies
 * exactly 8 bytes in total (4 for the count, 4 for the data).
 */
export function encodeBlob(value: Uint8Array): Buffer {
	const buffer = Buffer.alloc(4 + align4(value.length));
	buffer.writeInt32BE(value.length, 0);
	Buffer.from(value).copy(buffer, 4);
	return buffer;
}

/** Encodes a single argument's data. Returns an empty buffer for the no-data tags. */
function encodeArgData(arg: OscArg): Buffer {
	switch (arg.tag) {
		case "T":
		case "F":
		case "N":
		case "I":
		case "[":
		case "]":
			return Buffer.alloc(0);

		case "i": {
			const buffer = Buffer.alloc(4);
			buffer.writeInt32BE(arg.value, 0);
			return buffer;
		}

		case "f": {
			const buffer = Buffer.alloc(4);
			buffer.writeFloatBE(arg.value, 0);
			return buffer;
		}

		case "d": {
			const buffer = Buffer.alloc(8);
			buffer.writeDoubleBE(arg.value, 0);
			return buffer;
		}

		case "h": {
			const buffer = Buffer.alloc(8);
			buffer.writeBigInt64BE(arg.value, 0);
			return buffer;
		}

		case "t": {
			const buffer = Buffer.alloc(8);
			buffer.writeBigUInt64BE(arg.value, 0);
			return buffer;
		}

		case "c": {
			// "an ascii character, sent as 32 bits"
			const buffer = Buffer.alloc(4);
			buffer.writeUInt32BE(arg.value, 0);
			return buffer;
		}

		case "r": {
			// 32-bit RGBA, red in the most significant byte.
			const buffer = Buffer.alloc(4);
			buffer.writeUInt32BE(arg.value >>> 0, 0);
			return buffer;
		}

		case "m":
			// "Bytes from MSB to LSB are: port id, status byte, data1, data2" —
			// already validated as exactly 4 bytes, and needs no padding.
			return Buffer.from(arg.value);

		case "s":
		case "S":
			return encodeString(arg.value);

		case "b":
			return encodeBlob(arg.value);
	}
}

/**
 * Checks that array-start and array-end tags are balanced and correctly nested.
 * The brackets appear in the type tag string only and contribute no data.
 */
function validateArrayNesting(args: readonly OscArg[]): void {
	let depth = 0;
	for (const arg of args) {
		if (arg.tag === "[") {
			depth++;
		} else if (arg.tag === "]") {
			depth--;
			if (depth < 0) {
				throw new OscError("Array end tag ']' appears without a matching '['.");
			}
		}
	}
	if (depth !== 0) {
		throw new OscError(`Array start tag '[' is unclosed (${depth} still open).`);
	}
}

/**
 * Encodes an OSC Message: the address pattern, the type tag string, then the
 * argument data in the same order as the tags.
 *
 * The address is expected to have already been validated and normalised by
 * {@link normaliseAddress}.
 */
export function encodeMessage(address: string, args: readonly OscArg[]): Buffer {
	validateArrayNesting(args);

	// The type tag string always begins with a comma, even with no arguments,
	// so that a receiver can tell a tag string is present at all.
	const typeTags = `,${args.map((arg) => arg.tag).join("")}`;

	const parts: Buffer[] = [encodeString(address), encodeString(typeTags)];
	for (const arg of args) {
		if (carriesData(arg.tag)) {
			parts.push(encodeArgData(arg));
		}
	}

	return Buffer.concat(parts);
}

/** Time tag meaning "immediately": 63 zero bits followed by a one. */
export const TIMETAG_IMMEDIATE = 1n;

/**
 * Encodes an OSC Bundle: the string "#bundle", a time tag, then each element
 * preceded by its int32 size.
 *
 * Not currently reachable from the property inspector, but the action layer
 * uses it when a button is configured to send several messages atomically.
 */
export function encodeBundle(elements: readonly Buffer[], timetag: bigint = TIMETAG_IMMEDIATE): Buffer {
	const header = Buffer.alloc(8);
	header.writeBigUInt64BE(timetag, 0);

	const parts: Buffer[] = [encodeString("#bundle"), header];
	for (const element of elements) {
		const size = Buffer.alloc(4);
		size.writeInt32BE(element.length, 0);
		parts.push(size, element);
	}

	return Buffer.concat(parts);
}
