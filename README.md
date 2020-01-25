# Send OSC Commands with your StreamDeck

![Overview](/docs/O.png)

## What Is This (and what does it do?)

It's a plugin for the [Elgato Stream Deck][Stream Deck] that sends [OpenSoundControl][] messages.

## What Is It Not (and what can't it do?)

It's not a full OSC protocol implementation. Every device and software uses the protocol a bit differently and making all possible cases available in the program is probably impossible (leaving aside way too time consuming).

## Release / Installation

Inside the Release-folder you can find the precompiled plugin. Download and open it, your computer should already recognize this as a StreamDeck file and offer to open it with StreamDeck - which will have the plugin available in the list then.

## Usage
### General

Enter IP and Port of your OSC device, enter the String you want to send, for example "/hardwareInput/1/volume" which depends on the system you're using. As said, every device or software uses a different structure.
You can send an integer number and a float number with the string, if it's needed. You can also send both. Check the corresponding checkboxes to have the values send with the string arguments.
In OSC there are a lot more options that can be required as arguments, including strings, big ints and blobs - in varying sequence. I did not implement that.

# Limitations

- Windows 10 with .NET Framework is required to run this plugin.
- Currently limited to sending strings with optional arguments integer and float (which should cover most implementations, I guess)

# I have an issue or miss a feature?

You can submit an issue or request a feature with [GitHub issues]. Please describe as good as possible what went wrong and also include any log files as they are incredibly helpful for me to figure out what went wrong. The log can be found in %APPDATA%\Elgato\StreamDeck\Plugins\de.shells.osc.sdPlugin, and will be named pluginlog.log.
If you happen to have a OSC implementation documentation for a specific device, let me know and I can see if I can get that in the plugin.

# Disclaimer
I'm in no way affiliated with Elgato. I wrote this plugin out of personal interest.

<!-- Reference Links -->

[Stream Deck]: https://www.elgato.com/gaming/stream-deck/ "Elgato's Stream Deck product page"
[OpenSoundControl]: http://opensoundcontrol.org/introduction-osc "OSC homepage"
[GitHub issues]: https://github.com/shells-dw/streamdeck-totalmix/issues "GitHub issues link"

