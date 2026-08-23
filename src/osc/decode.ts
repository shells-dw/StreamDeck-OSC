import { carriesData, isOscTypeTag, type OscTypeTag } from "./tags.js";
import { OscError } from "./types.js";

/**
 * Binary decoder for OSC packets.
 *
 * The mirror of encode.ts, and tested by round-tripping the same byte-exact
 * fixtures from the specification. Used for incoming traffic only, so it is
 * deliberately strict: a packet that does not parse is dropped rather than
 * guessed at, because a misparsed value shown on a key is worse than no value.
 */

/** A decoded argument. Values map onto the same tags the encoder emits. */
export type DecodedArg = {
	tag: OscTypeTag;
	value: number | bigint | string | Uint8Array | boolean | null | undefined;
};

export type DecodedMessage = {
	address: string;
	args: DecodedArg[];
};

/** How deeply bundles may nest before a packet is treated as hostile. */
const MAX_BUNDLE_DEPTH = 16;

/** Rounds a byte count up to the next multiple of 4. */
function align4(length: number): number {
	return (length + 3) & ~3;
}

type Cursor = { offset: number };

function readString(buffer: Buffer, cursor: Cursor): string {
	const end = buffer.indexOf(0, cursor.offset);
	if (end === -1) {
		throw new OscError("Unterminated OSC-string.");
	}

	const value = buffer.toString("utf8", cursor.offset, end);
	// The string, its terminator, and 0-3 further nulls to reach a multiple of 4.
	cursor.offset += align4(end - cursor.offset + 1);
	return value;
}

function need(buffer: Buffer, cursor: Cursor, bytes: number): void {
	if (cursor.offset + bytes > buffer.length) {
		throw new OscError(`Packet ended early: needed ${bytes} more bytes.`);
	}
}

function readArg(buffer: Buffer, cursor: Cursor, tag: OscTypeTag): DecodedArg {
	switch (tag) {
		case "T":
			return { tag, value: true };
		case "F":
			return { tag, value: false };
		case "N":
			return { tag, value: null };
		case "I":
			return { tag, value: undefined };
		case "[":
		case "]":
			return { tag, value: undefined };

		case "i": {
			need(buffer, cursor, 4);
			const value = buffer.readInt32BE(cursor.offset);
			cursor.offset += 4;
			return { tag, value };
		}

		case "f": {
			need(buffer, cursor, 4);
			const value = buffer.readFloatBE(cursor.offset);
			cursor.offset += 4;
			return { tag, value };
		}

		case "d": {
			need(buffer, cursor, 8);
			const value = buffer.readDoubleBE(cursor.offset);
			cursor.offset += 8;
			return { tag, value };
		}

		case "h": {
			need(buffer, cursor, 8);
			const value = buffer.readBigInt64BE(cursor.offset);
			cursor.offset += 8;
			return { tag, value };
		}

		case "t": {
			need(buffer, cursor, 8);
			const value = buffer.readBigUInt64BE(cursor.offset);
			cursor.offset += 8;
			return { tag, value };
		}

		case "c": {
			need(buffer, cursor, 4);
			const code = buffer.readUInt32BE(cursor.offset);
			cursor.offset += 4;
			return { tag, value: String.fromCharCode(code) };
		}

		case "r": {
			need(buffer, cursor, 4);
			const value = buffer.readUInt32BE(cursor.offset);
			cursor.offset += 4;
			return { tag, value };
		}

		case "m": {
			need(buffer, cursor, 4);
			const value = Uint8Array.prototype.slice.call(buffer, cursor.offset, cursor.offset + 4);
			cursor.offset += 4;
			return { tag, value };
		}

		case "s":
		case "S":
			return { tag, value: readString(buffer, cursor) };

		case "b": {
			need(buffer, cursor, 4);
			const size = buffer.readInt32BE(cursor.offset);
			cursor.offset += 4;
			if (size < 0) {
				throw new OscError("Blob declares a negative size.");
			}
			need(buffer, cursor, size);
			const value = Uint8Array.prototype.slice.call(buffer, cursor.offset, cursor.offset + size);
			// A blob has no terminator, so only the data itself is padded.
			cursor.offset += align4(size);
			return { tag, value };
		}
	}
}

