/**
 * OSC type tags and their metadata.
 *
 * Kept free of any Node-only API so the property inspector, which runs in a
 * browser context, can share this module and the validator built on it rather
 * than carrying a second, subtly different copy of the rules.
 *
 * Reference: OpenSoundControl Specification 1.0, "OSC Type Tag String".
 */

/** The four types every conforming OSC 1.0 receiver must accept. */
export const REQUIRED_TAGS = ["i", "f", "s", "b"] as const;

/**
 * The remaining tags. The spec calls these "nonstandard argument types" and
 * explicitly permits a receiver to discard any message containing them, so a
 * device that ignores a message may simply not implement the type used.
 */
export const OPTIONAL_TAGS = ["h", "t", "d", "S", "c", "r", "m", "T", "F", "N", "I", "[", "]"] as const;

export type RequiredTag = (typeof REQUIRED_TAGS)[number];
export type OptionalTag = (typeof OPTIONAL_TAGS)[number];
export type OscTypeTag = RequiredTag | OptionalTag;

const ALL_TAGS: readonly string[] = [...REQUIRED_TAGS, ...OPTIONAL_TAGS];

/** Tags that occupy a position in the type tag string but contribute no data bytes. */
export const NO_DATA_TAGS: readonly OscTypeTag[] = ["T", "F", "N", "I", "[", "]"];

export function isOscTypeTag(value: string): value is OscTypeTag {
	return ALL_TAGS.includes(value);
}

export function carriesData(tag: OscTypeTag): boolean {
	return !NO_DATA_TAGS.includes(tag);
}

/** Labels and input hints, shown in the property inspector. */
export const TAG_INFO: Record<OscTypeTag, { label: string; hint?: string }> = {
	i: { label: "Integer (int32)", hint: "-2147483648 to 2147483647" },
	f: { label: "Float (float32)", hint: "e.g. 0.5" },
	s: { label: "String", hint: "Text" },
	b: { label: "Blob", hint: "Hex bytes, e.g. de ad be ef" },
	h: { label: "Integer (int64)", hint: "Whole number" },
	t: { label: "Time tag", hint: "“now”, or a 64-bit NTP value" },
	d: { label: "Float (float64)", hint: "e.g. 0.5" },
	S: { label: "Symbol", hint: "Text" },
	c: { label: "Character", hint: "One ASCII character" },
	r: { label: "Colour (RGBA)", hint: "#RRGGBBAA" },
	m: { label: "MIDI message", hint: "4 hex bytes: port status data1 data2" },
	T: { label: "True" },
	F: { label: "False" },
	N: { label: "Nil" },
	I: { label: "Infinitum" },
	"[": { label: "Array start" },
	"]": { label: "Array end" },
};

/** Parses hex text into bytes, tolerating spaces, colons, commas and dashes. */
export function parseHex(raw: string): Uint8Array | null {
	const text = raw.replace(/[\s:,-]/g, "");
	if (text === "") {
		return new Uint8Array(0);
	}
	if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
		return null;
	}

	const bytes = new Uint8Array(text.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(text.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}
