import dgram from "node:dgram";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * UDP transport for OSC packets.
 *
 * Two things this deliberately does not do:
 *
 * 1. Open a socket per send. Version 2 constructed a new sender on every key
 *    press and never closed it, leaking a socket handle each time.
 * 2. Leave the socket's `error` event unhandled. In Node an unhandled `error`
 *    event on an EventEmitter is fatal to the process, so a single unreachable
 *    host would take the whole plugin down and every button with it.
 */

type Family = 4 | 6;

const DNS_TTL_MS = 30_000;

type CachedLookup = {
	address: string;
	family: Family;
	expires: number;
};

export class UdpSender {
	readonly #sockets = new Map<Family, Promise<dgram.Socket>>();
	readonly #dnsCache = new Map<string, CachedLookup>();
	readonly #onError: (error: Error) => void;

	/**
	 * @param onError Invoked for asynchronous socket errors that cannot be
	 * attributed to a particular send, e.g. an ICMP port-unreachable arriving
	 * long after the datagram left.
	 */
	public constructor(onError: (error: Error) => void) {
		this.#onError = onError;
	}

	/**
	 * Sends a packet, resolving once the datagram has been handed to the OS.
	 *
	 * Rejects if the host cannot be resolved or the socket refuses the send.
	 * UDP is fire-and-forget, so a resolved promise means the packet was sent,
	 * not that anything received it.
	 */
	public async send(packet: Buffer, host: string, port: number): Promise<void> {
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`Port ${port} is not a valid port number (1–65535).`);
		}

		const { address, family } = await this.#resolve(host);
		const socket = await this.#socket(family);

		await new Promise<void>((resolve, reject) => {
			socket.send(packet, port, address, (error) => (error ? reject(error) : resolve()));
		});
	}

	/** Closes every open socket. */
	public async close(): Promise<void> {
		const sockets = [...this.#sockets.values()];
		this.#sockets.clear();

		await Promise.all(
			sockets.map(async (pending) => {
				try {
					const socket = await pending;
					await new Promise<void>((resolve) => socket.close(resolve));
				} catch {
					// A socket that never opened needs no closing.
				}
			}),
		);
	}

	/**
	 * Resolves a host to an address and address family.
	 *
	 * IP literals skip DNS entirely. Hostnames are looked up and cached briefly,
	 * so that a button pressed repeatedly does not perform a lookup per press —
	 * and, more importantly, so a slow or dead resolver cannot stall the key
	 * handler on every single press.
	 */
	async #resolve(host: string): Promise<{ address: string; family: Family }> {
		const literal = net.isIP(host);
		if (literal === 4 || literal === 6) {
			return { address: host, family: literal };
		}

		const cached = this.#dnsCache.get(host);
		if (cached && cached.expires > Date.now()) {
			return { address: cached.address, family: cached.family };
		}

		const result = await dns.lookup(host);
		const family: Family = result.family === 6 ? 6 : 4;

		this.#dnsCache.set(host, { address: result.address, family, expires: Date.now() + DNS_TTL_MS });
		return { address: result.address, family };
	}

	/** Lazily opens, binds and caches one socket per address family. */
	#socket(family: Family): Promise<dgram.Socket> {
		const existing = this.#sockets.get(family);
		if (existing) {
			return existing;
		}

		const pending = new Promise<dgram.Socket>((resolve, reject) => {
			const socket = dgram.createSocket({ type: family === 6 ? "udp6" : "udp4", reuseAddr: true });

			const onBindError = (error: Error): void => {
				this.#sockets.delete(family);
				reject(error);
			};

			socket.once("error", onBindError);

			socket.bind(() => {
				socket.off("error", onBindError);

				// Now that the socket is bound, errors are no longer fatal to
				// setup but would still be fatal to the process if unhandled.
				socket.on("error", (error) => this.#onError(error));

				try {
					// Allows sending to a broadcast address such as
					// 192.168.1.255; harmless for ordinary unicast traffic.
					socket.setBroadcast(true);
				} catch {
					// Not permitted on some systems. Unicast still works.
				}

				socket.unref();
				resolve(socket);
			});
		});

		this.#sockets.set(family, pending);
		return pending;
	}
}
