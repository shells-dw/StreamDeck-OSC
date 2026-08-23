import dgram from "node:dgram";

import { decodePacket, type DecodedMessage } from "../osc/decode.js";
import { matchesAddress } from "../osc/match.js";

/**
 * Inbound OSC.
 *
 * A port can only be bound once, but any number of buttons may want to watch
 * traffic arriving on it, so sockets are shared and reference-counted: the
 * first subscriber opens the port and the last one to leave closes it. Each
 * subscription carries an address pattern, and a packet is dispatched to every
 * subscription it matches.
 *
 * Malformed packets are dropped with a log line rather than thrown. Anything on
 * the network can send to a bound port, so a parse failure is an expected
 * condition, not an error in this plugin.
 */

export type Subscription = {
	/** Stops delivery and releases the port when nothing else is using it. */
	dispose(): void;
};

type Watcher = {
	address: string;
	handler: (message: DecodedMessage, from: string) => void;
};

type Binding = {
	socket: dgram.Socket | null;
	pending: Promise<dgram.Socket>;
	watchers: Set<Watcher>;
};

export class OscReceiver {
	readonly #bindings = new Map<number, Binding>();
	readonly #log: (message: string) => void;

	public constructor(log: (message: string) => void) {
		this.#log = log;
	}

	/**
	 * Watches a port for messages matching an address pattern.
	 *
	 * Returns immediately; binding happens in the background so that a port
	 * already in use — a common situation, since OSC software often wants the
	 * same well-known ports — cannot stall the caller.
	 */
	public subscribe(
		port: number,
		address: string,
		handler: (message: DecodedMessage, from: string) => void,
	): Subscription {
		const watcher: Watcher = { address, handler };
		const binding = this.#bind(port);
		binding.watchers.add(watcher);

		let disposed = false;
		return {
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				binding.watchers.delete(watcher);
				this.#releaseIfIdle(port);
			},
		};
	}

	/** Closes every open port. */
	public async close(): Promise<void> {
		const ports = [...this.#bindings.keys()];
		await Promise.all(ports.map((port) => this.#close(port)));
	}

	#bind(port: number): Binding {
		const existing = this.#bindings.get(port);
		if (existing) {
			return existing;
		}

		const binding: Binding = {
			socket: null,
			watchers: new Set(),
			pending: new Promise<dgram.Socket>((resolve, reject) => {
				const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

				const onBindError = (error: Error): void => {
					this.#bindings.delete(port);
					this.#log(`Could not listen on port ${port}: ${error.message}`);
					reject(error);
				};

				socket.once("error", onBindError);

				socket.bind(port, () => {
					socket.off("error", onBindError);

					// After binding, an unhandled 'error' event would still end the
					// process, so it is logged instead.
					socket.on("error", (error) => this.#log(`Listener on port ${port}: ${error.message}`));

					socket.on("message", (data, remote) => this.#dispatch(port, data, remote.address));

					socket.unref();
					this.#log(`Listening for OSC on port ${port}`);
					resolve(socket);
				});
			}),
		};

		binding.pending.then(
			(socket) => (binding.socket = socket),
			() => {
				// Already logged; the subscription simply never receives anything.
			},
		);

		this.#bindings.set(port, binding);
		return binding;
	}

	#dispatch(port: number, data: Buffer, from: string): void {
		const binding = this.#bindings.get(port);
		if (binding === undefined || binding.watchers.size === 0) {
			return;
		}

		let messages: DecodedMessage[];
		try {
			messages = decodePacket(data);
		} catch (error) {
			this.#log(`Ignoring unparseable packet from ${from}: ${error instanceof Error ? error.message : error}`);
			return;
		}

		for (const message of messages) {
			for (const watcher of binding.watchers) {
				if (matchesAddress(watcher.address, message.address)) {
					try {
						watcher.handler(message, from);
					} catch (error) {
						this.#log(`Watcher for ${watcher.address} threw: ${error instanceof Error ? error.message : error}`);
					}
				}
			}
		}
	}

	#releaseIfIdle(port: number): void {
		const binding = this.#bindings.get(port);
		if (binding !== undefined && binding.watchers.size === 0) {
			void this.#close(port);
		}
	}

	async #close(port: number): Promise<void> {
		const binding = this.#bindings.get(port);
		if (binding === undefined) {
			return;
		}

		this.#bindings.delete(port);

		try {
			const socket = binding.socket ?? (await binding.pending);
			await new Promise<void>((resolve) => socket.close(resolve));
		} catch {
			// Never bound, so nothing to close.
		}
	}
}
