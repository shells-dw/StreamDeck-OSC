import { normaliseAddress } from "../osc/address.js";
import { checkValue, type OscArgSetting } from "../osc/types.js";
import { carriesData, isOscTypeTag, OPTIONAL_TAGS, REQUIRED_TAGS, TAG_INFO, type OscTypeTag } from "../osc/tags.js";
import { DEFAULT_ADDRESS, DEFAULT_IP, DEFAULT_PORT, resolveArgs, type OscSettings } from "../settings.js";

/**
 * Property inspector for the Send OSC Command action.
 *
 * Stream Deck loads this page in a webview and calls the global
 * `connectElgatoStreamDeckSocket` to hand over the WebSocket details.
 */

type ActionInfo = {
	action: string;
	context: string;
	payload: { settings: OscSettings };
};

let socket: WebSocket | null = null;
let context = "";
let actionId = "";

/**
 * The working copy of the settings.
 *
 * Unrecognised keys are carried through untouched. That includes the version 2
 * fields (`StringValue`, `SendInt`, and so on), which stay in place even after
 * the argument list is used, so downgrading the plugin does not strand a button
 * with no configuration.
 */
let settings: OscSettings = {};

// ---------------------------------------------------------------------------
// Stream Deck plumbing
// ---------------------------------------------------------------------------

function send(message: Record<string, unknown>): void {
	if (socket?.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(message));
	}
}

function persist(): void {
	send({ event: "setSettings", context, payload: settings });
}

function sendToPlugin(payload: Record<string, unknown>): void {
	send({ action: actionId, event: "sendToPlugin", context, payload });
}

/** Debounced so typing in a text field does not write settings on every keystroke. */
let persistTimer: number | undefined;
function persistSoon(): void {
	window.clearTimeout(persistTimer);
	persistTimer = window.setTimeout(persist, 250);
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (element === null) {
		throw new Error(`Missing element #${id}`);
	}
	return element as T;
}

const hostInput = el<HTMLInputElement>("host");
const portInput = el<HTMLInputElement>("port");
const addressInput = el<HTMLInputElement>("address");
const addressErrorRow = el<HTMLElement>("address-error-row");
const addressError = el<HTMLElement>("address-error");
const argList = el<HTMLElement>("arg-list");
const emptyNote = el<HTMLElement>("empty");
const tagsLabel = el<HTMLElement>("tags");
const resultLabel = el<HTMLElement>("result");

// Dial, listener and keep-alive controls.
const dialArg = el<HTMLSelectElement>("dial-arg");
const dialMin = el<HTMLInputElement>("dial-min");
const dialMax = el<HTMLInputElement>("dial-max");
const dialStep = el<HTMLInputElement>("dial-step");
const dialPress = el<HTMLInputElement>("dial-press");

const watchSection = el<HTMLElement>("watch-section");
const watchEnabled = el<HTMLInputElement>("watch-enabled");
const watchPort = el<HTMLInputElement>("watch-port");
const watchAddress = el<HTMLInputElement>("watch-address");
const watchArg = el<HTMLInputElement>("watch-arg");
const watchDecimals = el<HTMLInputElement>("watch-decimals");

const keepAliveSection = el<HTMLElement>("keepalive-section");
const keepAliveEnabled = el<HTMLInputElement>("keepalive-enabled");
const keepAliveAddress = el<HTMLInputElement>("keepalive-address");
const keepAliveSeconds = el<HTMLInputElement>("keepalive-seconds");

const defaultIp = el<HTMLInputElement>("default-ip");
const defaultPort = el<HTMLInputElement>("default-port");
const defaultAddress = el<HTMLInputElement>("default-address");

/**
 * Plugin-wide defaults for new buttons.
 *
 * Held separately from this button's settings and saved with setGlobalSettings.
 * Version 3.1 and earlier kept these in an appsettings.json beside the plugin,
 * which Stream Deck replaced on every update; these survive.
 */
type GlobalDefaults = {
	IP?: string;
	Port?: number;
	Name?: string;
	SeededFromFile?: boolean;
};

let globalDefaults: GlobalDefaults = {};

function persistGlobals(): void {
	send({ event: "setGlobalSettings", context, payload: globalDefaults });
}

let globalTimer: number | undefined;
function persistGlobalsSoon(): void {
	window.clearTimeout(globalTimer);
	globalTimer = window.setTimeout(persistGlobals, 250);
}

/**
 * Reads a numeric field, treating blank as "not set" rather than as zero.
 *
 * The distinction matters: an empty "press sets" box means a press should send
 * the message as configured, whereas 0 means it should jump the dial to zero.
 */
