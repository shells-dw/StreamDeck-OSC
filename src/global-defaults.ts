import streamDeck from "@elgato/streamdeck";

import { loadFileDefaults } from "./defaults.js";
import { DEFAULT_ADDRESS, DEFAULT_IP, DEFAULT_PORT } from "./settings.js";

/**
 * Values that new buttons start with.
 *
 * These live in Stream Deck's global settings rather than in a file beside the
 * plugin. Three reasons:
 *
 *  1. The plugin folder is replaced when the plugin updates, so anything stored
 *     there is lost on every upgrade. Global settings survive.
 *  2. They can be edited from the property inspector, so there is no
 *     hand-written JSON to get wrong and no restart to remember.
 *  3. Marketplace DRM requires that files distributed with a plugin are not
 *     modified after distribution, which is exactly what editing a bundled
 *     configuration file amounts to.
 *
 * The old `appsettings.json` is still read once, so an installation that has
 * one is carried across rather than reset. After that it is ignored entirely.
 */
export type GlobalDefaults = {
	IP?: string;
	Port?: number;
	Name?: string;

	/** Marks the one-time import, so a later edit here is never overwritten. */
	SeededFromFile?: boolean;

	[key: string]: string | number | boolean | undefined;
};

export const BUILT_IN: Required<Pick<GlobalDefaults, "IP" | "Port" | "Name">> = {
	IP: DEFAULT_IP,
	Port: DEFAULT_PORT,
	Name: DEFAULT_ADDRESS,
};

/**
 * Cached because `onWillAppear` fires once per button, often several at a time
 * when a page loads, and each would otherwise round-trip to Stream Deck.
 */
let cached: Promise<GlobalDefaults> | undefined;

/**
 * Returns the current defaults, importing `appsettings.json` on first run.
 *
 * The import is deliberately one-way and one-time. Note that Stream Deck
 * replaces the plugin folder when updating, so a file edited by the user is
 * usually already gone by the time a new version runs — the import mainly
 * matters for an installation upgrading in place, and costs nothing otherwise.
 */
export function getDefaults(log: (message: string) => void): Promise<GlobalDefaults> {
	cached ??= (async () => {
		const global = await streamDeck.settings.getGlobalSettings<GlobalDefaults>();

		if (global.SeededFromFile === true) {
			return { ...BUILT_IN, ...global };
		}

		const fromFile = await loadFileDefaults(log);

		// The legacy file allowed a port written as a string, so normalise it
		// rather than carrying that looseness into the new storage.
		const port = Number(fromFile.Port);
		const imported = {
			IP: typeof fromFile.IP === "string" && fromFile.IP.trim() !== "" ? fromFile.IP.trim() : undefined,
			Port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined,
			Name: typeof fromFile.Name === "string" && fromFile.Name !== "" ? fromFile.Name : undefined,
		};

		// Anything already in global settings wins over the file, so importing
		// can never overwrite a preference the user has actually expressed.
		const seeded: GlobalDefaults = {
			...BUILT_IN,
			...Object.fromEntries(Object.entries(imported).filter(([, value]) => value !== undefined)),
			...global,
			SeededFromFile: true,
		};
		await streamDeck.settings.setGlobalSettings(seeded);

		log("Imported default values into global settings; appsettings.json is no longer read.");
		return seeded;
	})();

	return cached;
}

/**
 * Keeps the cache honest when the property inspector saves new defaults.
 *
 * Without this, a button added after an edit would still be given the values
 * read at start-up.
 */
export function watchDefaults(): void {
	streamDeck.settings.onDidReceiveGlobalSettings<GlobalDefaults>((ev) => {
		cached = Promise.resolve({ ...BUILT_IN, ...ev.settings });
	});
}

/** Test seam: forgets the cached values. */
export function resetDefaultsCache(): void {
	cached = undefined;
}
