import dgram from "node:dgram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OscReceiver } from "./net/receiver.js";
import { decodePacket } from "./osc/decode.js";
import { encodeMessage } from "./osc/encode.js";
import { matchesAddress } from "./osc/match.js";
import { OscError } from "./osc/types.js";
import { clampDial, dialPercent, resolveDial, resolveWatch, type OscSettings } from "./settings.js";

describe("address pattern matching", () => {
	it("matches literal addresses exactly", () => {
		expect(matchesAddress("/ch/1/mute", "/ch/1/mute")).toBe(true);
		expect(matchesAddress("/ch/1/mute", "/ch/2/mute")).toBe(false);
	});

	it("requires the same number of parts", () => {
		expect(matchesAddress("/a/*", "/a/b/c")).toBe(false);
		expect(matchesAddress("/a/*", "/a/b")).toBe(true);
	});

	it("never lets a wildcard cross a slash", () => {
		expect(matchesAddress("/a/*", "/a/b/c")).toBe(false);
	});

	it("applies ? to exactly one character", () => {
		expect(matchesAddress("/ch/?", "/ch/4")).toBe(true);
		expect(matchesAddress("/ch/?", "/ch/12")).toBe(false);
	});

	it("applies * to zero or more characters", () => {
		expect(matchesAddress("/vol*", "/vol")).toBe(true);
		expect(matchesAddress("/vol*", "/volume")).toBe(true);
		expect(matchesAddress("/*/mute", "/ch/mute")).toBe(true);
	});

	it("handles bracket lists, ranges and negation", () => {
		expect(matchesAddress("/ch/[123]", "/ch/2")).toBe(true);
		expect(matchesAddress("/ch/[123]", "/ch/4")).toBe(false);
		expect(matchesAddress("/ch/[1-8]", "/ch/5")).toBe(true);
		expect(matchesAddress("/ch/[!1-8]", "/ch/9")).toBe(true);
		expect(matchesAddress("/ch/[!1-8]", "/ch/5")).toBe(false);
	});

	it("handles brace alternatives", () => {
		expect(matchesAddress("/{mute,solo}", "/solo")).toBe(true);
		expect(matchesAddress("/{mute,solo}", "/fader")).toBe(false);
		expect(matchesAddress("/ch/{1,2}/level", "/ch/2/level")).toBe(true);
	});

	it("works whichever side carries the wildcard", () => {
		// The spec puts the pattern on the incoming message, but a button
		// watching a range of addresses is a reasonable thing to want.
		expect(matchesAddress("/ch/*/level", "/ch/7/level")).toBe(true);
		expect(matchesAddress("/ch/7/level", "/ch/*/level")).toBe(true);
	});

	it("resists a pattern crafted to take exponential time", () => {
		// Addresses arrive from the network. Without memoisation this pattern
		// takes minutes, during which the plugin would be unresponsive.
		const hostile = `/${"*a".repeat(20)}b`;
		const target = `/${"a".repeat(60)}`;

		const started = Date.now();
		expect(matchesAddress(hostile, target)).toBe(false);
		expect(Date.now() - started).toBeLessThan(500);
	});

	it("refuses absurdly long addresses outright", () => {
		expect(matchesAddress(`/${"a".repeat(2000)}`, `/${"a".repeat(2000)}`)).toBe(false);
	});
});

describe("decoder hardening", () => {
	it("rejects a packet whose length is not a multiple of 4", () => {
		expect(() => decodePacket(Buffer.from([0x2f, 0x61, 0x00]))).toThrow(OscError);
	});

	it("rejects a blob claiming more bytes than the packet holds", () => {
		const packet = Buffer.concat([
			Buffer.from("/a\0\0"),
			Buffer.from(",b\0\0"),
			Buffer.from([0x7f, 0xff, 0xff, 0xff]),
		]);
		expect(() => decodePacket(packet)).toThrow(OscError);
	});

	it("caps bundle nesting rather than exhausting the stack", () => {
		// Unbounded recursion would throw RangeError, which is not an OscError
		// and would therefore slip past the caller's error handling.
		let packet = encodeMessage("/x", []);
		for (let i = 0; i < 200; i++) {
			const size = Buffer.alloc(4);
			size.writeInt32BE(packet.length);
			packet = Buffer.concat([Buffer.from("#bundle\0"), Buffer.alloc(8), size, packet]);
		}

		expect(() => decodePacket(packet)).toThrow(OscError);
	});

	it("survives arbitrary rubbish without throwing anything but OscError", () => {
		for (let i = 0; i < 3000; i++) {
			const length = [0, 4, 8, 12, 16, 32, 64][i % 7]!;
			const bytes = Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
			try {
				decodePacket(bytes);
			} catch (error) {
				expect(error).toBeInstanceOf(OscError);
			}
		}
	});
});

