import dgram from "node:dgram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UdpSender } from "./net/udp.js";
import { normaliseAddress } from "./osc/address.js";
import { encodeMessage } from "./osc/encode.js";
import { parseArg } from "./osc/types.js";
import { isLegacy, migrate, resolveAddress, resolveArgs, resolveTarget, type OscSettings } from "./settings.js";

function hex(text: string): Buffer {
	return Buffer.from(text.replace(/\s+/g, ""), "hex");
}

/** The whole pipeline, exactly as the action performs it. */
function build(settings: OscSettings): Buffer {
	const { address } = normaliseAddress(resolveAddress(settings));
	return encodeMessage(
		address,
		resolveArgs(settings).map((arg, index) => parseArg(arg, index)),
	);
}

describe("version 2 settings", () => {
	// These objects are the shape the C# plugin persisted. The expected bytes
	// below are worked out from the spec by hand, not taken from this encoder,
	// so the assertion is about the format rather than self-consistency.

	it("reproduces a string, int and float message byte for byte", () => {
		const v2: OscSettings = {
			IP: "127.0.0.1",
			Port: 7001,
			Name: "/test",
			StringValue: "hi",
			IntValue: 1,
			FloatValue: 0.5,
			SendString: true,
			SendInt: true,
			SendFloat: true,
		};

		expect(build(v2)).toEqual(
			hex(`2f 74 65 73 74 00 00 00
			     2c 73 69 66 00 00 00 00
			     68 69 00 00
			     00 00 00 01
			     3f 00 00 00`),
		);
	});

	it("keeps the string, int, float ordering the C# version used", () => {
		// BuildOscArguments appended in this order regardless of anything else,
		// so the tag string must come out as ",sif" and never ",fis".
		const v2: OscSettings = {
			Name: "/x",
			StringValue: "a",
			IntValue: 2,
			FloatValue: 3,
			SendString: true,
			SendInt: true,
			SendFloat: true,
		};

		expect(resolveArgs(v2).map((arg) => arg.type)).toEqual(["s", "i", "f"]);
	});

	it("sends an address-only message when no boxes are ticked", () => {
		const v2: OscSettings = { Name: "/ping", SendString: false, SendInt: false, SendFloat: false };
		expect(build(v2)).toEqual(hex("2f 70 69 6e 67 00 00 00 2c 00 00 00"));
	});

	it("omits an argument whose value was never filled in", () => {
		// Version 2 boxed a null into the argument list here, which SharpOSC could
		// not serialise; the message failed entirely. Dropping the empty argument
		// at least sends something the receiver can parse.
		const v2: OscSettings = { Name: "/x", SendInt: true, IntValue: null, SendFloat: true, FloatValue: 0.25 };

		expect(resolveArgs(v2)).toEqual([{ type: "f", value: "0.25" }]);
		expect(build(v2)).toEqual(hex("2f 78 00 00 2c 66 00 00 3e 80 00 00"));
	});

	it("sends a float of zero, which version 2's property inspector refused to save", () => {
		const v2: OscSettings = { Name: "/x", SendFloat: true, FloatValue: 0 };
		expect(build(v2)).toEqual(hex("2f 78 00 00 2c 66 00 00 00 00 00 00"));
	});

	it("accepts a port stored as a string", () => {
		// The old property inspector never converted the input value, so this is
		// what is actually sitting in many profiles.
		expect(resolveTarget({ Port: "7001" })).toEqual({ host: "127.0.0.1", port: 7001 });
		expect(resolveTarget({ IP: " 10.0.0.5 ", Port: 9000 })).toEqual({ host: "10.0.0.5", port: 9000 });
	});

	it("falls back to defaults for a port that is empty, out of range or absent", () => {
		expect(resolveTarget({ Port: "" }).port).toBe(7001);
		expect(resolveTarget({ Port: 0 }).port).toBe(7001);
		expect(resolveTarget({ Port: 70000 }).port).toBe(7001);
		expect(resolveTarget({}).port).toBe(7001);
	});

	it("repairs an address saved without a leading slash", () => {
		expect(build({ Name: "test" })).toEqual(hex("2f 74 65 73 74 00 00 00 2c 00 00 00"));
	});
});

