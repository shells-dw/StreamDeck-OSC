import streamDeck from "@elgato/streamdeck";

import { SendOscCommand } from "./actions/send-osc.js";
import { watchDefaults } from "./global-defaults.js";

streamDeck.logger.setLevel("info");

watchDefaults();
streamDeck.actions.registerAction(new SendOscCommand());

await streamDeck.connect();
