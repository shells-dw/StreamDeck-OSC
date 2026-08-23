/**
 * Minimal JSON type definitions.
 *
 * Structurally identical to the ones the Stream Deck SDK constrains its
 * settings generics with, defined here so this project does not reach into the
 * SDK's transitive dependencies for a handful of types.
 */
export type JsonPrimitive = boolean | number | string | null | undefined;
export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