describe("migration", () => {
	const v2: OscSettings = {
		IP: "192.168.1.50",
		Port: 8000,
		Name: "/fader/1",
		StringValue: "on",
		IntValue: 5,
		FloatValue: 0.75,
		SendString: false,
		SendInt: true,
		SendFloat: true,
	};

	it("recognises legacy settings", () => {
		expect(isLegacy(v2)).toBe(true);
		expect(isLegacy({ ...v2, Args: [] })).toBe(false);
	});

	it("produces the same message before and after migrating", () => {
		expect(build(migrate(v2))).toEqual(build(v2));
	});

	it("leaves the legacy keys in place, so a downgrade still finds them", () => {
		const migrated = migrate(v2);

		expect(migrated.StringValue).toBe("on");
		expect(migrated.IntValue).toBe(5);
		expect(migrated.SendInt).toBe(true);
		expect(migrated.IP).toBe("192.168.1.50");
	});

	it("is idempotent", () => {
		expect(migrate(migrate(v2))).toEqual(migrate(v2));
	});

	it("prefers Args once present, ignoring the stale legacy fields", () => {
		const v3: OscSettings = { ...v2, Args: [{ type: "T" }] };
		expect(resolveArgs(v3)).toEqual([{ type: "T" }]);
	});

	it("discards argument entries with an unknown type rather than throwing", () => {
		const settings = { Name: "/x", Args: [{ type: "i", value: "1" }, { type: "zzz" }, null] } as unknown as OscSettings;
		expect(resolveArgs(settings)).toEqual([{ type: "i", value: "1" }]);
	});
});

describe("UDP transport", () => {
	let receiver: dgram.Socket;
	let port: number;
	const sender = new UdpSender(() => {});

	beforeAll(async () => {
		receiver = dgram.createSocket("udp4");
		await new Promise<void>((resolve) => receiver.bind(0, "127.0.0.1", resolve));
		port = receiver.address().port;
	});

	afterAll(async () => {
		await sender.close();
		await new Promise<void>((resolve) => receiver.close(resolve));
	});

	function nextPacket(): Promise<Buffer> {
		return new Promise((resolve) => receiver.once("message", resolve));
	}

	it("delivers the exact bytes a version 2 button would have produced", async () => {
		const settings: OscSettings = {
			IP: "127.0.0.1",
			Port: port,
			Name: "/test",
			StringValue: "hi",
			IntValue: 1,
			FloatValue: 0.5,
			SendString: true,
			SendInt: true,
			SendFloat: true,
		};

		const arrived = nextPacket();
		const target = resolveTarget(settings);
		await sender.send(build(settings), target.host, target.port);

		expect(await arrived).toEqual(
			hex("2f 74 65 73 74 00 00 00 2c 73 69 66 00 00 00 00 68 69 00 00 00 00 00 01 3f 00 00 00"),
		);
	});

	it("reuses one socket across many sends", async () => {
		// Version 2 opened a socket per key press and never closed it. Sending a
		// burst here would have leaked 50 handles.
		for (let i = 0; i < 50; i++) {
			const arrived = nextPacket();
			await sender.send(build({ Name: "/burst", SendInt: true, IntValue: i }), "127.0.0.1", port);
			await arrived;
		}
	});

	it("rejects an invalid port instead of crashing the process", async () => {
		await expect(sender.send(Buffer.alloc(4), "127.0.0.1", 0)).rejects.toThrow(/valid port/);
	});

	it("rejects an unresolvable host instead of crashing the process", async () => {
		// The version 2 equivalent threw outside its try block and took the plugin
		// down with it.
		await expect(
			sender.send(Buffer.alloc(4), "no-such-host.invalid", 9000),
		).rejects.toThrow();
	});

	it("still works after a failed send", async () => {
		await expect(sender.send(Buffer.alloc(4), "no-such-host.invalid", 9000)).rejects.toThrow();

		const arrived = nextPacket();
		await sender.send(build({ Name: "/ok" }), "127.0.0.1", port);
		expect(await arrived).toEqual(hex("2f 6f 6b 00 2c 00 00 00"));
	});
});
