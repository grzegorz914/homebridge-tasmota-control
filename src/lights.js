import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import Functions from './functions.js';
import { ApiCommands } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Lights extends EventEmitter {
    constructor(api, config, info, serialNumber, refreshInterval) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        AccessoryUUID = api.hap.uuid;

        //info
        this.info = info;
        this.serialNumber = serialNumber;
        this.relaysCount = info.friendlyNames.length;

        //other config
        this.lightsNamePrefix = config.lightsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.refreshInterval = refreshInterval;
        this.functions = new Functions();

        //axios instance
        const url = `http://${config.host}/cm?cmnd=`;
        this.axiosInstance = axios.create({
            baseURL: url,
            timeout: 15000,
            withCredentials: config.auth,
            auth: {
                username: config.user,
                password: config.passwd
            }
        });

        //lock flags
        this.locks = {
            checkState: false,
        };
        this.impulseGenerator = new ImpulseGenerator()
            .on('checkState', () => this.handleWithLock('checkState', async () => {
                await this.checkState();
            }))
            .on('state', (state) => {
                this.emit('success', `Impulse generator ${state ? 'started' : 'stopped'}.`);
            });
    }

    async handleWithLock(lockKey, fn) {
        if (this.locks[lockKey]) return;

        this.locks[lockKey] = true;
        try {
            await fn();
        } catch (error) {
            this.emit('error', `Inpulse generator error: ${error}`);
        } finally {
            this.locks[lockKey] = false;
        }
    }

    async checkState() {
        if (this.enableDebugMode) this.emit('debug', `Requesting status`);
        try {
            //power status
            const powerStatusData = await this.axiosInstance(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            const powerStatusKeys = Object.keys(powerStatus);
            if (this.enableDebugMode) this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`);

            //sensor status
            const sensorStatusData = await this.axiosInstance(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`);

            //sensor status keys
            const sensorStatusKeys = Object.keys(sensorStatus);

            //status STS
            const statusStsSupported = sensorStatusKeys.includes('StatusSTS');
            const statusSts = statusStsSupported ? sensorStatus.StatusSTS : {};

            //relays
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                this.lights = [];

                for (let i = 0; i < relaysCount; i++) {
                    const friendlyName = this.info.friendlyNames[i];
                    const powerNr = i + 1;
                    const powerKey = relaysCount === 1 ? 'POWER' : `POWER${powerNr}`;
                    const power = powerStatus[powerKey] === 'ON';

                    //dimmer
                    const dimmer = statusSts.Dimmer ?? false;

                    //color temperature scale tasmota 153..500 to homekit 140..500
                    const colorTemp = statusSts.CT ?? false;
                    const colorTemperature = colorTemp !== false ? await this.functions.scaleValue(colorTemp, 153, 500, 140, 500) : false;

                    //hasb color map to array number
                    const hsbColor = statusSts.HSBColor ? statusSts.HSBColor.split(',').map((value) => Number(value.trim())) : false;

                    //extract hsb colors
                    const [hue, saturation, brightness] = hsbColor !== false ? hsbColor : [false, false, false];

                    //brightness type and brightness
                    const brightnessType = brightness !== false ? 2 : dimmer !== false ? 1 : 0;
                    const bright = [0, dimmer, brightness][brightnessType];

                    //push to array
                    const light = {
                        friendlyName: `Light ${friendlyName}`,
                        power: power,
                        brightness: bright,
                        colorTemperature: colorTemperature,
                        hue: hue,
                        saturation: saturation,
                        brightnessType: brightnessType
                    };
                    this.lights.push(light);

                    //update characteristics
                    const service = this.lightServices?.[i];
                    if (service) {
                        const serviceName = this.lightsNamePrefix ? `${this.info.deviceName} ${friendlyName}` : friendlyName;
                        service.updateCharacteristic(Characteristic.ConfiguredName, serviceName);
                        service.updateCharacteristic(Characteristic.On, power);

                        if (brightnessType > 0) {
                            service.updateCharacteristic(Characteristic.Brightness, bright);
                        }
                        if (colorTemperature !== false) {
                            service.updateCharacteristic(Characteristic.ColorTemperature, colorTemperature);
                        }
                        if (hue !== false) {
                            service.updateCharacteristic(Characteristic.Hue, hue);
                        }
                        if (saturation !== false) {
                            service.updateCharacteristic(Characteristic.Saturation, saturation);
                        }
                    }


                    //log info
                    if (!this.disableLogInfo) {
                        this.emit('info', `${friendlyName}, state: ${power ? 'ON' : 'OFF'}`);
                        if (brightnessType !== 0) this.emit('info', `${friendlyName}, brightness: ${bright} %`);
                        if (colorTemperature) this.emit('info', `${friendlyName}, color temperatur: ${colorTemperature}`);
                        if (hue) this.emit('info', `${friendlyName}, hue: ${hue}`);
                        if (saturation) this.emit('info', `${friendlyName}, saturation: ${saturation}`);
                    }
                }
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
    }

    async startImpulseGenerator() {
        try {
            //start impulse generator 
            const timers = [{ name: 'checkState', sampling: this.refreshInterval }];
            await this.impulseGenerator.start(timers);
            return true;
        } catch (error) {
            throw new Error(`Impulse generator start error: ${error}`);
        }
    }

    async deviceInfo() {
        this.emit('devInfo', `----- ${this.info.deviceName} -----`);
        this.emit('devInfo', `Manufacturer: Tasmota`);
        this.emit('devInfo', `Hardware: ${this.info.modelName}`);
        this.emit('devInfo', `Serialnr: ${this.serialNumber}`)
        this.emit('devInfo', `Firmware: ${this.info.firmwareRevision}`);
        this.emit('devInfo', `Relays: ${this.relaysCount}`);
        this.emit('devInfo', `----------------------------------`);
        return;
    }

    //prepare accessory
    async prepareAccessory() {
        if (this.enableDebugMode) this.emit('debug', `Prepare Accessory`);

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.LIGHTBULB
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            if (this.enableDebugMode) this.emit('debug', `Prepare Information Service`);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            if (this.enableDebugMode) this.emit('debug', `Prepare Services`);
            if (this.lights.length > 0) {
                if (this.enableDebugMode) this.emit('debug', `Prepare Light Services`);
                this.lightServices = [];

                for (let i = 0; i < this.lights.length; i++) {
                    const friendlyName = this.lights[i].friendlyName;
                    const serviceName = this.lightsNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const lightService = accessory.addService(Service.Lightbulb, serviceName, `Light ${i}`)
                    lightService.setPrimaryService(true);
                    lightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    lightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    lightService.getCharacteristic(Characteristic.On)
                        .onGet(async () => {
                            const state = this.lights[i].power;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                const relayNr = i + 1;
                                const powerOn = this.lights.length === 1 ? ApiCommands.PowerOn : `${ApiCommands.Power}${relayNr}${ApiCommands.On}`;
                                const powerOff = this.lights.length === 1 ? ApiCommands.PowerOff : `${ApiCommands.Power}${relayNr}${ApiCommands.Off}`;
                                state = state ? powerOn : powerOff;

                                await this.axiosInstance.get(state);
                                if (!this.disableLogInfo) this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    if (this.lights[i].brightnessType > 0) {
                        lightService.getCharacteristic(Characteristic.Brightness)
                            .onGet(async () => {
                                const value = this.lights[i].brightness;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    const brightness = ['', `${ApiCommands.Dimmer}${value}`, `${ApiCommands.HSBBrightness}${value}`][this.lights[i].brightnessType]; //0..100
                                    await this.axiosInstance.get(brightness);
                                    if (!this.disableLogInfo) this.emit('info', `${friendlyName}, set brightness: ${value} %`);
                                } catch (error) {
                                    this.emit('warn', `set brightness error: ${error}`);
                                }
                            });
                    }
                    if (this.lights[i].colorTemperature !== false) {
                        lightService.getCharacteristic(Characteristic.ColorTemperature)
                            .onGet(async () => {
                                const value = this.lights[i].colorTemperature;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    value = await this.functions.scaleValue(value, 140, 500, 153, 500);
                                    const colorTemperature = `${ApiCommands.ColorTemperature}${value}`; //153..500
                                    await this.axiosInstance.get(colorTemperature);
                                    if (!this.disableLogInfo) this.emit('info', `${friendlyName}, set color temperatur: ${value}`);
                                } catch (error) {
                                    this.emit('warn', `set color temperatur error: ${error}`);
                                }
                            });
                    }
                    if (this.lights[i].hue !== false) {
                        lightService.getCharacteristic(Characteristic.Hue)
                            .onGet(async () => {
                                const value = this.lights[i].hue;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    const hue = `${ApiCommands.HSBHue}${value}`; //0..360
                                    await this.axiosInstance.get(hue);
                                    if (!this.disableLogInfo) this.emit('info', `${friendlyName}, set hue: ${value}`);
                                } catch (error) {
                                    this.emit('warn', `set hue error: ${error}`);
                                }
                            });
                    }
                    if (this.lights[i].saturation !== false) {
                        lightService.getCharacteristic(Characteristic.Saturation)
                            .onGet(async () => {
                                const value = this.lights[i].saturation;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    const saturation = `${ApiCommands.HSBSaturation}${value}`; //0..100
                                    await this.axiosInstance.get(saturation);
                                    if (!this.disableLogInfo) this.emit('info', `set saturation: ${value}`);
                                } catch (error) {
                                    this.emit('warn', `set saturation error: ${error}`);
                                }
                            });
                    }
                    this.lightServices.push(lightService);
                }
            }

            return accessory;
        } catch (error) {
            throw new Error(`Prepare accessory error: ${error}`)
        }
    }

    //start
    async start() {
        try {
            //check device state 
            await this.checkState();

            //connect to deice success
            this.emit('success', `Connect Success`)

            //check device info 
            if (!this.disableLogDeviceInfo) await this.deviceInfo();

            //start prepare accessory
            const accessory = await this.prepareAccessory();
            return accessory;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        }
    }
}
export default Lights;
