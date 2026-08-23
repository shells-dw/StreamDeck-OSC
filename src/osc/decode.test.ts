import { describe, expect, it } from "vitest";

import { decodeMessage, decodePacket, toNumber, toText } from "./decode.js";
import { encodeBundle, encodeMessage } from "./encode.js";
import { matchesAddress } from "./match.js";
import { OscError, parseArg, type OscArg } from "./types.js";

function hex(text: string): Buffer {
	return Buffer.from(text.replace(/\s+/g, ""), "hex");
}

describe("decoding the spec fixtures", () => {
	it("reads the /oscillator/4/frequency example", () => {
		const packet = hex(`2f 6f 73 63 69 6c 6c 61 74 6f 72 2f 34 2f 66 72
		                    65 71 75 65 6e 63 79 00 2c 66 00 00 43 dc 00 00`);

		expect(decodeMessage(packet)).toEqual({
			address: "/oscillator/4/frequency",
			args: [{ tag: "f", value: 440 }],
		});
	});

	it("reads the /foo example with five arguments", () => {
		const packet = hex(`2f 66 6f 6f 00 00 00 00 2c 69 69 73 66 66 00 00
		                    00 00 03 e8 ff ff ff ff 68 65 6c 6c 6f 00 00 00
		                    3f 9d f3 b6 40 b5 b2 2d`);

		const message = decodeMessage(packet);

		expect(message.address).toBe("/foo");
		expect(message.args.map((a) => a.tag)).toEqual(["i", "i", "s", "f", "f"]);
		expect(message.args[0]!.value).toBe(1000);
		expect(message.args[1]!.value).toBe(-1);
		expect(message.args[2]!.value).toBe("hello");
		expect(message.args[3]!.value).toBeCloseTo(1.234, 6);
		expect(message.args[4]!.value).toBeCloseTo(5.678, 6);
	});
});

describe("round trips", () => {
	it("survives every supported type", () => {
		const args: OscArg[] = [
			{ tag: "i", value: -42 },
			{ tag: "f", value: 0 },
			{ tag: "s", value: "hello world" },
			{ tag: "s", value: "" },
			{ tag: "b", value: new Uint8Array([1, 2, 3]) },
			{ tag: "h", value: -9007199254740993n },
			{ tag: "d", value: 0.1 },
			{ tag: "S", value: "sym" },
			{ tag: "T" },
			{ tag: "F" },
			{ tag: "N" },
			{ tag: "I" },
			parseArg({ type: "c", value: "Z" }, 0),
			parseArg({ type: "r", value: "#10203040" }, 0),
			parseArg({ type: "m", value: "00 90 40 7f" }, 0),
			parseArg({ type: "t", value: "now" }, 0),
		];

		const decoded = decodeMessage(encodeMessage("/every/type", args));

		expect(decoded.address).toBe("/every/type");
		expect(decoded.args.map((a) => a.tag)).toEqual(args.map((a) => a.tag));
		expect(decoded.args[0]!.value).toBe(-42);
		expect(decoded.args[1]!.value).toBe(0);
		expect(decoded.args[2]!.value).toBe("hello world");
		expect(decoded.args[3]!.value).toBe("");
		expect(decoded.args[5]!.value).toBe(-9007199254740993n);
		expect(decoded.args[6]!.value).toBe(0.1);
		expect(decoded.args[8]!.value).toBe(true);
		expect(decoded.args[9]!.value).toBe(false);
		expect(decoded.args[10]!.value).toBe(null);
		expect(decoded.args[12]!.value).toBe("Z");
	});

	it("survives strings at every padding boundary", () => {
		for (const value of ["", "a", "ab", "abc", "abcd", "abcde", "abcdefgh"]) {
			const decoded = decodeMessage(encodeMessage("/x", [{ tag: "s", value }]));
			expect(decoded.args[0]!.value).toBe(value);
		}
	});

	it("survives an address-only message", () => {
		expect(decodeMessage(encodeMessage("/ping", []))).toEqual({ address: "/ping", args: [] });
	});
});

describe("bundles", () => {
	it("flattens a bundle into its messages, in order", () => {
		const bundle = encodeBundle([
			encodeMessage("/first", [{ tag: "i", value: 1 }]),
			encodeMessage("/second", [{ tag: "i", value: 2 }]),
		]);

		expect(decodePacket(bundle).map((m) => m.address)).toEqual(["/first", "/second"]);
	});

	it("flattens nested bundles", () => {
		const inner = encodeBundle([encodeMessage("/deep", [])]);
		const outer = encodeBundle([encodeMessage("/shallow", []), inner]);

		expect(decodePacket(outer).map((m) => m.address)).toEqual(["/shallow", "/deep"]);
	});
});

