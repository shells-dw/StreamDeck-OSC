 ![GitHub](https://img.shields.io/github/license/shells-dw/StreamDeck-OSC)     ![GitHub last commit](https://img.shields.io/github/last-commit/shells-dw/StreamDeck-OSC)     [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/dwshells) [!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/dwshells)

# Send OSC Commands with your Stream Deck

![Overview](/docs/O.png)

## What Is This (and what does it do?)

It's a plugin for the [Elgato Stream Deck][Stream Deck] that sends [OpenSoundControl][] messages — and, since 3.1, displays values coming back the other way.

Version 3 is a complete rewrite in TypeScript on Elgato's Node.js SDK, which means it now **runs on macOS as well as Windows**.

## What Is It Not (and what can't it do?)

Version 2 wasn't a full OSC implementation — you got one string, one integer and one float, always in that order. That limitation is gone: you can now send any number of arguments, of any type in the specification, in any order you like.

What it still can't do:

- **UDP only.** OSC over TCP needs a framing scheme that implementations disagree about, and it's probably not widely used, so I didn't bother.
- **Bundle time tags are read but not acted on.** Incoming messages are shown when they arrive rather than scheduled for later.
- **It can't make your device talk to you.** More on that below.

Every device and application uses OSC a bit differently. The plugin now speaks the whole protocol, but you still need your device's documentation to know what to send it.

## Release / Installation

Inside the Release folder you'll find the precompiled plugin. Download and open it; your computer should recognise it as a Stream Deck file and offer to install it.

**You'll need Stream Deck 6.9 or newer.** Nothing else to install — Stream Deck brings its own Node.js runtime, so the .NET Framework requirement from version 2 is gone.

## Usage

### General

Enter the IP and port of your OSC device if they differ from the defaults (to change those, see the appsettings.json section below), then the address you want to send to — something like `/hardwareInput/1/volume`, depending on your system.

Then add as many arguments as the message needs. Drag the handle to reorder them. The type tag string is shown above the list as you build it, so `,ifs` means an integer, then a float, then a string — handy for checking against your device's documentation.

Hit **Send test** to fire the message without leaving the settings panel.

### Argument types

These four are required by OSC 1.0, so every conforming device understands them:

| Type | Notes |
| --- | --- |
| Integer (int32) | -2147483648 to 2147483647 |
| Float (float32) | Single precision — `0.1` travels as `0.100000001` |
| String | |
| Blob | Arbitrary bytes, entered as hex |

These are optional in the specification, meaning a device is allowed to ignore any message that uses one. They're here because plenty of gear needs them:

| Type | Notes |
| --- | --- |
| Integer (int64), Float (float64) | Wider versions of the above |
| True, False, Nil, Infinitum | Carry no value at all — a lot of devices want `/mute` + True rather than `/mute` + `1` |
| Symbol | A string, tagged differently |
| Character | One ASCII character, sent as 32 bits |
| Colour (RGBA) | `#RRGGBBAA` |
| MIDI message | Four hex bytes: port, status, data1, data2 |
| Time tag | `now`, or a raw 64-bit NTP value |
| Array start / end | Brackets around a group of arguments |

If a message seems to do nothing, try expressing it with the four required types first. That rules out the device simply not implementing the type you picked.

### Stream Deck + dials

Drop the action onto a dial and rotating it sends a value. Set which argument the dial drives, the range it moves through, and how much one tick is worth. Pressing the dial either jumps to a value you nominate — good for "back to unity" — or just sends the message as configured, if you leave that box empty.

Rotation is deliberately coalesced. A dial produces ticks much faster than any receiver wants datagrams, so the display follows your hand exactly while the message goes out at most every 40 ms.

If you don't nominate an argument, the first numeric one is used, so a key you already set up works on a dial without configuring it twice.

### Showing values your device sends back

Switch on **Listen**, give it a port, and the value appears on the key and on the Stream Deck + display as it arrives.

Two things are worth understanding before you rely on this:

**OSC has no request and response.** Nothing comes back because you sent something. Your device has to be configured to transmit to your computer's IP address, on the port you set here. The first time the plugin binds a port, your firewall will most likely ask permission.

**Some gear stays silent until it's asked to report.** A Behringer X32, for instance, sends nothing until it receives `/xremote`, and goes quiet again after about ten seconds — that's what the keep-alive option is for. Unity, Unreal and TouchOSC need none of that; they transmit as soon as you configure them to, so leave the keep-alive switched off.

Buttons watching the same port share one socket, so you can point a whole page at a single listening port. The watched address takes the usual OSC wildcards, so `/ch/*/level` follows every channel at once.

## Default values for new buttons

Open any button's settings and scroll to **Defaults for new buttons**. Set the IP, port and address you want new buttons to start with. Existing buttons on the deck will **not** change their settings (whether that's good or bad is up to you, but that's how it is ;) ).

These are stored by Stream Deck itself rather than in a file inside the plugin, which means they now **survive plugin updates**. Version 3.1 and earlier kept them in an `appsettings.json` beside the plugin, and since Stream Deck replaces the plugin folder when it updates, your edits were wiped every single time.

If you're coming from an older version, the plugin reads your `appsettings.json` once on first run and imports whatever it finds, then ignores the file from then on. Be aware that the update itself replaces the plugin folder, so in most cases the file is already back to stock by the time the new version starts — expect to set your defaults once more, and then never again.

## Upgrading from version 2

Your existing buttons keep working. The plugin and action identifiers haven't changed, the stored setting names haven't changed, and a button you never open sends **byte-for-byte identical** messages to what version 2 sent. There's a test for exactly that.

Your old string/int/float configuration turns up in the new argument list automatically, in the order it was sent before. Nothing gets rewritten until you edit the arguments yourself, so a button you leave alone can still be read by version 2 if you ever need to go back.

What does change:

1. **Stream Deck 6.9 or newer is required.** Older versions will report the plugin as unsupported.
2. **Addresses missing a leading slash are repaired.** Version 2 let you save `test`; that isn't a valid OSC address and no conforming receiver can dispatch it. It now goes out as `/test`, noted in the log once per button.
3. **Logs moved** to the `logs` folder inside `de.shells.osc.sdPlugin` — no more `pluginlog.log`.
4. **A malformed argument stops the message** rather than sending a partial one, and the key shows an alert. The reason is in the log and in the property inspector.

### Things that were broken and now aren't

- A float argument of `0` can be saved. Version 2's property inspector tested the value for truthiness, so `0`, `0.0` and `-0` were all rejected as "not a float"
- Validation errors are no longer written into the input field, which destroyed what you'd typed and could then be read back as though it were a value.
- An unreachable or misspelled host no longer crashes the plugin. Version 2 built the sender outside its `try` block, so one bad address took down every button, not just the one you pressed.
- Each key press no longer leaks a UDP socket.
- Ticking a "send" box with an empty field no longer produces a message that fails to serialise.

# I have an issue or miss a feature?

You can submit an issue or request a feature with [GitHub issues]. Please describe as well as possible what went wrong, and include the log — it's incredibly helpful for figuring out what happened. Logs now live in the `logs` folder inside the plugin directory:

```
%APPDATA%\Elgato\StreamDeck\Plugins\de.shells.osc.sdPlugin\logs
~/Library/Application Support/com.elgato.StreamDeck/Plugins/de.shells.osc.sdPlugin/logs
```

If you happen to have OSC documentation for a specific device, let me know and I'll see what I can do.

# Disclaimer

I'm in no way affiliated with Elgato. I wrote this plugin out of personal interest.

# Support

If you'd like to drop me a coffee for the hours I've spent on this: [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/dwshells) [!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/dwshells)

<!-- Reference Links -->

[Stream Deck]: https://www.elgato.com/us/en/p/stream-deck "Elgato's Stream Deck product page"
[OpenSoundControl]: https://opensoundcontrol.stanford.edu/ "OSC homepage"
[spec-examples]: https://opensoundcontrol.stanford.edu/spec-1_0-examples.html "OSC 1.0 specification examples"
[GitHub issues]: https://github.com/shells-dw/streamdeck-osc/issues "GitHub issues link"

# Changelog

## [3.2.0] - 2026-08-23
### Improved/Changed
- Default values for new buttons are now stored in Stream Deck's global settings and edited from the property inspector, instead of an `appsettings.json` file inside the plugin. They survive plugin updates now, which the file never did. An existing `appsettings.json` is imported once on first run.
- Manifest moved to `SDKVersion` 3 with a minimum Stream Deck version of 6.9, which is what Marketplace DRM requires. This does raise the minimum Stream Deck version — 3.1.0 remains available for anyone on an older build.

## [3.1.0]
### Added
- Stream Deck + dial support — rotation sends a value over a configurable range, coalesced so a flick doesn't flood the network.
- Dial press can jump to a nominated value, or send the message as configured.
- Optional listener: values arriving from your device are shown on the key and on the Stream Deck + display.
- Optional keep-alive, for gear that only reports once it's been subscribed to.
- Full OSC decoder including bundles, tested against the same specification fixtures as the encoder.
- Address pattern matching (`?`, `*`, `[]`, `{}`) for watched addresses.
### Security
- The pattern matcher now remembers failed states. Addresses arrive from the network, and a crafted pattern like `/*a*a*a*a*b` previously took exponential time — long enough to stall the plugin.
- Bundle nesting is capped. A deeply nested packet could otherwise exhaust the call stack, raising an error that bypassed the plugin's error handling entirely.

## [3.0.0]
### General
- Complete rewrite in TypeScript on Elgato's Node.js SDK.
- macOS support; the .NET Framework requirement is gone.
### Added
- Free-form argument list: any number of arguments, any supported type, any order, reorderable by dragging.
- All OSC 1.0 types, including the no-value types (True, False, Nil, Infinitum) and array brackets.
- Send test button in the property inspector.
- Live type tag string display.
- New icon set, generated from SVG. The old one had full-colour artwork in the two slots Elgato requires to be monochrome, which is why it looked like a smudge in the actions list.
### Fixed
- Float arguments of `0` can be saved.
- Validation messages no longer overwrite what you typed.
- An unresolvable host or invalid port no longer crashes the plugin.
- UDP sockets are pooled instead of leaked on every key press.
- `appsettings.json` is found relative to the plugin rather than the working directory.
- Addresses without a leading slash are corrected instead of being sent malformed.

## [2.0.0] - 2023-09-08
### General
- Complete rewrite of the plugin to fix various bugs and bring it overall to a more recent state and programming style.
### Fixed
- plugin would not accept an integer or float with the value of 0
- IP and port are now preset and don't have to be manually entered for every single button (don't know what I was thinking honestly)
- Various minor fixes mainly regarding not catching possible null values etc. but since I rewrote most of the code, that's a goner now too.
### Improved/Changed
- Added local config file that allows to change the preset for new buttons (existing ones will remain as they are) of all possible values, e.g. change IP, Port, Address, values to reflect setups that divert from the plugin default.
