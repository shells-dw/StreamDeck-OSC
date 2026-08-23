// sdtools.common.js v1.0
var websocket = null,
    uuid = null,
    registerEventName = null,
    actionInfo = {},
    inInfo = {},
    runningApps = [],
    isQT = navigator.appVersion.includes('QtWebEngine');

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inUUID;
    registerEventName = inRegisterEvent;
    console.log(inUUID, inActionInfo);
    actionInfo = JSON.parse(inActionInfo); // cache the info
    inInfo = JSON.parse(inInfo);
    websocket = new WebSocket('ws://127.0.0.1:' + inPort);

    addDynamicStyles(inInfo.colors);

    websocket.onopen = websocketOnOpen;
    websocket.onmessage = websocketOnMessage;

    // Allow others to get notified that the websocket is created
    var event = new Event('websocketCreate');
    document.dispatchEvent(event);

    console.log(actionInfo);
    loadConfiguration(actionInfo);

    IP = actionInfo.payload.settings.IP;
    Port = actionInfo.payload.settings.Port;
    Name = actionInfo.payload.settings.Name;
    StringValue = actionInfo.payload.settings.StringValue;
    IntValue = actionInfo.payload.settings.IntValue;
    FloatValue = actionInfo.payload.settings.FloatValue;
    SendInt = actionInfo.payload.settings.SendInt;
    SendFloat = actionInfo.payload.settings.SendFloat;
    SendString = actionInfo.payload.settings.SendString;
}

function websocketOnOpen() {
    var json = {
        event: registerEventName,
        uuid: uuid
    };
    websocket.send(JSON.stringify(json));

    // Notify the plugin that we are connected
    sendValueToPlugin('propertyInspectorConnected', 'property_inspector');
}

function websocketOnMessage(evt) {
    // Received message from Stream Deck
    var jsonObj = JSON.parse(evt.data);

    if (jsonObj.event === 'sendToPropertyInspector') {
        var payload = jsonObj.payload;
        loadConfiguration(payload);
    }
    else if (jsonObj.event === 'didReceiveSettings') {
        var payload = jsonObj.payload;
        loadConfiguration(payload.settings);
    }
    else {
        console.log("Unhandled websocketOnMessage: " + jsonObj.event);
    }
}

function loadConfiguration(payload) {
    console.log('loadConfiguration');
    console.log(payload);
    if (payload.payload != undefined) {
        updateUI(payload.action, payload.payload.settings);
    } else {
        updateUI(actionInfo.action, payload);
    }
}


function setSettings(value, param) {
    console.log("setSettings start:");
    console.log(actionInfo.payload.settings);
    var payload = {};
    payload[param] = value;
    console.log("setSettings payload:");
    console.log(payload);

    if (param === "IP") { IP = payload.IP; }
    if (param === "Port") { Port = payload.Port; }
    if (param === "Name") { Name = payload.Name; }
    if (param === "StringValue") { StringValue = payload.StringValue; }
    if (param === "IntValue") { IntValue = payload.IntValue; }
    if (param === "FloatValue") { FloatValue = payload.FloatValue; }
    if (param === "SendFloat") { SendFloat = payload.SendFloat; }
    if (param === "SendInt") { SendInt = payload.SendInt; }
    if (param === "SendString") { SendString = payload.SendString; }

    let intValue = document.getElementById('intValue').value;
    let floatValue = document.getElementById('floatValue').value;

    let settings = {
        IP: IP,
        Port: Port,
        Name: Name,
        StringValue: StringValue,
        IntValue: (intValue !== null && intValue !== undefined) ? parseInt(intValue) : null,
        FloatValue: (floatValue !== null && floatValue !== undefined) ? parseFloat(floatValue) : null,
        SendString: SendString,
        SendInt: SendInt,
        SendFloat: SendFloat
    };

    setSettingsToPlugin(settings);
}



function setSettingsToPlugin(payload) {
    if (websocket && (websocket.readyState === 1)) {
        const json = {
            'event': 'setSettings',
            'context': uuid,
            'payload': payload
        };
        websocket.send(JSON.stringify(json));
        var event = new Event('settingsUpdated');
        document.dispatchEvent(event);
    }
}

function sendPayloadToPlugin(payload) {
    if (websocket && (websocket.readyState === 1)) {
        const json = {
            'action': actionInfo['action'],
            'event': 'sendToPlugin',
            'context': uuid,
            'payload': payload
        };
        websocket.send(JSON.stringify(json));
    }
}

