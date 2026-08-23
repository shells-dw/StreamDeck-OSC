/**
 * OSC address pattern matching.
 *
 * Implements the dispatch rules from the OpenSoundControl 1.0 specification,
 * "OSC Message Dispatching and Pattern Matching":
 *
 *   1. '?' matches any single character.
 *   2. '*' matches any sequence of zero or more characters.
 *   3. '[abc]' matches any character in the list; '-' denotes a range, and a
 *      leading '!' negates the list.
 *   4. '{foo,bar}' matches any of the comma-separated strings.
 *   5. Any other character matches only itself.
 *
 * A pattern matches an address when both have the same number of parts and
 * every part matches. Parts are the substrings between forward slashes, so a
 * wildcard never matches across a '/'.
 *
 * This is normally a receiver-side concern. It is here because the plugin now
 * listens: an incoming message may carry a pattern, and a button may watch one.
 */

/** Splits an address or pattern into its parts, discarding the leading slash. */
function parts(value: string): string[] {
	return value.replace(/^\//, "").split("/");
}

/**
 * The longest address this will attempt to match.
 *
 * Addresses arrive from the network, so there has to be some ceiling. Real OSC
 * addresses are tens of characters; this is far above anything legitimate.
 */
const MAX_LENGTH = 512;

/**
 * Matches a single part, walking pattern and text together.
 *
 * '*' recurses rather than backtracking in place, which keeps the logic honest
 * about the "zero or more" case.
 *
 * `failed` records the (pattern, text) offsets already known not to match. A
 * pattern such as `*a*a*a*a*a*b` would otherwise explore the same states over
 * and over, taking exponential time — a message from the network could then
 * stall the plugin indefinitely. Remembering failures makes the work
 * proportional to pattern length times text length instead.
 */
function matchPart(pattern: string, text: string, p = 0, t = 0, failed = new Set<number>()): boolean {
	const state = p * (text.length + 1) + t;
	if (failed.has(state)) {
		return false;
	}
	const fail = (): false => {
		failed.add(state);
		return false;
	};
	while (p < pattern.length) {
		const character = pattern[p];

		if (character === "*") {
			// Collapse runs of '*', then try every possible split point.
			while (pattern[p] === "*") {
				p++;
			}
			if (p === pattern.length) {
				return true;
			}
			for (let skip = t; skip <= text.length; skip++) {
				if (matchPart(pattern, text, p, skip, failed)) {
					return true;
				}
			}
			return fail();
		}

		if (t >= text.length) {
			return fail();
		}

		if (character === "?") {
			p++;
			t++;
			continue;
		}

		if (character === "[") {
			const close = pattern.indexOf("]", p + 1);
			if (close === -1) {
				// Unterminated bracket: treat it as a literal, per rule 5.
				if (text[t] !== "[") {
					return fail();
				}
				p++;
				t++;
				continue;
			}

			let set = pattern.substring(p + 1, close);
			const negated = set.startsWith("!");
			if (negated) {
				set = set.substring(1);
			}

			if (!inSet(set, text[t]!) !== negated) {
				return fail();
			}

			p = close + 1;
			t++;
			continue;
		}

		if (character === "{") {
			const close = pattern.indexOf("}", p + 1);
			if (close !== -1) {
				const alternatives = pattern.substring(p + 1, close).split(",");
				for (const alternative of alternatives) {
					if (
						text.startsWith(alternative, t) &&
						matchPart(pattern, text, close + 1, t + alternative.length, failed)
					) {
						return true;
					}
				}
				return fail();
			}
		}

		if (character !== text[t]) {
			return fail();
		}

		p++;
		t++;
	}

	return t === text.length ? true : fail();
}

/** Tests a character against a bracket expression's contents, honouring ranges. */
function inSet(set: string, character: string): boolean {
	for (let i = 0; i < set.length; i++) {
		// A '-' at either end of the list has no special meaning.
		if (set[i + 1] === "-" && i + 2 < set.length) {
			const from = set[i]!;
			const to = set[i + 2]!;
			if (character >= from && character <= to) {
				return true;
			}
			i += 2;
			continue;
		}
		if (set[i] === character) {
			return true;
		}
	}
	return false;
}

/** One-directional match: `pattern` is the pattern, `address` is literal. */
function dispatches(pattern: string, address: string): boolean {
	const patternParts = parts(pattern);
	const addressParts = parts(address);

	if (patternParts.length !== addressParts.length) {
		return false;
	}

	return patternParts.every((part, index) => matchPart(part, addressParts[index]!));
}

/**
 * Returns true when the two addresses should be considered a match.
 *
 * Strictly, the spec puts the pattern on the incoming message and expects the
 * receiver's own addresses to be literal. That is honoured, but the reverse is
 * also tried, because a button watching `/ch/*​/level` is an obviously useful
 * thing to want and there is no ambiguity in allowing it: a literal address
 * contains no wildcard characters, so the second attempt can only succeed when
 * the caller actually wrote a pattern.
 */
export function matchesAddress(a: string, b: string): boolean {
	if (a.length > MAX_LENGTH || b.length > MAX_LENGTH) {
		return false;
	}
	return dispatches(a, b) || dispatches(b, a);
}
