import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { getDefaults } from "../global-defaults.js";
import type { JsonValue } from "../json.js";
import { OscReceiver, type Subscription } from "../net/receiver.js";
import { UdpSender } from "../net/udp.js";
import { normaliseAddress } from "../osc/address.js";
import { toNumber, toText, type DecodedMessage } from "../osc/decode.js";
import { encodeMessage } from "../osc/encode.js";
import { OscError, parseArg, type OscArg, type OscArgSetting } from "../osc/types.js";
import {
	clampDial,
	dialPercent,
	resolveAddress,
	resolveArgs,
	resolveDial,
	resolveKeepAlive,
	resolveTarget,
	resolveWatch,
	type OscSettings,
} from "../settings.js";

const logger = streamDeck.logger.createScope("SendOsc");

const sender = new UdpSender((error) => {
	// Asynchronous socket errors, typically an ICMP port-unreachable arriving
	// after the send already succeeded. What matters is that it is handled at
	// all — an unhandled 'error' event would end the process.
	logger.warn(`UDP socket error: ${error.message}`);
});

const receiver = new OscReceiver((message) => logger.info(message));

/** Rotation is coalesced onto a timer; a dial emits far more ticks than a device wants. */
const ROTATE_INTERVAL_MS = 40;

type Surface = DialAction<OscSettings> | KeyAction<OscSettings>;

/** Per-button runtime state, torn down in onWillDisappear. */
type Instance = {
	/** Current value, held between rotations and updated by inbound messages. */
	value: number;
	flushTimer?: NodeJS.Timeout;
	subscription?: Subscription;
	keepAlive?: NodeJS.Timeout;
	warnedAboutAddress: boolean;
};

const instances = new Map<string, Instance>();



@action({ UUID: "de.shells.osc.pluginaction" })
export class SendOscCommand extends SingletonAction<OscSettings> {
	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	public override async onWillAppear(ev: WillAppearEvent<OscSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// A button that has never been configured gets the defaults; one that
		// has is left exactly as the user left it.
		if (Object.keys(settings).length === 0) {
			const { IP, Port, Name } = await getDefaults((message) => logger.info(message));
			await ev.action.setSettings({ IP, Port, Name });
			return;
		}

		this.#attach(ev.action, settings);
		await this.#showPlaceholder(ev.action, settings);
	}

	public override onWillDisappear(ev: WillDisappearEvent<OscSettings>): void {
		this.#detach(ev.action.id);
	}