function sendValueToPlugin(value, param) {
    if (websocket && (websocket.readyState === 1)) {
        const json = {
            'action': actionInfo['action'],
            'event': 'sendToPlugin',
            'context': uuid,
            'payload': {
                [param]: value
            }
        };
        websocket.send(JSON.stringify(json));
    }
}

if (!isQT) {
    document.addEventListener('DOMContentLoaded', function () {
        initPropertyInspector();
    });
}

window.addEventListener('beforeunload', function (e) {
    e.preventDefault();

    // Notify the plugin we are about to leave
    sendValueToPlugin('propertyInspectorWillDisappear', 'property_inspector');
});

function initPropertyInspector() {
    // Place to add functions
}

function updateUI(pl, settings) {
    console.log("settings: ");
    console.log(settings);
    console.log("Setting IP to:", settings.IP);
    if (pl === "de.shells.osc.pluginaction") {
        let x = ['<div class="sdpi-item" id="required_text">',
            '<div class="sdpi-item-label">IP-Address</div>',
            '<input class="sdpi-item-value" id="IP" value="127.0.0.1" placeholder="127.0.0.1" required pattern="\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}" onchange="setSettings(event.target.value, \'IP\')">',
            '</div>',
            '<div class="sdpi-item" id="required_text">',
            '<div class="sdpi-item-label">Port</div>',
            '<input class="sdpi-item-value" id="Port" value="7001" placeholder="7001" required pattern="\\d{1,5}" onchange="setSettings(event.target.value, \'Port\')">',
            '</div>',
            '<div class="sdpi-item">',
            '    <div class="sdpi-item-label">OSC Message</div>',
            '    <input class="sdpi-item-value" id="name" value="7001" placeholder="" onchange="setSettings(event.target.value, \'Name\')">',
            '</div>',
            '<div class="sdpi-item">',
            '    <div class="sdpi-item-label">String</div>',
            '    <input class="sdpi-item-value" id="stringValue" value="7001" placeholder="" onchange="setSettings(event.target.value, \'StringValue\')">',
            '</div>',
            '<div type="checkbox" class="sdpi-item" id="single-check">',
            '    <div class="sdpi-item-label">Send String?</div>',
            '       <div class="sdpi-item-child">',
            '           <input class="sdpi-item-value" id="sendString" type="checkbox" value="on" onchange="setSettings(document.getElementById(\'sendString\').checked, \'SendString\')">',
            '               <label for="sendString" class="sdpi-item-label"><span></span></label>',
            '       </div>',
            '</div>',
            '<div class="sdpi-item">',
            '    <div class="sdpi-item-label">Integer/Decimal</div>',
            '    <input class="sdpi-item-value" id="intValue" value="" placeholder="" type="number" step="any" pattern="^[0-9]*$" onchange="checkInputInt(event.target.value)">',
            '</div>',
            '<div type="checkbox" class="sdpi-item" id="single-check">',
            '    <div class="sdpi-item-label">Send Int/Decimal?</div>',
            '       <div class="sdpi-item-child">',
            '           <input class="sdpi-item-value" id="sendInt" type="checkbox" value="on" onchange="setSettings(document.getElementById(\'sendInt\').checked, \'SendInt\')">',
            '               <label for="sendInt" class="sdpi-item-label"><span></span></label>',
            '       </div>',
            '</div>',
            '<div class="sdpi-item">',
            '    <div class="sdpi-item-label">Float</div>',
            '    <input class="sdpi-item-value" id="floatValue" value="" type="number" step="any" placeholder="0.5" onchange="checkInputFloat(event.target.value)">',
            '</div>',
            '<div type="checkbox" class="sdpi-item" id="single-check">',
            '    <div class="sdpi-item-label">Send Float?</div>',
            '       <div class="sdpi-item-child">',
            '           <input class="sdpi-item-value" id="sendFloat" type="checkbox" value="on" onchange="setSettings(document.getElementById(\'sendFloat\').checked, \'SendFloat\')">',
            '               <label for="sendFloat" class="sdpi-item-label"><span></span></label>',
            '       </div>',
            '</div>',
            '<div class="sdpi-item">',
            '    <details class="message question">',
            '        <summary>hint (click me)</summary>',
            '        <h4>Information:</h4>',
            '        <p>Enter IP and Port of your device, enter OSC Message string, for example "/test/1", Integer Value to send (if applicable) and Float Value to send (if applicable). Select the checkboxes to select if you want to send Int and Float values. This depends on how your device is specified.</p>',
            '    </details>',
            '</div>'].join('');
        document.getElementById('placeholder').innerHTML = x;

        // Set values or defaults
        function setValueOrDefault(elementId, value, defaultValue) {
            document.getElementById(elementId).value = (value !== undefined && value !== null && value !== "") ? value : defaultValue;
        }

        setValueOrDefault('IP', settings.IP, "127.0.0.1");
        setValueOrDefault('Port', settings.Port, "7001");
        setValueOrDefault('name', settings.Name, "");
        setValueOrDefault('stringValue', settings.StringValue, "");
        setValueOrDefault('intValue', settings.IntValue, "");
        setValueOrDefault('floatValue', settings.FloatValue, "0.5");

        function setCheckedOrFalse(elementId, value) {
            document.getElementById(elementId).checked = value;
        }

        setCheckedOrFalse("sendString", settings.SendString);
        setCheckedOrFalse("sendInt", settings.SendInt);
        setCheckedOrFalse("sendFloat", settings.SendFloat);
    }
}