/** Decodes one OSC Message. */
export function decodeMessage(buffer: Buffer, cursor: Cursor = { offset: 0 }): DecodedMessage {
	const address = readString(buffer, cursor);

	if (!address.startsWith("/")) {
		throw new OscError(`Address “${address}” does not begin with '/'.`);
	}

	// The spec notes that some older implementations omit the type tag string
	// entirely. Nothing can be inferred about the arguments in that case, so the
	// message is reported with none rather than being rejected outright.
	if (cursor.offset >= buffer.length) {
		return { address, args: [] };
	}

	const tags = readString(buffer, cursor);
	if (!tags.startsWith(",")) {
		return { address, args: [] };
	}

	const args: DecodedArg[] = [];
	for (const tag of tags.substring(1)) {
		if (!isOscTypeTag(tag)) {
			// "an OSC application should discard any message whose OSC Type Tag
			// String contains any unrecognized OSC Type Tags"
			throw new OscError(`Unrecognised OSC type tag “${tag}”.`);
		}
		args.push(carriesData(tag) ? readArg(buffer, cursor, tag) : { tag, value: readArg(buffer, cursor, tag).value });
	}

	return { address, args };
}

/**
 * Decodes a packet, flattening any bundle into the messages it contains.
 *
 * Time tags are read but not honoured: scheduling a key update for later would
 * mean holding state the plugin has no way to reconcile if the bundle never
 * arrives. Messages are surfaced immediately, in bundle order.
 */
export function decodePacket(buffer: Buffer, depth = 0): DecodedMessage[] {
	// Bundles may contain bundles. A crafted packet could nest them thousands
	// deep and exhaust the call stack, which would throw a RangeError rather
	// than an OscError and so escape the caller's error handling entirely.
	// Real bundles nest once or twice.
	if (depth > MAX_BUNDLE_DEPTH) {
		throw new OscError(`Bundle nested more than ${MAX_BUNDLE_DEPTH} deep.`);
	}

	if (buffer.length === 0) {
		return [];
	}

	if (buffer.length % 4 !== 0) {
		throw new OscError(`Packet length ${buffer.length} is not a multiple of 4.`);
	}

	// The first byte distinguishes a bundle from a message.
	if (buffer[0] === 0x23) {
		return decodeBundle(buffer, { offset: 0 }, depth);
	}

	return [decodeMessage(buffer)];
}

function decodeBundle(buffer: Buffer, cursor: Cursor, depth: number): DecodedMessage[] {
	const marker = readString(buffer, cursor);
	if (marker !== "#bundle") {
		throw new OscError(`Expected “#bundle”, found “${marker}”.`);
	}

	need(buffer, cursor, 8);
	cursor.offset += 8; // time tag, read past

	const messages: DecodedMessage[] = [];

	while (cursor.offset < buffer.length) {
		need(buffer, cursor, 4);
		const size = buffer.readInt32BE(cursor.offset);
		cursor.offset += 4;

		if (size < 0 || cursor.offset + size > buffer.length) {
			throw new OscError("Bundle element declares a size beyond the end of the packet.");
		}

		const element = buffer.subarray(cursor.offset, cursor.offset + size);
		messages.push(...decodePacket(element, depth + 1));
		cursor.offset += size;
	}

	return messages;
}

/** Reduces a decoded argument to a number, for display on a key or dial. */
export function toNumber(arg: DecodedArg | undefined): number | null {
	if (arg === undefined) {
		return null;
	}

	switch (typeof arg.value) {
		case "number":
			return arg.value;
		case "bigint":
			return Number(arg.value);
		case "boolean":
			return arg.value ? 1 : 0;
		case "string": {
			const parsed = Number(arg.value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		default:
			return null;
	}
}

/** Renders a decoded argument as short display text. */
export function toText(arg: DecodedArg | undefined, decimals = 2): string {
	if (arg === undefined) {
		return "";
	}

	switch (arg.tag) {
		case "T":
			return "on";
		case "F":
			return "off";
		case "N":
			return "nil";
		case "I":
			return "∞";
		case "f":
		case "d":
			return typeof arg.value === "number" ? arg.value.toFixed(decimals) : "";
		case "b":
		case "m":
			return arg.value instanceof Uint8Array ? `${arg.value.length} bytes` : "";
		default:
			return String(arg.value ?? "");
	}
}