	public override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<OscSettings>): Promise<void> {
		// Settings changed in the property inspector: rebuild the subscription
		// and keep-alive against the new values.
		this.#detach(ev.action.id);
		this.#attach(ev.action, ev.payload.settings);
		await this.#showPlaceholder(ev.action, ev.payload.settings);
	}

	// -----------------------------------------------------------------------
	// Keys
	// -----------------------------------------------------------------------

	public override async onKeyDown(ev: KeyDownEvent<OscSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const result = await this.#send(ev.action.id, settings, resolveArgs(settings));

		if (result.ok) {
			await ev.action.showOk();
		} else {
			await ev.action.showAlert();
		}
	}

	// -----------------------------------------------------------------------
	// Dials (Stream Deck +)
	// -----------------------------------------------------------------------

	public override async onDialRotate(ev: DialRotateEvent<OscSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const range = resolveDial(settings);

		if (range.argIndex < 0) {
			logger.warn("Dial rotated, but no argument is configured to carry the value.");
			await ev.action.showAlert();
			return;
		}

		const instance = this.#instance(ev.action.id);
		instance.value = clampDial(instance.value + ev.payload.ticks * range.step, range);

		// Show the new value immediately; only the message itself is coalesced,
		// so the touchscreen still tracks the dial one-to-one.
		await this.#feedback(ev.action, settings, String(instance.value), dialPercent(instance.value, range));

		if (instance.flushTimer !== undefined) {
			return;
		}

		instance.flushTimer = setTimeout(() => {
			instance.flushTimer = undefined;
			void this.#sendDialValue(ev.action.id, settings, instance.value);
		}, ROTATE_INTERVAL_MS);
	}

	public override async onDialDown(ev: DialDownEvent<OscSettings>): Promise<void> {
		const settings = ev.payload.settings;

		// With a press value configured, a press jumps the dial there — useful
		// for "reset to unity" or "back to zero". Without one, a press does what
		// a key press does and sends the message as configured.
		if (typeof settings.DialPressValue === "number") {
			const range = resolveDial(settings);
			const instance = this.#instance(ev.action.id);
			instance.value = clampDial(settings.DialPressValue, range);

			await this.#feedback(ev.action, settings, String(instance.value), dialPercent(instance.value, range));
			await this.#sendDialValue(ev.action.id, settings, instance.value);
			return;
		}

		const result = await this.#send(ev.action.id, settings, resolveArgs(settings));
		if (!result.ok) {
			await ev.action.showAlert();
		}
	}

	/** Substitutes the dial's value into the argument it drives, then sends. */
	async #sendDialValue(id: string, settings: OscSettings, value: number): Promise<void> {
		const range = resolveDial(settings);
		const args = resolveArgs(settings);
		const driven = args[range.argIndex];

		if (driven === undefined) {
			return;
		}

		const replaced: OscArgSetting[] = args.map((arg, index) =>
			index === range.argIndex ? { type: driven.type, value: String(value) } : arg,
		);

		await this.#send(id, settings, replaced);
	}

	// -----------------------------------------------------------------------
	// Property inspector
	// -----------------------------------------------------------------------

	public override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OscSettings>): Promise<void> {
		const payload = ev.payload;
		if (typeof payload !== "object" || payload === null || !("event" in payload) || payload.event !== "test") {
			return;
		}

		const settings = await ev.action.getSettings();
		const result = await this.#send(ev.action.id, settings, resolveArgs(settings));

		await streamDeck.ui.sendToPropertyInspector({ event: "testResult", ...result });
	}

	// -----------------------------------------------------------------------
	// Sending
	// -----------------------------------------------------------------------

	async #send(
		id: string,
		settings: OscSettings,
		argSettings: OscArgSetting[],
	): Promise<{ ok: boolean; message: string }> {
		let packet: Buffer;
		let target: { host: string; port: number };

		try {
			target = resolveTarget(settings);

			const { address, warning } = normaliseAddress(resolveAddress(settings));
			const instance = this.#instance(id);
			if (warning && !instance.warnedAboutAddress) {
				instance.warnedAboutAddress = true;
				logger.warn(warning);
			}

			const args: OscArg[] = argSettings.map((arg, index) => parseArg(arg, index));
			packet = encodeMessage(address, args);
		} catch (error) {
			// A malformed configuration. Sending a partial message would be worse
			// than sending none: it is a different message, not a degraded one.
			const message = error instanceof OscError ? error.message : String(error);
			logger.error(`Not sending: ${message}`);
			return { ok: false, message };
		}

		try {
			await sender.send(packet, target.host, target.port);
			logger.debug(`Sent ${packet.length} bytes to ${target.host}:${target.port}`);
			return { ok: true, message: `Sent ${packet.length} bytes to ${target.host}:${target.port}` };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Send to ${target.host}:${target.port} failed: ${message}`);
			return { ok: false, message };
		}
	}

	/** Sends a bare address with no arguments, used for the keep-alive. */
	async #sendBare(id: string, settings: OscSettings, address: string): Promise<void> {
		await this.#send(id, { ...settings, Name: address }, []);
	}

	// -----------------------------------------------------------------------
	// Receiving
	// -----------------------------------------------------------------------

	#attach(surface: Surface, settings: OscSettings): void {
		const instance = this.#instance(surface.id);

		const watch = resolveWatch(settings);
		if (watch !== null) {
			instance.subscription = receiver.subscribe(watch.port, watch.address, (message) => {
				void this.#onIncoming(surface, settings, message);
			});
		}

		// Devices differ wildly here: a mixing desk may want a subscribe message
		// repeated every few seconds, a game engine may want a custom one, and
		// plenty of software needs none. So it is configuration, not a special
		// case per device.
		const keepAlive = resolveKeepAlive(settings);
		if (keepAlive !== null) {
			const tick = (): void => void this.#sendBare(surface.id, settings, keepAlive.address);
			tick();
			instance.keepAlive = setInterval(tick, keepAlive.seconds * 1000);
			instance.keepAlive.unref?.();
		}
	}

	#detach(id: string): void {
		const instance = instances.get(id);
		if (instance === undefined) {
			return;
		}

		instance.subscription?.dispose();
		if (instance.keepAlive !== undefined) {
			clearInterval(instance.keepAlive);
		}
		if (instance.flushTimer !== undefined) {
			clearTimeout(instance.flushTimer);
		}

		instances.delete(id);
	}

	async #onIncoming(surface: Surface, settings: OscSettings, message: DecodedMessage): Promise<void> {
		const watch = resolveWatch(settings);
		if (watch === null) {
			return;
		}

		const arg = message.args[watch.argIndex];
		const text = toText(arg, watch.decimals);
		const numeric = toNumber(arg);

		// Keep the dial in step with the device, so the next rotation continues
		// from where the device actually is rather than from a stale local value.
		if (numeric !== null) {
			this.#instance(surface.id).value = numeric;
		}

		const range = resolveDial(settings);
		await this.#feedback(surface, settings, text, numeric === null ? undefined : dialPercent(numeric, range));
	}

	// -----------------------------------------------------------------------
	// Display
	// -----------------------------------------------------------------------

	/** Shows a dash until the first message arrives, so a watching button looks alive. */
	async #showPlaceholder(surface: Surface, settings: OscSettings): Promise<void> {
		if (resolveWatch(settings) === null && !surface.isDial()) {
			return;
		}
		await this.#feedback(surface, settings, "—", undefined);
	}

	/**
	 * Shows a value on whichever surface this action is sitting on.
	 *
	 * A dial has a touchscreen and takes a structured payload against the `$B1`
	 * layout, so no drawing is involved. A key has only an image, so the value
	 * is rendered as an SVG data URI — string templating rather than a graphics
	 * dependency.
	 */
	async #feedback(
		surface: Surface,
		settings: OscSettings,
		text: string,
		percent: number | undefined,
	): Promise<void> {
		try {
			if (surface.isDial()) {
				await surface.setFeedback({
					title: resolveAddress(settings),
					value: text,
					indicator: { value: percent ?? 0 },
				});
				return;
			}

			// Only take over a key's image when it is actually showing a value;
			// otherwise the user's chosen icon should stand.
			if (resolveWatch(settings) !== null) {
				await surface.setImage(keyImage(text, percent));
			}
		} catch (error) {
			logger.warn(`Could not update the display: ${error instanceof Error ? error.message : error}`);
		}
	}

	#instance(id: string): Instance {
		let instance = instances.get(id);
		if (instance === undefined) {
			instance = { value: 0, warnedAboutAddress: false };
			instances.set(id, instance);
		}
		return instance;
	}
}

/**
 * Draws the current value as a key image.
 *
 * Deliberately plain: large numerals and an optional bar, sized to stay legible
 * on a physical 72 px key, in the same amber as the plugin's iconography.
 */
function keyImage(text: string, percent: number | undefined): string {
	const safe = text.replace(/[<>&]/g, "").slice(0, 7);
	const size = safe.length > 5 ? 24 : safe.length > 3 ? 30 : 38;
	const filled = percent === undefined ? 0 : Math.max(0, Math.min(124, (124 * percent) / 100));

	const bar =
		percent === undefined
			? ""
			: `<rect x="10" y="112" width="124" height="8" rx="4" fill="#2A2A52"/>` +
				`<rect x="10" y="112" width="${filled}" height="8" rx="4" fill="#FFC24B"/>`;

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" rx="18" fill="#141428"/>` +
		`<text x="72" y="66" fill="#FFC24B" font-family="Segoe UI, -apple-system, sans-serif" ` +
		`font-size="${size}" font-weight="600" text-anchor="middle" dominant-baseline="central">${safe}</text>` +
		bar +
		`</svg>`;

	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
