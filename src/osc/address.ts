import { OscError } from "./types.js";

/**
 * Validation and normalisation of OSC Address Patterns.
 *
 * The spec defines an address pattern as an OSC-string beginning with '/'. The
 * characters forbidden in the *names* of methods and containers are:
 *
 *     space  #  *  ,  /  ?  [  ]  {  }
 *
 * but of those, `* ? [ ] { }` are the pattern-matching wildcards and `/` is the
 * part separator, so all six are legal in a *pattern*. That leaves space, '#'
 * and ',' as the characters a pattern may never contain.
 */

const FORBIDDEN = new Map<string, string>([
	[" ", "a space"],
	["#", "'#'"],
	[",", "a comma"],
]);

export type AddressNormalisation = {
	address: string;
	/** Set when a leading slash had to be added; the caller should warn once. */
	warning?: string;
};

/**
 * Validates an address pattern and repairs a missing leading slash.
 *
 * The repair exists for backwards compatibility: version 2 of this plugin did
 * not check the leading slash, so settings saved by it may hold values like
 * "test". Such a message is malformed and no conforming receiver can dispatch
 * it, so rewriting it to "/test" cannot break a working setup and may fix a
 * broken one.
 */
export function normaliseAddress(raw: string): AddressNormalisation {
	const trimmed = raw.trim();

	if (trimmed === "") {
		throw new OscError("The OSC address is empty. It must begin with '/', for example /volume/1.");
	}

	for (const [character, description] of FORBIDDEN) {
		if (trimmed.includes(character)) {
			throw new OscError(`The OSC address "${trimmed}" contains ${description}, which is not allowed.`);
		}
	}

	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f]/.test(trimmed)) {
		throw new OscError("The OSC address contains a control character.");
	}

	if (!/^[\x20-\x7e]*$/.test(trimmed)) {
		throw new OscError(
			`The OSC address "${trimmed}" contains non-ASCII characters. OSC addresses must be printable ASCII.`,
		);
	}

	if (!trimmed.startsWith("/")) {
		return {
			address: `/${trimmed}`,
			warning: `The OSC address "${trimmed}" does not start with '/', which the OSC specification requires. Sending "/${trimmed}" instead.`,
		};
	}

	return { address: trimmed };
}
