import { describe, expect, it } from "vitest";

import { normaliseAddress } from "./address.js";
import { encodeBlob, encodeBundle, encodeMessage, encodeString } from "./encode.js";
import { OscError, parseArg, type OscArg } from "./types.js";

/** Turns "2f 6f 73 63" into a Buffer, so fixtures can be pasted from the spec. */
function hex(text: string): Buffer {
	return Buffer.from(text.replace(/\s+/g, ""), "hex");
}

describe("OSC-string encoding", () => {
	// "Examples Supporting the OpenSoundControl 1.0 Spec", OSC-string examples.
	it('encodes "OSC" as four bytes', () => {
		expect(encodeString("OSC")).toEqual(hex("4f 53 43 00"));
	});

	it('encodes "data" as eight bytes, not four', () => {
		// The critical rule: a string whose length is already a multiple of 4
		// still needs a null terminator, and therefore a whole extra word.
		expect(encodeString("data")).toEqual(hex("64 61 74 61 00 00 00 00"));
	});

	it("encodes the empty string as four null bytes", () => {
		expect(encodeString("")).toEqual(hex("00 00 00 00"));
	});

	it.each([
		["a", 4],
		["ab", 4],
		["abc", 4],
		["abcd", 8],
		["abcde", 8],
		["abcdef", 8],
		["abcdefg", 8],
		["abcdefgh", 12],
	])("pads %j to %i bytes", (value, expected) => {
		expect(encodeString(value)).toHaveLength(expected);
	});

	it("rejects embedded nulls", () => {
		expect(() => encodeString("a\0b")).toThrow(OscError);
	});
});

describe("OSC-blob encoding", () => {
	it("writes the size then the data", () => {
		expect(encodeBlob(new Uint8Array([0xde, 0xad]))).toEqual(hex("00 00 00 02 de ad 00 00"));
	});

	it("adds no padding when the length is already a multiple of 4", () => {
		// Unlike a string, a blob has no terminator.
		expect(encodeBlob(new Uint8Array([1, 2, 3, 4]))).toEqual(hex("00 00 00 04 01 02 03 04"));
	});

	it("encodes an empty blob as just the size", () => {
		expect(encodeBlob(new Uint8Array(0))).toEqual(hex("00 00 00 00"));
	});
});

describe("spec message fixtures", () => {
	// Both fixtures are reproduced byte for byte from "OSC Message Examples" in
	// the 1.0 examples document.

	it("matches the /oscillator/4/frequency example", () => {
		const message = encodeMessage("/oscillator/4/frequency", [{ tag: "f", value: 440.0 }]);

		expect(message).toEqual(
			hex(`2f 6f 73 63
			     69 6c 6c 61
			     74 6f 72 2f
			     34 2f 66 72
			     65 71 75 65
			     6e 63 79 00
			     2c 66 00 00
			     43 dc 00 00`),
		);
		expect(message).toHaveLength(32);
	});

	it("matches the /foo example with five arguments", () => {
		const args: OscArg[] = [
			{ tag: "i", value: 1000 },
			{ tag: "i", value: -1 },
			{ tag: "s", value: "hello" },
			{ tag: "f", value: 1.234 },
			{ tag: "f", value: 5.678 },
		];

		const message = encodeMessage("/foo", args);

		expect(message).toEqual(
			hex(`2f 66 6f 6f
			     00 00 00 00
			     2c 69 69 73
			     66 66 00 00
			     00 00 03 e8
			     ff ff ff ff
			     68 65 6c 6c
			     6f 00 00 00
			     3f 9d f3 b6
			     40 b5 b2 2d`),
		);
		expect(message).toHaveLength(40);
	});
});

describe("type tag string", () => {
	// "Example OSC Type Tag Strings" from the same document.
	function tagsOf(args: OscArg[]): string {
		const message = encodeMessage("/x", args);
		// "/x" occupies 4 bytes, so the tag string starts at offset 4.
		const end = message.indexOf(0, 4);
		return message.subarray(4, end).toString("ascii");
	}

	it("is a lone comma when there are no arguments", () => {
		expect(tagsOf([])).toBe(",");
		expect(encodeMessage("/x", [])).toEqual(hex("2f 78 00 00 2c 00 00 00"));
	});

	it("is ,f for one float", () => {
		expect(tagsOf([{ tag: "f", value: 1 }])).toBe(",f");
	});

	it("is ,iisfff for two ints, a string and three floats", () => {
		expect(
			tagsOf([
				{ tag: "i", value: 1 },
				{ tag: "i", value: 2 },
				{ tag: "s", value: "x" },
				{ tag: "f", value: 1 },
				{ tag: "f", value: 2 },
				{ tag: "f", value: 3 },
			]),
		).toBe(",iisfff");
	});

	it("is ,ibb for an int and two blobs", () => {
		expect(
			tagsOf([
				{ tag: "i", value: 1 },
				{ tag: "b", value: new Uint8Array(1) },
				{ tag: "b", value: new Uint8Array(1) },
			]),
		).toBe(",ibb");
	});
});

