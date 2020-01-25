using BarRaider.SdTools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
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
                    IntValue = 0,
                    FloatValue = 0.500f,
                    Port = 7001,
                    Ip = String.Empty,
                    SendInt = "False",
                    SendFloat = "False"
                };
                return instance;
            }

            [FilenameProperty]
            [JsonProperty(PropertyName = "Name")]
            public string Name { get; set; }

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
            Logger.Instance.LogMessage(TracingLevel.INFO, "Sending OSC: Name/String: " + this.settings.Name + " | Value/Int: " + this.settings.IntValue + " | Send Int?: " + this.settings.SendInt + " | Value/Float: " + this.settings.FloatValue + " | Send Float?: " + this.settings.SendFloat + " | to IP: " + this.settings.Ip + " | to Port: " + this.settings.Port);
            if (this.settings.SendInt == "True" && this.settings.SendFloat == "True")
            {
                this.SendOscCommandIntFloat(this.settings.Name, this.settings.IntValue, this.settings.FloatValue, this.settings.Ip, this.settings.Port);
            }
            else if (this.settings.SendInt == "True" && this.settings.SendFloat == "False")
            {
                this.SendOscCommandInt(this.settings.Name, this.settings.IntValue, this.settings.Ip, this.settings.Port);
            }
            else if (this.settings.SendInt == "False" && this.settings.SendFloat == "True")
            {
                this.SendOscCommandFloat(this.settings.Name, this.settings.FloatValue, this.settings.Ip, this.settings.Port);
            }
            else if (this.settings.SendInt == "False" && this.settings.SendFloat == "False")
            {
                this.SendOscCommandOnly(this.settings.Name, this.settings.Ip, this.settings.Port);
            }
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

        #endregion
        public void SendOscCommandIntFloat(string name, int intValue, float floatValue, string ip, int port)
        {
            var message = new OscMessage(name, intValue, floatValue);
            var sender = new UDPSender(ip, port);
            sender.Send(message);
        }
        public void SendOscCommandInt(string name, int intValue, string ip, int port)
        {
            var message = new OscMessage(name, intValue);
            var sender = new UDPSender(ip, port);
            sender.Send(message);
        }
        public void SendOscCommandFloat(string name, float floatValue, string ip, int port)
        {
            var message = new OscMessage(name, floatValue);
            var sender = new UDPSender(ip, port);
            sender.Send(message);
        }
        public void SendOscCommandOnly(string name, string ip, int port)
        {
            var message = new OscMessage(name);
            var sender = new UDPSender(ip, port);
            sender.Send(message);
        }
    }
}