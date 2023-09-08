using BarRaider.SdTools;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SharpOSC;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

namespace StreamDeck_OSC
{
    [PluginActionId("de.shells.osc.pluginaction")]
    public class PluginAction : PluginBase
    {
        private class PluginSettings
        {
            public static PluginSettings CreateDefaultSettings()
            {
                try
                {
                    var config = new ConfigurationBuilder()
                        .SetBasePath(Directory.GetCurrentDirectory())
                        .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
                        .Build();
                    Logger.Instance.LogMessage(TracingLevel.INFO, $"Current Directory: {Directory.GetCurrentDirectory()}");


                    var defaultSettings = config.GetSection("DefaultSettings").Get<PluginSettings>();

                    Logger.Instance.LogMessage(TracingLevel.INFO, $"Current Directory: {Directory.GetCurrentDirectory()}");
                    Logger.Instance.LogMessage(TracingLevel.INFO, $"Loaded IP from appsettings: {defaultSettings?.IP}");
                    Logger.Instance.LogMessage(TracingLevel.INFO, $"Loaded Port from appsettings: {defaultSettings?.Port}");

                    return new PluginSettings
                    {
                        Name = defaultSettings?.Name ?? "/",
                        StringValue = defaultSettings?.StringValue ?? string.Empty,
                        IntValue = defaultSettings?.IntValue ?? 0,
                        FloatValue = defaultSettings?.FloatValue ?? 0.500f,
                        IP = defaultSettings?.IP ?? "127.0.0.1",
                        Port = defaultSettings?.Port ?? 7001
                    };
                }
                catch (Exception ex)
                {
                    Logger.Instance.LogMessage(TracingLevel.ERROR, $"Exception in CreateDefaultSettings: {ex}");

                    return new PluginSettings
                    {
                        Name = "/",
                        StringValue = string.Empty,
                        IntValue = 0,
                        FloatValue = 0.500f,
                        IP = "127.0.0.1",
                        Port = 7001
                    };
                }
            }



            [FilenameProperty]
            [JsonProperty(PropertyName = "Name")]
            public string Name { get; set; }

            [JsonProperty(PropertyName = "StringValue")]
            public string StringValue { get; set; }

            [JsonProperty(PropertyName = "IntValue")]
            public int? IntValue { get; set; }

            [JsonProperty(PropertyName = "FloatValue")]
            public float? FloatValue { get; set; }

            [JsonProperty(PropertyName = "IP")]
            public string IP { get; set; }

            [JsonProperty(PropertyName = "Port")]
            public int Port { get; set; }

            [JsonProperty(PropertyName = "SendInt")]
            public bool SendInt { get; set; }

            [JsonProperty(PropertyName = "SendFloat")]
            public bool SendFloat { get; set; }

            [JsonProperty(PropertyName = "SendString")]
            public bool SendString { get; set; }
        }

        #region Private Members

        private readonly PluginSettings settings;

        #endregion

        public PluginAction(ISDConnection connection, InitialPayload payload) : base(connection, payload)
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, "PluginAction Constructor called");

            if (payload.Settings == null || !payload.Settings.HasValues)
            {
                Logger.Instance.LogMessage(TracingLevel.INFO, "No settings found in payload. Loading default settings.");
                this.settings = PluginSettings.CreateDefaultSettings();
            }
            else
            {
                this.settings = payload.Settings.ToObject<PluginSettings>();
            }
            Logger.Instance.LogMessage(TracingLevel.INFO, $"Sending settings to frontend: {JsonConvert.SerializeObject(settings)}");
            SaveSettings();
            var settingsJson = JsonConvert.SerializeObject(settings);
            var settingsJObject = JObject.Parse(settingsJson);
            Connection.SendToPropertyInspectorAsync(settingsJObject);