describe("packet alignment", () => {
	it("always produces a length that is a multiple of 4", () => {
		const addresses = ["/a", "/ab", "/abc", "/abcd", "/abcde", "/a/very/much/longer/address"];
		const values = ["", "x", "xy", "xyz", "wxyz", "vwxyz"];

		for (const address of addresses) {
			for (const value of values) {
				const message = encodeMessage(address, [
					{ tag: "s", value },
					{ tag: "i", value: 1 },
					{ tag: "b", value: new Uint8Array(Buffer.from(value)) },
				]);
				expect(message.length % 4).toBe(0);
			}
		}
	});
});

describe("no-data types", () => {
	it("allocates no argument bytes for T, F, N and I", () => {
		const message = encodeMessage("/x", [{ tag: "T" }, { tag: "F" }, { tag: "N" }, { tag: "I" }]);

		// "/x" -> 4 bytes, ",TFNI" -> 8 bytes, and nothing else.
		expect(message).toEqual(hex("2f 78 00 00 2c 54 46 4e 49 00 00 00"));
		expect(message).toHaveLength(12);
	});

	it("carries a true/false flag with no payload alongside real arguments", () => {
		const message = encodeMessage("/mute", [{ tag: "T" }]);
		expect(message).toEqual(hex("2f 6d 75 74 65 00 00 00 2c 54 00 00"));
	});

	it("encodes arrays as bracket tags only", () => {
		const message = encodeMessage("/x", [
			{ tag: "[" },
			{ tag: "i", value: 1 },
			{ tag: "i", value: 2 },
			{ tag: "]" },
		]);
		expect(message).toEqual(hex("2f 78 00 00 2c 5b 69 69 5d 00 00 00 00 00 00 01 00 00 00 02"));
	});

	it("rejects unbalanced array tags", () => {
		expect(() => encodeMessage("/x", [{ tag: "[" }])).toThrow(OscError);
		expect(() => encodeMessage("/x", [{ tag: "]" }])).toThrow(OscError);
	});
});

describe("numeric types", () => {
	it("encodes int32 boundaries", () => {
		expect(encodeMessage("/x", [{ tag: "i", value: 2147483647 }]).subarray(8)).toEqual(hex("7f ff ff ff"));
		expect(encodeMessage("/x", [{ tag: "i", value: -2147483648 }]).subarray(8)).toEqual(hex("80 00 00 00"));
	});

	it("encodes int64 beyond the safe integer range", () => {
		const value = 9223372036854775807n;
		expect(encodeMessage("/x", [{ tag: "h", value }]).subarray(8)).toEqual(hex("7f ff ff ff ff ff ff ff"));
	});

	it("encodes float64 with full precision", () => {
		expect(encodeMessage("/x", [{ tag: "d", value: 0.1 }]).subarray(8)).toEqual(hex("3f b9 99 99 99 99 99 9a"));
	});

	it("encodes zero as a float, which is a value the v2 property inspector rejected", () => {
		expect(encodeMessage("/x", [{ tag: "f", value: 0 }]).subarray(8)).toEqual(hex("00 00 00 00"));
	});

	it("encodes RGBA with red in the most significant byte", () => {
		const arg = parseArg({ type: "r", value: "#FF8800FF" }, 0);
		expect(encodeMessage("/x", [arg]).subarray(8)).toEqual(hex("ff 88 00 ff"));
	});

	it("encodes a char as 32 bits", () => {
		const arg = parseArg({ type: "c", value: "A" }, 0);
		expect(encodeMessage("/x", [arg]).subarray(8)).toEqual(hex("00 00 00 41"));
	});

	it("encodes a MIDI message as four raw bytes", () => {
		const arg = parseArg({ type: "m", value: "00 90 40 7f" }, 0);
		expect(encodeMessage("/x", [arg]).subarray(8)).toEqual(hex("00 90 40 7f"));
	});

	it("uses 1 as the immediate timetag", () => {
		const arg = parseArg({ type: "t", value: "now" }, 0);
		expect(encodeMessage("/x", [arg]).subarray(8)).toEqual(hex("00 00 00 00 00 00 00 01"));
	});
});