describe("malformed input is rejected, not guessed at", () => {
	it("rejects a length that is not a multiple of 4", () => {
		expect(() => decodePacket(Buffer.from([0x2f, 0x78, 0x00]))).toThrow(OscError);
	});

	it("rejects an address without a leading slash", () => {
		expect(() => decodePacket(hex("78 78 00 00 2c 00 00 00"))).toThrow(/begin with/);
	});

	it("rejects an unknown type tag", () => {
		// ",z" is not a type the spec defines.
		expect(() => decodePacket(hex("2f 78 00 00 2c 7a 00 00 00 00 00 01"))).toThrow(/Unrecognised/);
	});

	it("rejects a truncated argument", () => {
		expect(() => decodePacket(hex("2f 78 00 00 2c 69 00 00"))).toThrow(/ended early/);
	});

	it("rejects a blob claiming more bytes than exist", () => {
		expect(() => decodePacket(hex("2f 78 00 00 2c 62 00 00 7f ff ff ff"))).toThrow(OscError);
	});

	it("tolerates a message with no type tag string at all", () => {
		// The spec asks implementations to be robust about this.
		expect(decodePacket(hex("2f 78 00 00"))).toEqual([{ address: "/x", args: [] }]);
	});
});

describe("address pattern matching", () => {
	it("matches literals", () => {
		expect(matchesAddress("/a/b/c", "/a/b/c")).toBe(true);
		expect(matchesAddress("/a/b/c", "/a/b/d")).toBe(false);
	});

	it("requires the same number of parts", () => {
		expect(matchesAddress("/a/b", "/a/b/c")).toBe(false);
		expect(matchesAddress("/a/*", "/a/b/c")).toBe(false);
	});

	it("matches ? against a single character", () => {
		expect(matchesAddress("/ch/?", "/ch/1")).toBe(true);
		expect(matchesAddress("/ch/?", "/ch/12")).toBe(false);
	});

	it("matches * within a part but never across a slash", () => {
		expect(matchesAddress("/ch/*", "/ch/anything")).toBe(true);
		expect(matchesAddress("/ch/*", "/ch/")).toBe(true);
		expect(matchesAddress("/*/level", "/ch/level")).toBe(true);
		expect(matchesAddress("/ch*", "/ch/1")).toBe(false);
	});

	it("matches * in the middle and in combination", () => {
		expect(matchesAddress("/fader*level", "/faderXYZlevel")).toBe(true);
		expect(matchesAddress("/fader*level", "/faderlevel")).toBe(true);
		expect(matchesAddress("/a*b*c", "/axxbyyc")).toBe(true);
		expect(matchesAddress("/a*b*c", "/axxbyy")).toBe(false);
	});

	it("matches bracket lists and ranges", () => {
		expect(matchesAddress("/ch/[123]", "/ch/2")).toBe(true);
		expect(matchesAddress("/ch/[123]", "/ch/4")).toBe(false);
		expect(matchesAddress("/ch/[1-4]", "/ch/3")).toBe(true);
		expect(matchesAddress("/ch/[1-4]", "/ch/9")).toBe(false);
	});

	it("negates a bracket list with a leading !", () => {
		expect(matchesAddress("/ch/[!123]", "/ch/9")).toBe(true);
		expect(matchesAddress("/ch/[!123]", "/ch/2")).toBe(false);
	});

	it("matches curly brace alternatives", () => {
		expect(matchesAddress("/{mute,solo}", "/mute")).toBe(true);
		expect(matchesAddress("/{mute,solo}", "/solo")).toBe(true);
		expect(matchesAddress("/{mute,solo}", "/level")).toBe(false);
		expect(matchesAddress("/ch/{on,off}/1", "/ch/off/1")).toBe(true);
	});

	it("works when the wildcard is on the incoming side", () => {
		expect(matchesAddress("/ch/1/level", "/ch/*/level")).toBe(true);
	});
});

describe("display helpers", () => {
	it("reduces arguments to numbers where it can", () => {
		expect(toNumber({ tag: "f", value: 0.5 })).toBe(0.5);
		expect(toNumber({ tag: "i", value: 7 })).toBe(7);
		expect(toNumber({ tag: "T", value: true })).toBe(1);
		expect(toNumber({ tag: "F", value: false })).toBe(0);
		expect(toNumber({ tag: "h", value: 42n })).toBe(42);
		expect(toNumber({ tag: "s", value: "1.5" })).toBe(1.5);
		expect(toNumber({ tag: "s", value: "abc" })).toBe(null);
		expect(toNumber(undefined)).toBe(null);
	});

	it("formats arguments for display", () => {
		expect(toText({ tag: "f", value: 0.5 })).toBe("0.50");
		expect(toText({ tag: "f", value: 0.5 }, 0)).toBe("1");
		expect(toText({ tag: "i", value: 7 })).toBe("7");
		expect(toText({ tag: "T", value: true })).toBe("on");
		expect(toText({ tag: "F", value: false })).toBe("off");
		expect(toText({ tag: "s", value: "hello" })).toBe("hello");
		expect(toText(undefined)).toBe("");
	});
});