            Connection.OnApplicationDidLaunch += Connection_OnApplicationDidLaunch;
            Connection.OnApplicationDidTerminate += Connection_OnApplicationDidTerminate;
            Connection.OnDeviceDidConnect += Connection_OnDeviceDidConnect;
            Connection.OnDeviceDidDisconnect += Connection_OnDeviceDidDisconnect;
            Connection.OnPropertyInspectorDidAppear += Connection_OnPropertyInspectorDidAppear;
            Connection.OnPropertyInspectorDidDisappear += Connection_OnPropertyInspectorDidDisappear;
            Connection.OnSendToPlugin += Connection_OnSendToPlugin;
            Connection.OnTitleParametersDidChange += Connection_OnTitleParametersDidChange;


            Logger.Instance.LogMessage(TracingLevel.INFO, $"Constructor loaded settings: IP {settings.IP}, Port {settings.Port}");
        }
        private void Connection_OnTitleParametersDidChange(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.TitleParametersDidChange> e)
        {
        }

        private void Connection_OnSendToPlugin(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.SendToPlugin> e)
        {
        }

        private void Connection_OnPropertyInspectorDidDisappear(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.PropertyInspectorDidDisappear> e)
        {
        }

        private void Connection_OnPropertyInspectorDidAppear(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.PropertyInspectorDidAppear> e)
        {
        }

        private void Connection_OnDeviceDidDisconnect(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.DeviceDidDisconnect> e)
        {
        }

        private void Connection_OnDeviceDidConnect(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.DeviceDidConnect> e)
        {
        }

        private void Connection_OnApplicationDidTerminate(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.ApplicationDidTerminate> e)
        {
        }

        private void Connection_OnApplicationDidLaunch(object sender, BarRaider.SdTools.Wrappers.SDEventReceivedEventArgs<BarRaider.SdTools.Events.ApplicationDidLaunch> e)
        {
        }


        public override void Dispose()
        {
            Connection.OnApplicationDidLaunch -= Connection_OnApplicationDidLaunch;
            Connection.OnApplicationDidTerminate -= Connection_OnApplicationDidTerminate;
            Connection.OnDeviceDidConnect -= Connection_OnDeviceDidConnect;
            Connection.OnDeviceDidDisconnect -= Connection_OnDeviceDidDisconnect;
            Connection.OnPropertyInspectorDidAppear -= Connection_OnPropertyInspectorDidAppear;
            Connection.OnPropertyInspectorDidDisappear -= Connection_OnPropertyInspectorDidDisappear;
            Connection.OnSendToPlugin -= Connection_OnSendToPlugin;
            Connection.OnTitleParametersDidChange -= Connection_OnTitleParametersDidChange;
            Logger.Instance.LogMessage(TracingLevel.INFO, $"Destructor called");
        }

        public override void KeyPressed(KeyPayload payload)
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, $"Sending OSC to IP: {this.settings.IP}, Port: {this.settings.Port}");
            SendOscCommand();
        }

        public override void KeyReleased(KeyPayload payload) { }

        public override void OnTick() { }

        public override void ReceivedSettings(ReceivedSettingsPayload payload)
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, $"Received settings");
            Tools.AutoPopulateSettings(settings, payload.Settings);
            SaveSettings();
        }

        public override void ReceivedGlobalSettings(ReceivedGlobalSettingsPayload payload) { }

        #region Private Methods

        private Task SaveSettings()
        {
            Logger.Instance.LogMessage(TracingLevel.INFO, $"SaveSettings {settings}");
            return Connection.SetSettingsAsync(JObject.FromObject(settings));
        }

        private void SendOscCommand()
        {
            var args = BuildOscArguments();
            var message = new OscMessage(this.settings.Name, args.ToArray());
            var sender = new UDPSender(this.settings.IP, this.settings.Port);
            try
            {
                sender.Send(message);
            }
            catch (Exception ex)
            {
                Logger.Instance.LogMessage(TracingLevel.ERROR, $"Error sending OSC command: {ex}");
            }
        }

        private List<object> BuildOscArguments()
        {
            var args = new List<object>();
            if (this.settings.SendString)
            {
                args.Add(settings.StringValue);
            }
            if (this.settings.SendInt)
            {
                args.Add(settings.IntValue);
            }
            if (this.settings.SendFloat)
            {
                args.Add(settings.FloatValue);
            }
            return args;
        }

        #endregion
    }
}
