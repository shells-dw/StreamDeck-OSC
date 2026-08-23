import { parseHex, TAG_INFO, type OscTypeTag } from "./tags.js";

export * from "./tags.js";

/**
 * An argument as persisted in Stream Deck settings.
 *
 * Every value is stored as a string, deliberately. Settings round-trip through
 * JSON, which cannot represent int64 at all and silently reformats floats;
 * keeping the user's literal text avoids both problems and means the property
 * inspector never has to guess how to render a value back into its field.
 */
export type OscArgSetting = {
	type: OscTypeTag;
	value?: string;
};

/**
 * A parsed, validated, ready-to-encode argument.
 *
 * Byte payloads are `Uint8Array` rather than `Buffer` so that this module stays
 * usable from the property inspector's browser context.
 */
export type OscArg =
	| { tag: "i" | "f" | "d" | "c" | "r"; value: number }
	| { tag: "h" | "t"; value: bigint }
	| { tag: "s" | "S"; value: string }
	| { tag: "b" | "m"; value: Uint8Array }
	| { tag: "T" | "F" | "N" | "I" | "[" | "]" };

export class OscError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "OscError";
	}
}

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

function label(tag: OscTypeTag): string {
	return TAG_INFO[tag].label;
}

function requireValue(setting: OscArgSetting, index: number): string {
	if (setting.value === undefined) {
		throw new OscError(`Argument ${index + 1} (${label(setting.type)}) has no value.`);
	}
	return setting.value;
}

function parseIntegerLiteral(raw: string, index: number, tag: OscTypeTag): bigint {
	const text = raw.trim();
	if (!/^[+-]?\d+$/.test(text)) {
		throw new OscError(`Argument ${index + 1} (${label(tag)}): “${raw}” is not a whole number.`);
	}
	return BigInt(text);
}

function parseNumberLiteral(raw: string, index: number, tag: OscTypeTag): number {
	const text = raw.trim();
	if (text === "") {
		throw new OscError(`Argument ${index + 1} (${label(tag)}) is empty.`);
	}
	const value = Number(text);
	if (!Number.isFinite(value)) {
		throw new OscError(`Argument ${index + 1} (${label(tag)}): “${raw}” is not a finite number.`);
	}
	return value;
}

function parseBytes(raw: string, index: number, tag: OscTypeTag): Uint8Array {
	const bytes = parseHex(raw);
	if (bytes === null) {
		throw new OscError(`Argument ${index + 1} (${label(tag)}): “${raw}” is not an even-length hexadecimal string.`);
	}
	return bytes;
}

/**
 * Converts a persisted argument into its validated, typed form.
 *
 * Throws {@link OscError} with a message meant to be read by the user. The
 * caller aborts the whole message rather than sending a partial one: a message
 * missing an argument is not a degraded version of the intended message, it is
 * a different message.
 */
export function parseArg(setting: OscArgSetting, index: number): OscArg {
	const tag = setting.type;

	switch (tag) {
		case "T":
		case "F":
		case "N":
		case "I":
		case "[":
		case "]":
			return { tag };

		case "i": {
			const value = parseIntegerLiteral(requireValue(setting, index), index, tag);
			if (value < BigInt(INT32_MIN) || value > BigInt(INT32_MAX)) {
				throw new OscError(`Argument ${index + 1} (int32): ${value} is outside ${INT32_MIN} to ${INT32_MAX}.`);
			}
			return { tag, value: Number(value) };
		}

		case "h": {
			const value = parseIntegerLiteral(requireValue(setting, index), index, tag);
			if (value < INT64_MIN || value > INT64_MAX) {
				throw new OscError(`Argument ${index + 1} (int64): ${value} is outside the signed 64-bit range.`);
			}
			return { tag, value };
		}

		case "t": {
			const raw = requireValue(setting, index).trim();
			// The spec reserves 63 zero bits followed by a one to mean "immediately".
			if (raw === "" || raw.toLowerCase() === "now" || raw.toLowerCase() === "immediate") {
				return { tag, value: 1n };
			}
			const value = parseIntegerLiteral(raw, index, tag);
			if (value < 0n || value > UINT64_MAX) {
				throw new OscError(`Argument ${index + 1} (time tag): ${value} is outside the unsigned 64-bit range.`);
			}
			return { tag, value };
		}

		case "f":
		case "d":
			return { tag, value: parseNumberLiteral(requireValue(setting, index), index, tag) };

		case "s":
		case "S": {
			const value = requireValue(setting, index);
			if (value.includes("\0")) {
				throw new OscError(`Argument ${index + 1} (${label(tag)}) contains a null character.`);
			}
			return { tag, value };
		}

		case "b":
			return { tag, value: parseBytes(requireValue(setting, index), index, tag) };

		case "m": {
			const bytes = parseBytes(requireValue(setting, index), index, tag);
			if (bytes.length !== 4) {
				throw new OscError(
					`Argument ${index + 1} (MIDI message) needs exactly 4 bytes — port, status, data1, data2 — but has ${bytes.length}.`,
				);
			}
			return { tag, value: bytes };
		}

		case "c": {
			const raw = requireValue(setting, index);
			if (raw.length !== 1) {
				throw new OscError(`Argument ${index + 1} (character) takes exactly one character.`);
			}
			const code = raw.charCodeAt(0);
			if (code > 0x7f) {
				throw new OscError(`Argument ${index + 1} (character): “${raw}” is not ASCII.`);
			}
			return { tag, value: code };
		}

		case "r": {
			const raw = requireValue(setting, index).trim().replace(/^#/, "");
			if (!/^[0-9a-fA-F]{8}$/.test(raw)) {
				throw new OscError(`Argument ${index + 1} (colour) takes 8 hex digits, for example #FF8800FF.`);
			}
			return { tag, value: Number.parseInt(raw, 16) };
		}
	}
}

/**
 * Validates a value for the property inspector, returning a message to show
 * beneath the field or `null` when it is fine.
 *
 * Shares {@link parseArg} so the panel cannot disagree with what actually gets
 * sent.
 */
export function checkValue(tag: OscTypeTag, value: string): string | null {
	try {
		parseArg({ type: tag, value }, 0);
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return message.replace(/^Argument \d+ \([^)]*\): ?/, "").replace(/^Argument \d+ /, "");
	}
}
