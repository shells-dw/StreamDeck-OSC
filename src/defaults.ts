import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_ADDRESS, DEFAULT_IP, DEFAULT_PORT, type OscSettings } from "./settings.js";

/**
 * Reads the legacy `appsettings.json`, for one-time import into global settings.
 *
 * Superseded by global-defaults.ts. This exists only so that an installation
 * carrying a configured file keeps its values instead of being reset; nothing
 * calls it once the import has been recorded.
 *
 * Version 2 documented an `appsettings.json` beside the plugin for this, so it
 * is still read. Two things differ:
 *
 * 1. The path is derived from this module's own location rather than the
 *    process working directory. Stream Deck does not guarantee what the working
 *    directory is, so the version 2 lookup only worked by luck and silently
 *    fell back to hard-coded values when it did not.
 * 2. A missing or malformed file is not an error. It is simply absent.
 *
 * Note that Stream Deck replaces the plugin folder on upgrade, so edits to this
 * file do not survive updating the plugin. That was true of version 2 as well.
 */
export type Defaults = Pick<OscSettings, "IP" | "Port" | "Name">;

const FALLBACK: Defaults = { IP: DEFAULT_IP, Port: DEFAULT_PORT, Name: DEFAULT_ADDRESS };

export async function loadFileDefaults(log: (message: string) => void): Promise<Defaults> {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const file = path.resolve(here, "..", "appsettings.json");

	try {
		const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
		const section = (parsed as { DefaultSettings?: Record<string, unknown> })?.DefaultSettings;
		if (section === undefined) {
			return FALLBACK;
		}

		const port = Number(section["Port"]);

		const defaults: Defaults = {
			IP: typeof section["IP"] === "string" && section["IP"].trim() !== "" ? section["IP"].trim() : DEFAULT_IP,
			Port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
			Name: typeof section["Name"] === "string" && section["Name"] !== "" ? section["Name"] : DEFAULT_ADDRESS,
		};

		log(`Loaded defaults from ${file}: ${defaults.IP}:${defaults.Port} ${defaults.Name}`);
		return defaults;
	} catch {
		return FALLBACK;
	}
}
