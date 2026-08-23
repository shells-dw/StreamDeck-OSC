import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "de.shells.osc.sdPlugin";

/**
 * Shared plugin chain.
 *
 * `sourceMap` is passed through to the TypeScript plugin so it matches the
 * Rollup output setting below. Leaving the two out of step makes the TypeScript
 * plugin emit maps that Rollup then discards, which it warns about.
 */
const plugins = (sourceMap) => [
    typescript({ tsconfig: "./tsconfig.json", exclude: ["**/*.test.ts"], sourceMap }),
    nodeResolve({ browser: false, exportConditions: ["node"] }),
    commonjs(),
];

export default [
    {
        // The plugin itself. Source maps are worth having here: Stream Deck runs
        // Node with --enable-source-maps, so a stack trace in the log points at
        // the TypeScript rather than the bundle.
        input: "src/plugin.ts",
        output: {
            file: `${sdPlugin}/bin/plugin.js`,
            format: "es",
            sourcemap: true,
            sourcemapPathTransform: (relative, sourcemap) =>
                relative.replace(sourcemap, `../../${sdPlugin}/bin/`).replaceAll("\\", "/"),
        },
        external: ["node:dgram", "node:dns/promises", "node:fs/promises", "node:net", "node:path", "node:url"],
        plugins: plugins(true),
    },
    {
        // The property inspector. No source map: it is small, readable, and the
        // map would only add weight to the packaged plugin.
        input: "src/ui/pi.ts",
        output: {
            file: `${sdPlugin}/ui/pi.js`,
            format: "iife",
            sourcemap: false,
        },
        plugins: plugins(false),
    },
];