function optionalNumber(input: HTMLInputElement): number | undefined {
	const text = input.value.trim();
	if (text === "") {
		return undefined;
	}
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

/** Greys out a section's fields while its toggle is off. */
function setEnabled(section: HTMLElement, enabled: boolean): void {
	section.dataset["disabled"] = String(!enabled);
}

/**
 * Rebuilds the "dial drives" list from the current arguments.
 *
 * A dial has to turn *something*, and the only sensible somethings are the
 * numeric arguments already configured — so the list is derived rather than
 * entered by hand, and stays correct when arguments are added or reordered.
 */
function renderDialTargets(): void {
	const previous = settings.DialArgIndex;
	dialArg.replaceChildren();
	dialArg.appendChild(new Option("nothing — dial disabled", "-1"));

	args.forEach((arg, index) => {
		if (arg.type === "i" || arg.type === "f" || arg.type === "d" || arg.type === "h") {
			dialArg.appendChild(new Option(`argument ${index + 1} (${TAG_INFO[arg.type].label})`, String(index)));
		}
	});

	dialArg.value = String(typeof previous === "number" ? previous : -1);
	if (dialArg.selectedIndex === -1) {
		dialArg.value = "-1";
	}
}

// ---------------------------------------------------------------------------
// Argument list
// ---------------------------------------------------------------------------

/** The arguments currently being edited, derived from settings on load. */
let args: OscArgSetting[] = [];

function commitArgs(): void {
	// Writing `Args` is what migrates this button to the version 3 shape, and it
	// happens here and nowhere else — that is, only when the user actually edits
	// the arguments. Changing the address or port leaves legacy settings intact.
	settings.Args = args.map((arg) => (carriesData(arg.type) ? { type: arg.type, value: arg.value ?? "" } : { type: arg.type }));
	renderTags();
	renderDialTargets();
	persistSoon();
}

function renderTags(): void {
	tagsLabel.textContent = `,${args.map((arg) => arg.type).join("")}`;
}

function buildTypeSelect(selected: OscTypeTag): HTMLSelectElement {
	const select = document.createElement("select");

	const required = document.createElement("optgroup");
	required.label = "Required by OSC 1.0";
	for (const tag of REQUIRED_TAGS) {
		required.appendChild(new Option(TAG_INFO[tag].label, tag, false, tag === selected));
	}

	const optional = document.createElement("optgroup");
	optional.label = "Optional — device may ignore";
	for (const tag of OPTIONAL_TAGS) {
		optional.appendChild(new Option(TAG_INFO[tag].label, tag, false, tag === selected));
	}

	select.append(required, optional);
	select.value = selected;
	return select;
}

let dragFrom: number | null = null;

function renderArgs(): void {
	argList.replaceChildren();
	emptyNote.hidden = args.length > 0;

	args.forEach((arg, index) => {
		const row = document.createElement("div");
		row.className = "arg";
		row.draggable = true;

		const handle = document.createElement("span");
		handle.className = "handle";
		handle.textContent = "⠿";
		handle.title = "Drag to reorder";

		const select = buildTypeSelect(arg.type);
		select.setAttribute("aria-label", `Argument ${index + 1} type`);
		select.addEventListener("change", () => {
			const next = select.value;
			if (!isOscTypeTag(next)) {
				return;
			}
			args[index] = carriesData(next) ? { type: next, value: arg.value ?? "" } : { type: next };
			commitArgs();
			renderArgs();
		});

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "remove";
		remove.textContent = "×";
		remove.title = "Remove this argument";
		remove.setAttribute("aria-label", `Remove argument ${index + 1}`);
		remove.addEventListener("click", () => {
			args.splice(index, 1);
			commitArgs();
			renderArgs();
		});

		row.append(handle, select);

		if (carriesData(arg.type)) {
			const value = document.createElement("input");
			value.type = "text";
			value.spellcheck = false;
			value.autocomplete = "off";
			value.value = arg.value ?? "";
			value.placeholder = TAG_INFO[arg.type].hint ?? "";
			value.setAttribute("aria-label", `Argument ${index + 1} value`);

			const error = document.createElement("span");
			error.className = "error";
			error.hidden = true;

			const validate = (): void => {
				// The message is shown beneath the field. It is never written into
				// the field itself — doing that destroys what the user typed, and
				// version 2 then read the error text back as if it were a value.
				const problem = checkValue(arg.type, value.value);
				error.textContent = problem ?? "";
				error.hidden = problem === null;
			};

			value.addEventListener("input", () => {
				args[index] = { type: arg.type, value: value.value };
				validate();
				commitArgs();
			});

			row.append(value, remove, error);
			validate();
		} else {
			const note = document.createElement("span");
			note.className = "note";
			note.textContent = "no value";
			row.append(note, remove);
		}

		row.addEventListener("dragstart", () => {
			dragFrom = index;
			row.classList.add("dragging");
		});

		row.addEventListener("dragend", () => {
			dragFrom = null;
			row.classList.remove("dragging");
			argList.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
		});

		row.addEventListener("dragover", (event) => {
			event.preventDefault();
			row.classList.add("drop-target");
		});

		row.addEventListener("dragleave", () => row.classList.remove("drop-target"));

		row.addEventListener("drop", (event) => {
			event.preventDefault();
			if (dragFrom === null || dragFrom === index) {
				return;
			}
			const [moved] = args.splice(dragFrom, 1);
			if (moved !== undefined) {
				args.splice(index, 0, moved);
				commitArgs();
				renderArgs();
			}
		});

		argList.appendChild(row);
	});

	renderTags();
}

// ---------------------------------------------------------------------------
// Top fields
// ---------------------------------------------------------------------------

function validateAddress(): void {
	try {
		const { warning } = normaliseAddress(addressInput.value === "" ? DEFAULT_ADDRESS : addressInput.value);
		addressError.textContent = warning ?? "";
		addressErrorRow.hidden = warning === undefined;
	} catch (error) {
		addressError.textContent = error instanceof Error ? error.message : String(error);
		addressErrorRow.hidden = false;
	}
}

hostInput.addEventListener("input", () => {
	settings.IP = hostInput.value.trim();
	persistSoon();
});

portInput.addEventListener("input", () => {
	// Stored as a number. Version 2 stored whatever the input element gave it,
	// which was a string, and relied on the C# side coercing it.
	const port = Number.parseInt(portInput.value, 10);
	settings.Port = Number.isInteger(port) ? port : DEFAULT_PORT;
	persistSoon();
});

addressInput.addEventListener("input", () => {
	settings.Name = addressInput.value;
	validateAddress();
	persistSoon();
});

el<HTMLButtonElement>("add").addEventListener("click", () => {
	args.push({ type: "f", value: "" });
	commitArgs();
	renderArgs();
	(argList.lastElementChild?.querySelector("input") as HTMLInputElement | null)?.focus();
});

el<HTMLButtonElement>("test").addEventListener("click", () => {
	resultLabel.textContent = "Sending…";
	resultLabel.className = "result";
	window.clearTimeout(persistTimer);
	persist();
	// Give Stream Deck a moment to store the settings the plugin will read back.
	window.setTimeout(() => sendToPlugin({ event: "test" }), 120);
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function load(incoming: OscSettings): void {
	settings = { ...incoming };

	dialMin.value = settings.DialMin === undefined ? "" : String(settings.DialMin);
	dialMax.value = settings.DialMax === undefined ? "" : String(settings.DialMax);
	dialStep.value = settings.DialStep === undefined ? "" : String(settings.DialStep);
	dialPress.value = typeof settings.DialPressValue === "number" ? String(settings.DialPressValue) : "";

	watchEnabled.checked = settings.WatchEnabled === true;
	watchPort.value = settings.WatchPort === undefined ? "" : String(settings.WatchPort);
	watchAddress.value = typeof settings.WatchAddress === "string" ? settings.WatchAddress : "";
	watchArg.value = settings.WatchArgIndex === undefined ? "" : String(settings.WatchArgIndex);
	watchDecimals.value = settings.WatchDecimals === undefined ? "" : String(settings.WatchDecimals);
	setEnabled(watchSection, watchEnabled.checked);

	keepAliveEnabled.checked = settings.KeepAliveEnabled === true;
	keepAliveAddress.value = typeof settings.KeepAliveAddress === "string" ? settings.KeepAliveAddress : "";
	keepAliveSeconds.value = settings.KeepAliveSeconds === undefined ? "" : String(settings.KeepAliveSeconds);
	setEnabled(keepAliveSection, keepAliveEnabled.checked);

	hostInput.value = typeof settings.IP === "string" && settings.IP !== "" ? settings.IP : DEFAULT_IP;
	portInput.value = String(
		typeof settings.Port === "string" ? (settings.Port.trim() === "" ? DEFAULT_PORT : settings.Port.trim()) : (settings.Port ?? DEFAULT_PORT),
	);
	addressInput.value = typeof settings.Name === "string" ? settings.Name : DEFAULT_ADDRESS;

	// Projects the version 2 checkbox fields onto the argument list when this
	// button has never been edited with version 3.
	args = resolveArgs(settings).map((arg) => ({ ...arg }));

	validateAddress();
	renderArgs();
	renderDialTargets();
}

// ---------------------------------------------------------------------------
// Dial, listener and keep-alive wiring
// ---------------------------------------------------------------------------

dialArg.addEventListener("change", () => {
	settings.DialArgIndex = Number.parseInt(dialArg.value, 10);
	persistSoon();
});

for (const [input, key] of [
	[dialMin, "DialMin"],
	[dialMax, "DialMax"],
	[dialStep, "DialStep"],
	[dialPress, "DialPressValue"],
	[watchArg, "WatchArgIndex"],
	[watchDecimals, "WatchDecimals"],
	[keepAliveSeconds, "KeepAliveSeconds"],
] as const) {
	input.addEventListener("input", () => {
		const value = optionalNumber(input);
		if (value === undefined) {
			delete settings[key];
		} else {
			settings[key] = value;
		}
		persistSoon();
	});
}

watchEnabled.addEventListener("change", () => {
	settings.WatchEnabled = watchEnabled.checked;
	setEnabled(watchSection, watchEnabled.checked);
	persistSoon();
});

watchPort.addEventListener("input", () => {
	const port = Number.parseInt(watchPort.value, 10);
	settings.WatchPort = Number.isInteger(port) ? port : undefined;
	persistSoon();
});

watchAddress.addEventListener("input", () => {
	settings.WatchAddress = watchAddress.value.trim();
	persistSoon();
});

keepAliveEnabled.addEventListener("change", () => {
	settings.KeepAliveEnabled = keepAliveEnabled.checked;
	setEnabled(keepAliveSection, keepAliveEnabled.checked);
	persistSoon();
});

keepAliveAddress.addEventListener("input", () => {
	settings.KeepAliveAddress = keepAliveAddress.value.trim();
	persistSoon();
});

defaultIp.addEventListener("input", () => {
	globalDefaults.IP = defaultIp.value.trim();
	persistGlobalsSoon();
});

defaultPort.addEventListener("input", () => {
	const port = Number.parseInt(defaultPort.value, 10);
	globalDefaults.Port = Number.isInteger(port) ? port : undefined;
	persistGlobalsSoon();
});

defaultAddress.addEventListener("input", () => {
	globalDefaults.Name = defaultAddress.value;
	persistGlobalsSoon();
});

function loadGlobals(incoming: GlobalDefaults): void {
	globalDefaults = { ...incoming };
	defaultIp.value = incoming.IP ?? "";
	defaultPort.value = incoming.Port === undefined ? "" : String(incoming.Port);
	defaultAddress.value = incoming.Name ?? "";
}

// ---------------------------------------------------------------------------
// Entry point called by Stream Deck
// ---------------------------------------------------------------------------

declare global {
	interface Window {
		connectElgatoStreamDeckSocket: (
			port: string,
			uuid: string,
			registerEvent: string,
			info: string,
			actionInfo: string,
		) => void;
	}
}

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo): void => {
	context = uuid;

	const parsed = JSON.parse(actionInfo) as ActionInfo;
	actionId = parsed.action;

	socket = new WebSocket(`ws://127.0.0.1:${port}`);

	socket.addEventListener("open", () => {
		send({ event: registerEvent, uuid });
		load(parsed.payload?.settings ?? {});
		send({ event: "getGlobalSettings", context: uuid });
	});

	socket.addEventListener("message", (event: MessageEvent<string>) => {
		const message = JSON.parse(event.data) as { event: string; payload?: Record<string, unknown> };

		if (message.event === "didReceiveSettings") {
			// Only reload when the change came from elsewhere; reloading mid-edit
			// would move the caret out from under the user.
			if (document.activeElement === document.body) {
				load((message.payload?.["settings"] as OscSettings) ?? {});
			}
			return;
		}

		if (message.event === "didReceiveGlobalSettings") {
			if (document.activeElement === document.body) {
				loadGlobals((message.payload?.["settings"] as GlobalDefaults) ?? {});
			}
			return;
		}

		if (message.event === "sendToPropertyInspector" && message.payload?.["event"] === "testResult") {
			const ok = message.payload["ok"] === true;
			resultLabel.textContent = String(message.payload["message"] ?? "");
			resultLabel.className = ok ? "result ok" : "result bad";
		}
	});

	socket.addEventListener("close", () => {
		socket = null;
	});
};