describe("dial", () => {
	const base: OscSettings = { Args: [{ type: "f", value: "0" }], DialArgIndex: 0 };

	it("defaults to the 0–1 range an OSC fader usually wants", () => {
		const range = resolveDial(base);
		expect(range.min).toBe(0);
		expect(range.max).toBe(1);
	});

	it("falls back to the first numeric argument, so an encoder works unconfigured", () => {
		expect(resolveDial({ Args: [{ type: "f", value: "0" }] }).argIndex).toBe(0);
	});

	it("never falls back onto a string argument", () => {
		// Replacing a string's contents with a number would change what the
		// message means, not merely its value.
		const range = resolveDial({ Args: [{ type: "s", value: "hi" }, { type: "f", value: "0" }] });
		expect(range.argIndex).toBe(1);
	});

	it("is disabled when nothing numeric is present at all", () => {
		expect(resolveDial({ Args: [{ type: "s", value: "hi" }] }).argIndex).toBe(-1);
	});

	it("clamps to the configured range", () => {
		const range = resolveDial({ ...base, DialMin: 0, DialMax: 1, DialStep: 0.1 });
		expect(clampDial(1.5, range)).toBe(1);
		expect(clampDial(-0.5, range)).toBe(0);
	});

	it("snaps to the step so floating point drift cannot accumulate", () => {
		const range = resolveDial({ ...base, DialMin: 0, DialMax: 1, DialStep: 0.1 });
		// Ten ticks of 0.1 in naive floating point gives 0.9999999999999999.
		let value = 0;
		for (let i = 0; i < 10; i++) {
			value = clampDial(value + range.step, range);
		}
		expect(value).toBe(1);
	});

	it("reports position as a percentage for the touchscreen bar", () => {
		const range = resolveDial({ ...base, DialMin: 0, DialMax: 10 });
		expect(dialPercent(0, range)).toBe(0);
		expect(dialPercent(5, range)).toBe(50);
		expect(dialPercent(10, range)).toBe(100);
	});

	it("copes with an inverted or zero-width range without dividing by zero", () => {
		const range = resolveDial({ ...base, DialMin: 5, DialMax: 5 });
		expect(Number.isFinite(dialPercent(5, range))).toBe(true);
	});
});

describe("watch configuration", () => {
	it("is off unless explicitly enabled", () => {
		expect(resolveWatch({ WatchPort: 9001 })).toBeNull();
	});

	it("falls back to the address the button sends to", () => {
		// Watching the same address you control is the common case, so it should
		// not need typing twice.
		const watch = resolveWatch({ WatchEnabled: true, WatchPort: 9001, Name: "/fader/1" });
		expect(watch?.address).toBe("/fader/1");
	});

	it("accepts a port stored as a string", () => {
		expect(resolveWatch({ WatchEnabled: true, WatchPort: "9001", Name: "/x" })?.port).toBe(9001);
	});
});

describe("receiving", () => {
	const receiver = new OscReceiver(() => {});
	let sender: dgram.Socket;
	let port = 0;

	/** Asks the OS for a free port by binding one and immediately letting it go. */
	async function freePort(): Promise<number> {
		const probe = dgram.createSocket("udp4");
		await new Promise<void>((resolve) => probe.bind(0, "127.0.0.1", resolve));
		const { port: found } = probe.address();
		await new Promise<void>((resolve) => probe.close(resolve));
		return found;
	}

	/** Gives the receiver time to bind and the datagram time to arrive. */
	function settle(): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, 200));
	}

	beforeAll(async () => {
		sender = dgram.createSocket("udp4");
		await new Promise<void>((resolve) => sender.bind(0, "127.0.0.1", resolve));
	});

	afterAll(async () => {
		await receiver.close();
		await new Promise<void>((resolve) => sender.close(resolve));
	});

	function transmit(packet: Buffer): Promise<void> {
		return new Promise((resolve, reject) =>
			sender.send(packet, port, "127.0.0.1", (error) => (error ? reject(error) : resolve())),
		);
	}

	it("delivers a matching message to a subscriber", async () => {
		const received: string[] = [];
		port = await freePort();

		const subscription = receiver.subscribe(port, "/fader/1", (message) => {
			received.push(`${message.address}=${String(message.args[0]?.value)}`);
		});
		await settle();

		await transmit(encodeMessage("/fader/1", [{ tag: "f", value: 0.5 }]));
		await settle();

		expect(received).toEqual(["/fader/1=0.5"]);
		subscription.dispose();
	});

	it("shares one bound port between several subscribers", async () => {
		// Two buttons watching the same port must not fight over the socket.
		const a: string[] = [];
		const b: string[] = [];
		port = await freePort();

		const first = receiver.subscribe(port, "/a", (m) => a.push(m.address));
		const second = receiver.subscribe(port, "/b", (m) => b.push(m.address));
		await settle();

		await transmit(encodeMessage("/a", []));
		await transmit(encodeMessage("/b", []));
		await settle();

		expect(a).toEqual(["/a"]);
		expect(b).toEqual(["/b"]);

		first.dispose();
		second.dispose();
	});

	it("ignores a malformed packet instead of tearing down the listener", async () => {
		const received: string[] = [];
		port = await freePort();

		const subscription = receiver.subscribe(port, "/ok", (m) => received.push(m.address));
		await settle();

		await transmit(Buffer.from([0x01, 0x02, 0x03]));
		await transmit(Buffer.from("not an osc packet at all"));
		await transmit(encodeMessage("/ok", []));
		await settle();

		expect(received).toEqual(["/ok"]);
		subscription.dispose();
	});

	it("delivers every message inside a bundle", async () => {
		const received: string[] = [];
		port = await freePort();

		const subscription = receiver.subscribe(port, "/ch/*/level", (m) => received.push(m.address));
		await settle();

		const inner = [encodeMessage("/ch/1/level", []), encodeMessage("/ch/2/level", [])];
		const parts: Buffer[] = [Buffer.from("#bundle\0"), Buffer.alloc(8)];
		for (const element of inner) {
			const size = Buffer.alloc(4);
			size.writeInt32BE(element.length);
			parts.push(size, element);
		}

		await transmit(Buffer.concat(parts));
		await settle();

		expect(received).toEqual(["/ch/1/level", "/ch/2/level"]);
		subscription.dispose();
	});
});
