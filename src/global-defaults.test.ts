import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Stream Deck SDK is faked here rather than mocked at the socket level:
 * these tests are about the seeding rules, not about the wire protocol.
 */
const store = { value: {} as Record<string, unknown> };
const setGlobalSettings = vi.fn(async (settings: Record<string, unknown>) => {
	store.value = settings;
});

vi.mock("@elgato/streamdeck", () => ({
	default: {
		settings: {
			getGlobalSettings: async () => store.value,
			setGlobalSettings,
			onDidReceiveGlobalSettings: () => ({ dispose: () => {} }),
		},
	},
}));

const fileDefaults = vi.fn();
vi.mock("./defaults.js", () => ({ loadFileDefaults: fileDefaults }));

const { BUILT_IN, getDefaults, resetDefaultsCache } = await import("./global-defaults.js");

describe("global defaults", () => {
	beforeEach(() => {
		store.value = {};
		setGlobalSettings.mockClear();
		fileDefaults.mockReset();
		resetDefaultsCache();
	});

	it("imports appsettings.json on first run and records that it did", async () => {
		fileDefaults.mockResolvedValue({ IP: "10.0.0.7", Port: 9000, Name: "/live" });

		const defaults = await getDefaults(() => {});

		expect(defaults.IP).toBe("10.0.0.7");
		expect(defaults.Port).toBe(9000);
		expect(defaults.Name).toBe("/live");
		expect(defaults.SeededFromFile).toBe(true);
		expect(setGlobalSettings).toHaveBeenCalledOnce();
	});

	it("never reads the file again once the import is recorded", async () => {
		store.value = { IP: "192.168.0.2", Port: 8000, Name: "/x", SeededFromFile: true };

		const defaults = await getDefaults(() => {});

		expect(fileDefaults).not.toHaveBeenCalled();
		expect(defaults.IP).toBe("192.168.0.2");
	});

	it("does not let the file overwrite a preference already saved", async () => {
		// Someone who has edited the defaults in the property inspector should
		// not have them reverted by a stale file sitting beside the plugin.
		store.value = { IP: "192.168.0.2" };
		fileDefaults.mockResolvedValue({ IP: "10.0.0.7", Port: 9000, Name: "/live" });

		const defaults = await getDefaults(() => {});

		expect(defaults.IP).toBe("192.168.0.2");
		expect(defaults.Port).toBe(9000);
	});

	it("falls back to the built-in values when there is no file", async () => {
		fileDefaults.mockResolvedValue({});

		const defaults = await getDefaults(() => {});

		expect(defaults.IP).toBe(BUILT_IN.IP);
		expect(defaults.Port).toBe(BUILT_IN.Port);
		expect(defaults.Name).toBe(BUILT_IN.Name);
	});

	it("normalises a port the old file allowed to be a string", async () => {
		fileDefaults.mockResolvedValue({ Port: "9000" });

		expect((await getDefaults(() => {})).Port).toBe(9000);
	});

	it("ignores a nonsensical port in the file", async () => {
		fileDefaults.mockResolvedValue({ Port: 70000 });

		expect((await getDefaults(() => {})).Port).toBe(BUILT_IN.Port);
	});

	it("reads global settings once however many buttons appear at the same time", async () => {
		// A page of twenty buttons all fire onWillAppear together; each should
		// not cost a round trip to Stream Deck.
		fileDefaults.mockResolvedValue({});

		const results = await Promise.all(Array.from({ length: 20 }, () => getDefaults(() => {})));

		expect(fileDefaults).toHaveBeenCalledOnce();
		expect(new Set(results).size).toBe(1);
	});
});