describe("argument parsing", () => {
	it("accepts zero for every numeric type", () => {
		expect(parseArg({ type: "i", value: "0" }, 0)).toEqual({ tag: "i", value: 0 });
		expect(parseArg({ type: "f", value: "0" }, 0)).toEqual({ tag: "f", value: 0 });
		expect(parseArg({ type: "f", value: "0.0" }, 0)).toEqual({ tag: "f", value: 0 });
		expect(parseArg({ type: "d", value: "0" }, 0)).toEqual({ tag: "d", value: 0 });
		expect(parseArg({ type: "h", value: "0" }, 0)).toEqual({ tag: "h", value: 0n });
	});

	it("accepts negative values", () => {
		expect(parseArg({ type: "i", value: "-42" }, 0)).toEqual({ tag: "i", value: -42 });
		expect(parseArg({ type: "f", value: "-0.5" }, 0)).toEqual({ tag: "f", value: -0.5 });
	});

	it("rejects an int32 that does not fit", () => {
		expect(() => parseArg({ type: "i", value: "2147483648" }, 0)).toThrow(/outside/);
	});

	it("rejects a decimal where a whole number is required", () => {
		expect(() => parseArg({ type: "i", value: "1.5" }, 0)).toThrow(/whole number/);
	});

	it("rejects non-numeric text rather than silently sending nothing", () => {
		expect(() => parseArg({ type: "f", value: "abc" }, 0)).toThrow(OscError);
		expect(() => parseArg({ type: "i", value: "" }, 0)).toThrow(OscError);
	});

	it("rejects NaN and Infinity", () => {
		expect(() => parseArg({ type: "f", value: "NaN" }, 0)).toThrow(/finite/);
		expect(() => parseArg({ type: "f", value: "Infinity" }, 0)).toThrow(/finite/);
	});

	it("accepts an empty string argument", () => {
		expect(parseArg({ type: "s", value: "" }, 0)).toEqual({ tag: "s", value: "" });
	});

	it("tolerates separators in hex input", () => {
		expect(parseArg({ type: "b", value: "de:ad be-ef" }, 0)).toEqual({ tag: "b", value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
	});

	it("rejects odd-length hex", () => {
		expect(() => parseArg({ type: "b", value: "abc" }, 0)).toThrow(/hexadecimal/);
	});

	it("requires MIDI messages to be exactly four bytes", () => {
		expect(() => parseArg({ type: "m", value: "90 40" }, 0)).toThrow(/4 bytes/);
	});

	it("reports the argument position in the error", () => {
		expect(() => parseArg({ type: "i", value: "x" }, 2)).toThrow(/Argument 3/);
	});
});

describe("address normalisation", () => {
	it("passes a well-formed address through unchanged", () => {
		expect(normaliseAddress("/volume/1")).toEqual({ address: "/volume/1" });
	});

	it("trims surrounding whitespace", () => {
		expect(normaliseAddress("  /volume  ")).toEqual({ address: "/volume" });
	});

	it("adds a missing leading slash and reports it", () => {
		const result = normaliseAddress("test");
		expect(result.address).toBe("/test");
		expect(result.warning).toMatch(/does not start with/);
	});

	it("allows pattern wildcards", () => {
		for (const address of ["/a/*", "/a/?", "/a/[1-4]", "/a/{x,y}/b".replace(",", "")]) {
			expect(() => normaliseAddress(address)).not.toThrow();
		}
	});

	it("rejects spaces, hashes and commas", () => {
		expect(() => normaliseAddress("/a b")).toThrow(/space/);
		expect(() => normaliseAddress("/a#b")).toThrow(/'#'/);
		expect(() => normaliseAddress("/a,b")).toThrow(/comma/);
	});

	it("rejects an empty address", () => {
		expect(() => normaliseAddress("   ")).toThrow(/empty/);
	});

	it("rejects non-ASCII", () => {
		expect(() => normaliseAddress("/ü")).toThrow(/ASCII/);
	});
});

describe("bundles", () => {
	it("wraps elements with #bundle, a timetag and per-element sizes", () => {
		const inner = encodeMessage("/x", []);
		expect(inner).toHaveLength(8);

		const bundle = encodeBundle([inner]);

		expect(bundle.subarray(0, 8)).toEqual(hex("23 62 75 6e 64 6c 65 00")); // "#bundle"
		expect(bundle.subarray(8, 16)).toEqual(hex("00 00 00 00 00 00 00 01")); // immediate
		expect(bundle.subarray(16, 20)).toEqual(hex("00 00 00 08")); // size of first element
		expect(bundle.subarray(20)).toEqual(inner);
		expect(bundle.length % 4).toBe(0);
	});
});
