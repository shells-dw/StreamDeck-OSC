import type { JsonValue } from "./json.js";
import { isOscTypeTag, type OscArgSetting } from "./osc/types.js";

/**
 * Settings persisted against a button.
 *
 * The key names are inherited verbatim from version 2 of this plugin, which was
 * written in C#. They are PascalCase and `Name` means "OSC address", neither of
 * which is what one would choose today — but Stream Deck stores these keys in
 * the user's profile, so renaming them would orphan every existing button's
 * configuration. They stay as they are.
 *
 * `Args` is the only addition. When it is absent the legacy fields are used,
 * which is what makes an upgrade invisible to someone who never opens the
 * property inspector.
 */
export type OscSettings = {
	IP?: string;
	Port?: number | string;
	Name?: string;

	/** Version 3: ordered argument list. Absent on settings written by version 2. */
	Args?: OscArgSetting[];

	/** Version 3.1: dial behaviour, when placed on a Stream Deck + encoder. */
	DialMin?: number;
	DialMax?: number;
	DialStep?: number;
	/** Which entry in `Args` the dial drives. Defaults to the first with a value. */
	DialArgIndex?: number;
	/** Value sent when the dial is pressed; omitted means press sends nothing. */
	DialPressValue?: number | null;

	/** Version 3.1: inbound OSC, for showing a value on the key or touchscreen. */
	WatchEnabled?: boolean;
	WatchPort?: number | string;
	WatchAddress?: string;
	/** Which argument of the incoming message to display. Defaults to the first. */
	WatchArgIndex?: number;
	WatchDecimals?: number;

	/** Version 3.1: optional periodic message, for devices that require a subscription. */
	KeepAliveEnabled?: boolean;
	KeepAliveAddress?: string;
	KeepAliveSeconds?: number;

	/** Version 2 fields, still read, still written back untouched. */
	StringValue?: string;
	IntValue?: number | null;
	FloatValue?: number | null;
	SendString?: boolean;
	SendInt?: boolean;
	SendFloat?: boolean;

	/** Anything else Stream Deck has stored is carried through untouched. */
	[key: string]: JsonValue;
};

export const DEFAULT_IP = "127.0.0.1";
export const DEFAULT_PORT = 7001;
export const DEFAULT_ADDRESS = "/";
export const DEFAULT_DIAL_MIN = 0;
export const DEFAULT_DIAL_MAX = 1;
export const DEFAULT_DIAL_STEP = 0.01;
export const DEFAULT_WATCH_PORT = 9000;
export const DEFAULT_KEEPALIVE_SECONDS = 9;

export type Target = {
	host: string;
	port: number;
};

/**
 * Reads the destination, tolerating the loose types version 2 could persist.
 *
 * The old property inspector passed the port straight from an input element
 * without converting it, so a port is as likely to be the string "7001" as the
 * number 7001. C#'s JSON deserialiser coerced it silently; nothing here should
 * depend on that having happened.
 */
export function resolveTarget(settings: OscSettings): Target {
	const host = typeof settings.IP === "string" && settings.IP.trim() !== "" ? settings.IP.trim() : DEFAULT_IP;

	const rawPort = typeof settings.Port === "string" ? Number(settings.Port.trim()) : settings.Port;
	const port = Number.isInteger(rawPort) && rawPort! >= 1 && rawPort! <= 65535 ? (rawPort as number) : DEFAULT_PORT;

	return { host, port };
}

export function resolveAddress(settings: OscSettings): string {
	return typeof settings.Name === "string" && settings.Name.trim() !== "" ? settings.Name : DEFAULT_ADDRESS;
}

/**
 * Produces the argument list for a set of settings.
 *
 * When `Args` is present it wins. Otherwise the version 2 checkbox fields are
 * projected onto the same shape, in the order the old C# `BuildOscArguments`
 * used: string, then int, then float. Preserving that order is what guarantees
 * an upgraded button puts identical bytes on the wire.
 *
 * This is deliberately a read-time projection rather than a write-time
 * migration. Nothing is persisted until the user edits the arguments
 * themselves, so a button left alone stays readable by version 2 — which
 * matters if anyone needs to roll back.
 */
export function resolveArgs(settings: OscSettings): OscArgSetting[] {
	if (Array.isArray(settings.Args)) {
		return (settings.Args as unknown[]).filter((arg): arg is OscArgSetting => {
			return (
				arg !== null &&
				typeof arg === "object" &&
				"type" in arg &&
				isOscTypeTag(String((arg as { type: unknown }).type))
			);
		});
	}

	const args: OscArgSetting[] = [];

	if (settings.SendString) {
		args.push({ type: "s", value: settings.StringValue ?? "" });
	}

	// Version 2 boxed a nullable int/float straight into the argument list, so
	// ticking the box with an empty field produced a null argument that SharpOSC
	// could not serialise. Here an unset value simply contributes no argument.
	if (settings.SendInt && settings.IntValue !== null && settings.IntValue !== undefined) {
		args.push({ type: "i", value: String(settings.IntValue) });
	}

	if (settings.SendFloat && settings.FloatValue !== null && settings.FloatValue !== undefined) {
		args.push({ type: "f", value: String(settings.FloatValue) });
	}

	return args;
}

