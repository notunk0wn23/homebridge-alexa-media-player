'use strict';

const AlexaRemote = require('alexa-remote2');

let Service, Characteristic, UUIDGen;

module.exports = (homebridge) => {
  // Save hap variables for later use
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // Register the dynamic platform plugin
  homebridge.registerPlatform('homebridge-alexa-speaker', 'AlexaPlatform', AlexaPlatform, true);
};

class AlexaPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = []; // cached accessories

    // Create an instance of alexa-remote2 using the provided cookie (or proxy)
    this.alexa = new AlexaRemote();
    this.log('Initializing Alexa connection...');
    this.alexa.init({
      cookie: this.config.cookie || undefined, // if using cookie login
      proxyOnly: this.config.proxyOnly || false, // if using the proxy method
      // you can add additional alexa-remote2 options here if needed
    }, () => {
      this.log('Connected to Alexa!');
      this.discoverDevices();
    });

    // When Homebridge has finished launching, load cached accessories if any
    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.log('Did finish launching.');
        // Optionally, you could re-run discovery here if needed.
      });
    }
  }

  // Called when cached accessories are restored from disk
  configureAccessory(accessory) {
    this.log('Configuring cached accessory:', accessory.displayName);
    this.accessories.push(accessory);
  }

  // Discover Alexa devices that support audio
  discoverDevices() {
    this.log('Discovering Alexa devices...');
    this.alexa.getDevices((err, devices) => {
      if (err) {
        this.log('Error retrieving devices:', err);
        return;
      }
      for (const key in devices) {
        const device = devices[key];
        // Only add devices that have audio playback capabilities (e.g. AUDIO_PLAYER)
        if (device.capabilities && device.capabilities.indexOf('AUDIO_PLAYER') >= 0) {
          this.log('Found Alexa Speaker:', device.name);
          const uuid = UUIDGen.generate(device.id);
          let existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
          if (existingAccessory) {
            // Update accessory context if needed.
            existingAccessory.context.device = device;
            existingAccessory.context.deviceId = device.id;
          } else {
            // Create a new accessory and register it.
            const accessory = new this.api.platformAccessory(device.name, uuid);
            accessory.context.device = device;
            accessory.context.deviceId = device.id;
            // Allow user to set a provider in the platform config. (Default to 'default')
            accessory.context.provider = this.config.provider || 'default';
            accessory.context.cookie = this.config.cookie; // pass cookie if needed by the accessory

            // Create an instance of our AlexaSpeaker accessory
            new AlexaSpeaker(this.log, accessory, this.alexa);
            this.api.registerPlatformAccessories('homebridge-alexa-speaker', 'AlexaPlatform', [accessory]);
            this.accessories.push(accessory);
          }
        }
      }
    });
  }
}

class AlexaSpeaker {
  constructor(log, accessory, alexa) {
    this.log = log;
    this.accessory = accessory;
    this.alexa = alexa;
    this.device = accessory.context.device;
    this.deviceId = accessory.context.deviceId;
    this.provider = accessory.context.provider; // e.g., 'apple_music' or another provider

    // Create (or get) the SmartSpeaker service.
    // (SmartSpeaker is used here to mimic a full speaker with media and volume control.)
    this.speakerService = accessory.getService(Service.SmartSpeaker) ||
      accessory.addService(Service.SmartSpeaker, accessory.displayName);

    // --- Active characteristic: use this to start (play) or stop playback.
    // When Apple Music (or Siri) triggers playback on this speaker, this setter is called.
    this.speakerService.getCharacteristic(Characteristic.Active)
      .on('set', this.setActive.bind(this));

    // --- Volume control: we use the Brightness characteristic on a Lightbulb service to simulate volume.
    // (HomeKit doesn’t offer a dedicated volume service for accessories, so this is a common workaround.)
    this.volumeService = accessory.getService('Volume') ||
      accessory.addService(Service.Lightbulb, 'Volume Control');
    this.volumeService.getCharacteristic(Characteristic.Brightness)
      .on('set', this.setVolume.bind(this));

    // Optionally, set initial values.
    this.speakerService.getCharacteristic(Characteristic.Active).updateValue(0);
    this.volumeService.getCharacteristic(Characteristic.Brightness).updateValue(50);
  }

  // Called when HomeKit sets the Active state.
  // value: 1 means "play" (active), 0 means "stop" (inactive)
  setActive(value, callback) {
    this.log(`[${this.device.name}] Active set to ${value}`);
    if (value === 1) {
      // Prepare options for the play command.
      let options = { device: this.deviceId };

      // If the provider is "apple_music", assume we want to play Apple Music.
      // (In a real-world scenario, you might extract the song/artist info from the context;
      // here we just send a generic play command.)
      if (this.provider === 'apple_music') {
        options.provider = 'APPLE_MUSIC';
        // You might add a search parameter to match a song if available, e.g.:
        // options.search = "Song Name from Apple Music";
      } else {
        options.provider = this.provider;
      }
      this.log(`[${this.device.name}] Sending play command with options: ${JSON.stringify(options)}`);
      this.alexa.sendCommand('play', options, (err, result) => {
        if (err) this.log(`[${this.device.name}] Error playing:`, err);
        else this.log(`[${this.device.name}] Play command sent successfully.`);
        callback();
      });
    } else {
      // Active set to 0: send stop command.
      this.log(`[${this.device.name}] Sending stop command.`);
      this.alexa.sendCommand('stop', { device: this.deviceId }, (err, result) => {
        if (err) this.log(`[${this.device.name}] Error stopping:`, err);
        else this.log(`[${this.device.name}] Stop command sent successfully.`);
        callback();
      });
    }
  }

  // Called when HomeKit sets the Brightness characteristic on the Volume service.
  // Here, we interpret Brightness as volume (0-100).
  setVolume(value, callback) {
    this.log(`[${this.device.name}] Volume set to ${value}`);
    this.alexa.sendCommand('volume', { device: this.deviceId, value: value }, (err, result) => {
      if (err) this.log(`[${this.device.name}] Error setting volume:`, err);
      else this.log(`[${this.device.name}] Volume command sent successfully.`);
      callback();
    });
  }
}