function checkInputInt(rUInt) {
    if (rUInt !== null && rUInt !== undefined && rUInt.toString().match(/^-?\d+$/)) {
        setSettings(parseInt(rUInt), 'IntValue');
    } else {
        document.getElementById('intValue').value = "Only Integers allowed";
    }
}


function checkInputFloat(rUFloat) {
    if (Number(rUFloat)) {
        setSettings(parseFloat(rUFloat), 'FloatValue')
    } else {
        document.getElementById('floatValue').value = "Only Float numbers allowed";
    }
}

function addDynamicStyles(clrs) {
    const node = document.getElementById('#sdpi-dynamic-styles') || document.createElement('style');
    if (!clrs.mouseDownColor) clrs.mouseDownColor = fadeColor(clrs.highlightColor, -100);
    const clr = clrs.highlightColor.slice(0, 7);
    const clr1 = fadeColor(clr, 100);
    const clr2 = fadeColor(clr, 60);
    const metersActiveColor = fadeColor(clr, -60);

    node.setAttribute('id', 'sdpi-dynamic-styles');
    node.innerHTML = `

    input[type="radio"]:checked + label span,
    input[type="checkbox"]:checked + label span {
        background-color: ${clrs.highlightColor};
    }

    input[type="radio"]:active:checked + label span,
    input[type="radio"]:active + label span,
    input[type="checkbox"]:active:checked + label span,
    input[type="checkbox"]:active + label span {
      background-color: ${clrs.mouseDownColor};
    }

    input[type="radio"]:active + label span,
    input[type="checkbox"]:active + label span {
      background-color: ${clrs.buttonPressedBorderColor};
    }

    td.selected,
    td.selected:hover,
    li.selected:hover,
    li.selected {
      color: white;
      background-color: ${clrs.highlightColor};
    }

    .sdpi-file-label > label:active,
    .sdpi-file-label.file:active,
    label.sdpi-file-label:active,
    label.sdpi-file-info:active,
    input[type="file"]::-webkit-file-upload-button:active,
    button:active {
      background-color: ${clrs.buttonPressedBackgroundColor};
      color: ${clrs.buttonPressedTextColor};
      border-color: ${clrs.buttonPressedBorderColor};
    }

    ::-webkit-progress-value,
    meter::-webkit-meter-optimum-value {
        background: linear-gradient(${clr2}, ${clr1} 20%, ${clr} 45%, ${clr} 55%, ${clr2})
    }

    ::-webkit-progress-value:active,
    meter::-webkit-meter-optimum-value:active {
        background: linear-gradient(${clr}, ${clr2} 20%, ${metersActiveColor} 45%, ${metersActiveColor} 55%, ${clr})
    }
    `;
    document.body.appendChild(node);
};

/** UTILITIES */

/*
    Quick utility to lighten or darken a color (doesn't take color-drifting, etc. into account)
    Usage:
    fadeColor('#061261', 100); // will lighten the color
    fadeColor('#200867'), -100); // will darken the color
*/
function fadeColor(col, amt) {
    const min = Math.min, max = Math.max;
    const num = parseInt(col.replace(/#/g, ''), 16);
    const r = min(255, max((num >> 16) + amt, 0));
    const g = min(255, max((num & 0x0000FF) + amt, 0));
    const b = min(255, max(((num >> 8) & 0x00FF) + amt, 0));
    return '#' + (g | (b << 8) | (r << 16)).toString(16).padStart(6, 0);
}