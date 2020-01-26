using BarRaider.SdTools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Threading.Tasks;
using SharpOSC;

namespace StreamDeck_OSC
{
    [PluginActionId("de.shells.osc.pluginaction")]
    public class PluginAction : PluginBase
    {
        private class PluginSettings
        {
            public static PluginSettings CreateDefaultSettings()
            {
                PluginSettings instance = new PluginSettings
                {
                    Name = String.Empty,
                    StringValue = String.Empty,
                    IntValue = 0,
                    FloatValue = 0.500f,
                    Port = 7001,
                    Ip = String.Empty,
                    SendString = "False",
                    SendInt = "False",
                    SendFloat = "False"
                };
                return instance;
            }

            [FilenameProperty]
            [JsonProperty(PropertyName = "Name")]
            public string Name { get; set; }

            [JsonProperty(PropertyName = "StringValue")]
            public string StringValue { get; set; }

            [JsonProperty(PropertyName = "IntValue")]
            public int IntValue { get; set; }

            [JsonProperty(PropertyName = "FloatValue")]
            public float FloatValue { get; set; }

            [JsonProperty(PropertyName = "Ip")]
            public string Ip { get; set; }

            [JsonProperty(PropertyName = "Port")]
            public int Port { get; set; }

            [JsonProperty(PropertyName = "SendInt")]
            public string SendInt { get; set; }

            [JsonProperty(PropertyName = "SendFloat")]
            public string SendFloat { get; set; }

            [JsonProperty(PropertyName = "SendString")]
            public string SendString { get; set; }
        }

        #region Private Members

        private PluginSettings settings;

        #endregion
        public PluginAction(SDConnection connection, InitialPayload payload) : base(connection, payload)
        {
            if (payload.Settings == null || payload.Settings.Count == 0)
            {
                this.settings = PluginSettings.CreateDefaultSettings();
            }
            else
            {
                this.settings = payload.Settings.ToObject<PluginSettings>();
            }
        }

        public override void Dispose()
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, $"Destructor called");
        }

        public override void KeyPressed(KeyPayload payload)
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, "Key Pressed");
            Logger.Instance.LogMessage(TracingLevel.INFO, "Sending OSC: Name/String: " + this.settings.Name + " | Value/String: " + this.settings.StringValue + " | Send String?: " + this.settings.SendString + " | Value/Int: " + this.settings.IntValue + " | Send Int?: " + this.settings.SendInt + " | Value/Float: " + this.settings.FloatValue + " | Send Float?: " + this.settings.SendFloat + " | to IP: " + this.settings.Ip + " | to Port: " + this.settings.Port);
            this.SendOscCommand(this.settings.Name, this.settings.StringValue, this.settings.IntValue, this.settings.FloatValue, this.settings.Ip, this.settings.Port, this.settings.SendString, this.settings.SendInt, this.settings.SendFloat);
        }

        public override void KeyReleased(KeyPayload payload) { }

        public override void OnTick() { }

        public override void ReceivedSettings(ReceivedSettingsPayload payload)
        {
            Tools.AutoPopulateSettings(settings, payload.Settings);
            SaveSettings();
        }

        public override void ReceivedGlobalSettings(ReceivedGlobalSettingsPayload payload) { }

        #region Private Methods

        private Task SaveSettings()
        {
            return Connection.SetSettingsAsync(JObject.FromObject(settings));
        }

        public void SendOscCommand(string name, string stringValue, int intValue, float floatValue, string ip, int port, string sendString, string sendInt, string sendFloat)
        {
            var message = new OscMessage(name);
            if (sendString == "True" && sendInt == "False" && sendFloat == "False")
            {
                message = new OscMessage(name, stringValue);
            }
            else if (sendString == "True" && sendInt == "True" && sendFloat == "False")
            {
                message = new OscMessage(name, stringValue, intValue);
            }
            else if (sendString == "True" && sendInt == "True" && sendFloat == "True")
            {
                message = new OscMessage(name, stringValue, intValue, floatValue);
            }
            else if (sendString == "False" && sendInt == "True" && sendFloat == "False")
            {
                message = new OscMessage(name, intValue, floatValue);
            }
            else if (sendString == "False" && sendInt == "False" && sendFloat == "True")
            {
                message = new OscMessage(name, floatValue);
            }
            else if (sendString == "False" && sendInt == "False" && sendFloat == "False")
            {
                message = new OscMessage(name);
            }
            else if (sendString == "True" && sendInt == "False" && sendFloat == "True")
            {
                message = new OscMessage(name, stringValue, floatValue);
            }
            else if (sendString == "False" && sendInt == "True" && sendFloat == "True")
            {
                message = new OscMessage(name, intValue, floatValue);
            }
            var sender = new UDPSender(ip, port);
            sender.Send(message);
        }
        #endregion
    }
}