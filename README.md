 ![GitHub](https://img.shields.io/github/license/shells-dw/StreamDeck-OSC)     ![GitHub last commit](https://img.shields.io/github/last-commit/shells-dw/StreamDeck-OSC)     [![Tip](https://img.shields.io/badge/Donate-PayPal-green.svg)]( https://www.paypal.com/donate?hosted_button_id=8KXD334CCEEC2) / [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8Y4CE9LH)

# Send OSC Commands with your StreamDeck

![Overview](/docs/O.png)

## What Is This (and what does it do?)

It's a plugin for the [Elgato Stream Deck][Stream Deck] that sends basic [OpenSoundControl][] messages.

## What Is It Not (and what can't it do?)

It's not a full OSC protocol implementation. Every device and software uses the protocol a bit differently and making all possible cases available in the program is pr way too time consuming for me.

## Release / Installation

Inside the Release-folder you can find the precompiled plugin. Download and open it, your computer should already recognize this as a StreamDeck file and offer to open it with StreamDeck - which will have the plugin available in the list then.

## Usage
### General

Enter IP and Port of your OSC device if they are different than the default values (to change the default values, see the appsettings.json section below), enter the message you want to send, for example "/hardwareInput/1/volume" which depends on the system you're using. As said, every device or software uses a different structure.
You can send string, an integer number and a float number as argument with the message, if it's needed. You can send all, some or none. Check the corresponding checkboxes to have the values send as arguments.
In OSC there are a lot more options that can be required as arguments, including multiple strings, multiple ints, big ints and blobs - in varying order. I did not implement that all.

## appsettings.json
To configure default values, edit the configuration file
%APPDATA%\Elgato\StreamDeck\Plugins\de.shells.osc.sdPlugin
```json
{
  "DefaultSettings": {
    "Name": "/",
    "StringValue": "",
    "IntValue": 0,
    "FloatValue": "0.500",
    "IP": "127.0.0.1",
    "Port": 7001,
    "SendInt": false,
    "SendFloat": false,
    "SendString": false
  }
}
```
You can change any value you want to be preset for new buttons. Existing buttons on the deck will **not** change their settings (whether this is good or bad is up to your consideration, but that's how it is ;) )
Make sure to enter the right data type, e.g. don't use integers where strings would go (or vice versa), make sure the float value has a devider and the values makes sense
If you change the file and things are not working out anymore, that's most like the spot to check.
# Limitations

- Windows 10/11 with .NET Framework is required to run this plugin.
- Currently limited to sending messages with optional arguments string, integer and float (which should cover most implementations, I guess)

# I have an issue or miss a feature?

You can submit an issue or request a feature with [GitHub issues]. Please describe as good as possible what went wrong and also include any log files as they are incredibly helpful for me to figure out what went wrong. The log can be found in %APPDATA%\Elgato\StreamDeck\Plugins\de.shells.osc.sdPlugin, and will be named pluginlog.log.
If you happen to have a OSC implementation documentation for a specific device, let me know and I can see if I can get that in the plugin.

# Disclaimer
I'm in no way affiliated with Elgato. I wrote this plugin out of personal interest.

<!-- Reference Links -->

[Stream Deck]: https://www.elgato.com/gaming/stream-deck/ "Elgato's Stream Deck product page"
[OpenSoundControl]: http://opensoundcontrol.org/introduction-osc "OSC homepage"
[GitHub issues]: https://github.com/shells-dw/streamdeck-osc/issues "GitHub issues link"

# Changelog
## [2.0.0] - 2023-09-08
### General
- Complete rewrite of the plugin to fix various bugs and bring it overall to a more recent state and programming style.
### Fixed
- - plugin would not accept an integer or float with the value of 0
- - IP and port are now preset and don't have to be manually entered for every single button (don't know what I was thinking honestly)
- - Various minor fixes mainly regarding not catching possible null values etc. but since I rewrote most of the code, that's a goner now to.
### Improved/Changed
- Added local config file that allows to change the preset for now buttons (existing ones will remain as they are) of all possible values, e.g. change IP, Port, Address, values to reflect setups that divert from the plugin default.