/** True when these settings still use the version 2 shape. */
export function isLegacy(settings: OscSettings): boolean {
	return !Array.isArray(settings.Args);
}

/**
 * Converts legacy settings into the version 3 shape, for the moment the user
 * first edits the argument list in the property inspector.
 */
export function migrate(settings: OscSettings): OscSettings {
	if (!isLegacy(settings)) {
		return settings;
	}

	return { ...settings, Args: resolveArgs(settings) };
}


// ---------------------------------------------------------------------------
// Version 3.1 additions
// ---------------------------------------------------------------------------

export type DialRange = {
	min: number;
	max: number;
	step: number;
	/** Index into the argument list that the dial's value replaces. */
	argIndex: number;
	/** Whole numbers only, inferred from the type of the argument being driven. */
	integral: boolean;
};

/**
 * Works out what a dial rotation should do.
 *
 * The dial drives one argument rather than the whole message, so that a message
 * like `/ch/1/level <int channel> <float value>` can have its channel fixed and
 * only the level move. When no index is configured, the first argument that
 * carries a value is used, which is what a single-argument message wants.
 */
export function resolveDial(settings: OscSettings): DialRange {
	const args = resolveArgs(settings);

	let argIndex = typeof settings.DialArgIndex === "number" ? settings.DialArgIndex : -1;
	if (argIndex < 0 || argIndex >= args.length) {
		// Fall back to the first argument a dial could sensibly drive, so a
		// button works on an encoder without being configured twice. Only
		// numeric types qualify: overwriting a string argument with a number
		// would change the message's meaning, not just its value.
		argIndex = args.findIndex((arg) => arg.type === "i" || arg.type === "f" || arg.type === "d" || arg.type === "h");
	}

	const tag = args[argIndex]?.type;
	const integral = tag === "i" || tag === "h";

	const min = typeof settings.DialMin === "number" ? settings.DialMin : DEFAULT_DIAL_MIN;
	const max = typeof settings.DialMax === "number" ? settings.DialMax : DEFAULT_DIAL_MAX;

	let step = typeof settings.DialStep === "number" && settings.DialStep > 0 ? settings.DialStep : DEFAULT_DIAL_STEP;
	if (integral) {
		step = Math.max(1, Math.round(step));
	}

	// A max below the min would make every rotation a no-op; swap rather than
	// silently doing nothing.
	return { min: Math.min(min, max), max: Math.max(min, max), step, argIndex, integral };
}

/** Clamps and rounds a dial value to its configured range. */
export function clampDial(value: number, range: DialRange): number {
	const clamped = Math.min(range.max, Math.max(range.min, value));
	if (range.integral) {
		return Math.round(clamped);
	}
	// Snap to the step grid so repeated rotation does not accumulate float drift.
	const steps = Math.round((clamped - range.min) / range.step);
	const snapped = range.min + steps * range.step;
	return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(6));
}

/** Position within the range, 0 to 100, for the touchscreen's progress bar. */
export function dialPercent(value: number, range: DialRange): number {
	if (range.max === range.min) {
		return 0;
	}
	return Math.round(((value - range.min) / (range.max - range.min)) * 100);
}

export type WatchConfig = {
	port: number;
	address: string;
	argIndex: number;
	decimals: number;
};

/** Reads the inbound configuration, or null when this button is not watching. */
export function resolveWatch(settings: OscSettings): WatchConfig | null {
	if (settings.WatchEnabled !== true) {
		return null;
	}

	const rawPort = typeof settings.WatchPort === "string" ? Number(settings.WatchPort.trim()) : settings.WatchPort;
	const port =
		Number.isInteger(rawPort) && rawPort! >= 1 && rawPort! <= 65535 ? (rawPort as number) : DEFAULT_WATCH_PORT;

	// Watching defaults to the address this button sends to, which is what a
	// device that echoes its own state back will use.
	const address =
		typeof settings.WatchAddress === "string" && settings.WatchAddress.trim() !== ""
			? settings.WatchAddress.trim()
			: resolveAddress(settings);

	const argIndex = typeof settings.WatchArgIndex === "number" && settings.WatchArgIndex >= 0 ? settings.WatchArgIndex : 0;
	const decimals = typeof settings.WatchDecimals === "number" && settings.WatchDecimals >= 0 ? Math.min(6, settings.WatchDecimals) : 2;

	return { port, address, argIndex, decimals };
}

export type KeepAliveConfig = {
	address: string;
	seconds: number;
};

/**
 * Reads the keep-alive configuration.
 *
 * Some devices transmit nothing until asked, and stop again after a timeout —
 * a mixing desk might want `/xremote` every few seconds, a game engine might
 * want a custom subscribe message, and plenty of software needs none at all.
 * Rather than special-casing any of them, the message and interval are just
 * settings.
 */
export function resolveKeepAlive(settings: OscSettings): KeepAliveConfig | null {
	if (settings.KeepAliveEnabled !== true) {
		return null;
	}

	const address = typeof settings.KeepAliveAddress === "string" ? settings.KeepAliveAddress.trim() : "";
	if (address === "") {
		return null;
	}

	const seconds =
		typeof settings.KeepAliveSeconds === "number" && settings.KeepAliveSeconds > 0
			? settings.KeepAliveSeconds
			: DEFAULT_KEEPALIVE_SECONDS;

	return { address, seconds };
}
