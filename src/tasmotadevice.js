'use strict';
const axios = require('axios');
const EventEmitter = require('events');
const ImpulseGenerator = require('./impulsegenerator.js');
const CONSTANTS = require('./constants.json');
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class TasmotaDevice extends EventEmitter {
    constructor(api, config) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        AccessoryUUID = api.hap.uuid;

        //device configuration
        this.name = config.name;
        this.host = config.host;
        this.auth = config.auth || false;
        this.user = config.user || '';
        this.passwd = config.passwd || '';
        this.relaysDisplayType = config.relaysDisplayType || 0;
        this.relaysNamePrefix = config.relaysNamePrefix || false;
        this.lightsNamePrefix = config.lightsNamePrefix || false;
        this.sensorsNamePrefix = config.sensorsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.loadNameFromDevice = config.loadNameFromDevice || false;

        //switches, outlets, lights
        this.relaysCount = 0;

        //sensors
        this.sensorsCount = 0;
        this.sensorsTemperatureCount = 0;
        this.sensorsReferenceTemperatureCount = 0;
        this.sensorsObjTemperatureCount = 0;
        this.sensorsAmbTemperatureCount = 0;
        this.sensorsHumidityCount = 0;
        this.sensorsDewPointTemperatureCount = 0;
        this.sensorsPressureCount = 0;
        this.sensorsGasCount = 0;
        this.sensorsCarbonDioxydeCount = 0;
        this.sensorsAmbientLightCount = 0;
        this.sensorsMotionCount = 0;

        //variable
        this.startPrepareAccessory = true;

        //axios instance
        const url = `http://${this.host}/cm?cmnd=`;
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: 20000,
            withCredentials: this.auth,
            auth: {
                username: this.user,
                password: this.passwd
            }
        });

        //impulse generator
        this.impulseGenerator = new ImpulseGenerator();
        this.impulseGenerator.on('checkDeviceState', async () => {
            try {
                await this.checkDeviceState();
            } catch (error) {
                this.emit('error', `Impulse generator error: ${error}`);
            };
        }).on('state', () => { });
    };

    async start() {
        try {
            const addressMac = await this.getDeviceInfo();
            if (!addressMac) {
                this.emit('warn', `Serial number not found.`);
                return;
            };

            //check device state 
            await this.checkDeviceState();

            //connect to deice success
            this.emit('success', `Connect Success.`)

            //check device info 
            const devInfo = !this.disableLogDeviceInfo ? this.deviceInfo() : false;

            //start prepare accessory
            if (!this.startPrepareAccessory) {
                return;
            }

            const accessory = await this.prepareAccessory();
            const publishAccessory = this.emit('publishAccessory', accessory);
            this.startPrepareAccessory = false;

            return;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        };
    };

    async getDeviceInfo() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting info.`) : false;
        try {
            const deviceInfoData = await this.axiosInstance(CONSTANTS.ApiCommands.Status);
            const deviceInfo = deviceInfoData.data ?? {};
            const debug = this.enableDebugMode ? this.emit('debug', `Info: ${JSON.stringify(deviceInfo, null, 2)}`) : false;

            //relays
            const friendlyNames = [];
            const deviceName = this.loadNameFromDevice ? deviceInfo.Status.DeviceName ?? 'Unknown' : this.name;
            const friendlyName = deviceInfo.Status.FriendlyName ?? '';
            const relaysName = Array.isArray(friendlyName) ? friendlyName : [friendlyName];
            for (const relayName of relaysName) {
                const name = relayName !== '' ? relayName : 'Unknown'
                friendlyNames.push(name);
            };

            //status fwr
            const statusFwr = deviceInfo.StatusFWR ?? {};
            const firmwareRevision = statusFwr.Version ?? 'Unknown';
            const modelName = statusFwr.Hardware ?? 'Unknown';

            //status net
            const addressMac = deviceInfo.StatusNET.Mac ?? false;

            this.deviceName = deviceName;
            this.friendlyNames = friendlyNames;
            this.modelName = modelName;
            this.serialNumber = addressMac;
            this.firmwareRevision = firmwareRevision;
            this.relaysCount = friendlyNames.length;

            return addressMac;
        } catch (error) {
            throw new Error(`Check info error: ${error.message || error}`);
        };
    };

    async checkDeviceState() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting status.`) : false;
        try {
            //switches, outlets, lights
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                this.devicesType = [];
                this.powersStete = [];
                this.brightness = [];
                this.colorTemperatue = [];
                this.hue = [];
                this.saturation = [];

                const powersStatusData = await this.axiosInstance(CONSTANTS.ApiCommands.PowerStatus);
                const powersStatus = powersStatusData.data ?? {};
                const debug = this.enableDebugMode ? this.emit('debug', `Power status: ${JSON.stringify(powersStatus, null, 2)}`) : false;

                //power status keys and device type
                const powerKeys = Object.keys(powersStatus);
                const deviceType = powerKeys.some(key => CONSTANTS.LightKeys.includes(key)) ? 1 : 0; //0 - switch/outlet, 1 - light

                for (let i = 0; i < relaysCount; i++) {
                    const powerNr = i + 1;
                    const powerKey = relaysCount === 1 ? 'POWER' : `POWER${powerNr}`;
                    const powerState = powersStatus[powerKey] === 'ON';
                    const brightness = powersStatus.Dimmer ?? false;
                    const colorTemperature = powersStatus.CT ?? false;
                    const hue = powersStatus.HSBColor1 ?? false;
                    const saturation = powersStatus.HSBColor2 ?? false;

                    this.devicesType.push(deviceType);
                    this.powersStete.push(powerState);
                    this.brightness.push(brightness);
                    this.colorTemperatue.push(colorTemperature);
                    this.hue.push(hue);
                    this.saturation.push(saturation);

                    //update characteristics
                    if (this.switchOutletLightServices) {
                        this.switchOutletLightServices[i].updateCharacteristic(Characteristic.On, powerState);

                        if (deviceType === 1) {
                            if (brightness !== false) {
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Brightness, brightness);
                            };
                            if (colorTemperature !== false) {
                                const value = colorTemperature > 153 ? colorTemperature : 140;
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.ColorTemperature, value);
                            };
                            if (hue !== false) {
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Hue, hue);
                            };
                            if (saturation !== false) {
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Saturation, saturation);
                            };
                        };
                    };
                };
            };

            //sensors
            const sensorsStatusData = await this.axiosInstance(CONSTANTS.ApiCommands.Status);
            const sensorsStatus = sensorsStatusData.data ?? {};
            const debug = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(sensorsStatus, null, 2)}`) : false;

            //keys
            const sensorsStatusKeys = Object.keys(sensorsStatus);

            //status sns
            const statusSNSSupported = sensorsStatusKeys.includes('StatusSNS') ?? false;
            if (statusSNSSupported) {
                this.sensorsName = [];
                this.sensorsTemperature = [];
                this.sensorsReferenceTemperature = [];
                this.sensorsObjTemperature = [];
                this.sensorsAmbTemperature = [];
                this.sensorsDewPointTemperature = [];
                this.sensorsHumidity = [];
                this.sensorsPressure = [];
                this.sensorsGas = [];
                this.sensorsCarbonDioxyde = [];
                this.sensorsAmbientLight = [];
                this.sensorsMotion = [];

                const sensorTypes = CONSTANTS.SensorKeys;
                const sensor = Object.entries(sensorsStatus.StatusSNS)
                    .filter(([key]) => sensorTypes.some(type => key.includes(type)))
                    .reduce((obj, [key, value]) => {
                        obj[key] = value;
                        return obj;
                    }, {});

                for (const [key, value] of Object.entries(sensor)) {
                    const sensorName = key ?? `Sensor`;
                    const sensorData = value;

                    //sensors
                    const temperature = sensorData.Temperature ?? false;
                    const referenceTemperature = sensorData.ReferenceTemperature ?? false;
                    const objTemperature = sensorData.OBJTMP ?? false;
                    const ambTemperature = sensorData.AMBTMP ?? false;
                    const dewPointTemperature = sensorData.DewPoint ?? false;
                    const humidity = sensorData.Humidity ?? false;
                    const pressure = sensorData.Pressure ?? false;
                    const gas = sensorData.Gas ?? false;
                    const carbonDioxyde = sensorData.CarbonDioxyde ?? false;
                    const ambientLight = sensorData.Ambient ?? false;
                    const motion = sensorData === 'ON';

                    //energy
                    const energyTotalStartTime = sensorData.TotalStartTime ?? '';
                    const energyTotal = sensorData.Total ?? 0;
                    const energyPeriod = sensorData.Period ?? 0;
                    const energyYesterday = sensorData.Yesterday ?? 0;
                    const energyToday = sensorData.Today ?? 0;
                    const power = sensorData.Power ?? 0;
                    const apparentPower = sensorData.ApparentPower ?? 0;
                    const reactivePower = sensorData.ReactivePower ?? 0;
                    const factor = sensorData.Factor ?? 0;
                    const voltage = sensorData.Voltage ?? 0;
                    const current = sensorData.Current ?? 0;
                    const load = sensorData.Load ?? 0;

                    //push to array
                    this.sensorsName.push(sensorName);
                    const push1 = temperature ? this.sensorsTemperature.push(temperature) : false;
                    const push2 = referenceTemperature ? this.sensorsReferenceTemperature.push(referenceTemperature) : false;
                    const push3 = objTemperature ? this.sensorsAmbTemperature.push(objTemperature) : false;
                    const push4 = ambTemperature ? this.sensorsAmbTemperature.push(ambTemperature) : false;
                    const push5 = dewPointTemperature ? this.sensorsDewPointTemperature.push(dewPointTemperature) : false;
                    const push6 = humidity ? this.sensorsHumidity.push(humidity) : false;
                    const push7 = pressure ? this.sensorsPressure.push(pressure) : false;
                    const push8 = gas ? this.sensorsGas.push(gas) : false;
                    const push9 = carbonDioxyde ? this.sensorsCarbonDioxyde.push(carbonDioxyde) : false;
                    const push10 = ambientLight ? this.sensorsAmbientLight.push(ambientLight) : false;
                    const push11 = motion ? this.sensorsMotion.push(motion) : false;
                };

                this.time = sensorsStatus.Time ?? '';
                this.tempUnit = sensorsStatus.TempUnit ?? 'C';
                this.pressureUnit = sensorsStatus.PressureUnit ?? 'hPa';
                this.sensorsTemperatureCount = this.sensorsTemperature.length;
                this.sensorsReferenceTemperatureCount = this.sensorsReferenceTemperature.length;
                this.sensorsObjTemperatureCount = this.sensorsObjTemperature.length;
                this.sensorsAmbTemperatureCount = this.sensorsAmbTemperature.length;
                this.sensorsDewPointTemperatureCount = this.sensorsDewPointTemperature.length;
                this.sensorsHumidityCount = this.sensorsHumidity.length;
                this.sensorsPressureCount = this.sensorsPressure.length;
                this.sensorsGasCount = this.sensorsGas.length;
                this.sensorsCarbonDioxydeCount = this.sensorsCarbonDioxyde.length;
                this.sensorsAmbientLightCount = this.sensorsAmbientLight.length;
                this.sensorsMotionCount = this.sensorsMotion.length;
                this.sensorsCount = this.sensorsName.length;


                //update characteristics
                if (this.sensorTemperatureServices) {
                    for (let i = 0; i < this.sensorsTemperatureCount; i++) {
                        const value = this.sensorsTemperature[i];
                        this.sensorTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    };
                };

                if (this.sensorReferenceTemperatureServices) {
                    for (let i = 0; i < this.sensorsReferenceTemperatureCount; i++) {
                        const value = this.sensorsReferenceTemperature[i];
                        this.sensorReferenceTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    };
                };

                if (this.sensorObjTemperatureServices) {
                    for (let i = 0; i < this.sensorsObjTemperatureCount; i++) {
                        const value = this.sensorsObjTemperature[i];
                        this.sensorObjTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    };
                };

                if (this.sensorAmbTemperatureServices) {
                    for (let i = 0; i < this.sensorsAmbTemperatureCount; i++) {
                        const value = this.sensorsAmbTemperature[i];
                        this.sensorAmbTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    };
                };

                if (this.sensorDewPointTemperatureServices) {
                    for (let i = 0; i < this.sensorsDewPointTemperatureCount; i++) {
                        const value = this.sensorsDewPointTemperature[i];
                        this.sensorDewPointTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    };
                };

                if (this.sensorHumidityServices) {
                    for (let i = 0; i < this.sensorsHumidityCount; i++) {
                        const value = this.sensorsHumidity[i];
                        this.sensorHumidityServices[i].updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
                    };
                };

                if (this.sensorCarbonDioxydeServices) {
                    for (let i = 0; i < this.sensorsCarbonDioxydeCount; i++) {
                        const state = this.sensorsCarbonDioxyde[i] > 1000;
                        const value = this.sensorsCarbonDioxyde[i];
                        this.sensorCarbonDioxydeServices[i]
                            .updateCharacteristic(Characteristic.CarbonDioxideDetected, state)
                            .updateCharacteristic(Characteristic.CarbonDioxideLevel, value)
                            .updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, value);
                    };
                };

                if (this.sensorAmbientLightServices) {
                    for (let i = 0; i < this.sensorsAmbientLightCount; i++) {
                        const value = this.sensorsAmbientLight[i];
                        this.sensorAmbientLightServices[i].updateCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
                    };
                };

                if (this.sensorMotionServices) {
                    for (let i = 0; i < this.sensorsMotionCount; i++) {
                        const state = this.sensorsMotion[i];
                        this.sensorMotionServices[i].updateCharacteristic(Characteristic.MotionDetected, state);
                    };
                };
            };

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error.message || error}`);
        };
    };

    deviceInfo() {
        this.emit('devInfo', `----- ${this.deviceName} -----`);
        this.emit('devInfo', `Manufacturer: Tasmota`);
        this.emit('devInfo', `Hardware: ${this.modelName}`);
        this.emit('devInfo', `Serialnr: ${this.serialNumber}`);
        this.emit('devInfo', `Firmware: ${this.firmwareRevision}`);
        const log = this.relaysCount > 0 ? this.emit('devInfo', `Relays: ${this.relaysCount}`) : false;
        const log1 = this.sensorsCount > 0 ? this.emit('devInfo', `Sensors: ${this.sensorsCount}`) : false;
        this.emit('devInfo', `----------------------------------`);
    };

    //Prepare accessory
    async prepareAccessory() {
        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Accessory`) : false;
        try {
            const accessoryName = this.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.OTHER;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            const debug1 = this.enableDebugMode ? this.emit('debug', `Prepare Information Service`) : false;
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0');

            //Prepare services 
            const debug2 = this.enableDebugMode ? this.emit('debug', `Prepare Services`) : false;

            //switches, outlets, lights
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Switch/Outlet/Light Services`) : false;
                this.switchOutletLightServices = [];

                for (let i = 0; i < relaysCount; i++) {
                    const deviceType = this.devicesType[i];
                    const friendlyName = this.friendlyNames[i];
                    const serviceNameSwitchOutlet = this.relaysNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const serviceNameLightbulb = this.lightsNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const serviceName = [serviceNameSwitchOutlet, serviceNameLightbulb][deviceType];
                    const serviceSwitchOutlet = [Service.Outlet, Service.Switch][this.relaysDisplayType];
                    const serviceType = [serviceSwitchOutlet, Service.Lightbulb][deviceType];
                    const switchOutletLightService = accessory.addService(serviceType, serviceName, `Power ${i}`)
                    switchOutletLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    switchOutletLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    switchOutletLightService.getCharacteristic(Characteristic.On)
                        .onGet(async () => {
                            const state = this.powersStete[i] ?? false;
                            const logInfo = this.disableLogInfo ? false : this.emit('message', `${friendlyName}, state: ${state ? 'ON' : 'OFF'}`);
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                const relayNr = i + 1;
                                const powerOn = relaysCount === 1 ? CONSTANTS.ApiCommands.PowerOn : `${CONSTANTS.ApiCommands.Power}${relayNr}${CONSTANTS.ApiCommands.On}`;
                                const powerOff = relaysCount === 1 ? CONSTANTS.ApiCommands.PowerOff : `${CONSTANTS.ApiCommands.Power}${relayNr}${CONSTANTS.ApiCommands.Off}`;
                                state = state ? powerOn : powerOff;

                                await this.axiosInstance(state);
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    if (deviceType === 1) {
                        if (this.brightness[i] !== false) {
                            switchOutletLightService.getCharacteristic(Characteristic.Brightness)
                                .onGet(async () => {
                                    const value = this.brightness[i] ?? 0;
                                    const logInfo = this.disableLogInfo ? false : this.emit('message', `brightness: ${value} %`);
                                    return value;
                                })
                                .onSet(async (value) => {
                                    try {
                                        const brightness = `${CONSTANTS.ApiCommands.Dimmer}${value}`; //0..100
                                        await this.axiosInstance(brightness);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `set brightness: ${value} %`);
                                    } catch (error) {
                                        this.emit('warn', `set brightness error: ${error}`);
                                    }
                                });
                        };
                        if (this.colorTemperatue[i] !== false) {
                            switchOutletLightService.getCharacteristic(Characteristic.ColorTemperature)
                                .onGet(async () => {
                                    const value = this.colorTemperatue[i] > 153 ? this.colorTemperatue[i] : 140;
                                    const logInfo = this.disableLogInfo ? false : this.emit('message', `color temperatur: ${value}`);
                                    return value;
                                })
                                .onSet(async (value) => {
                                    try {
                                        value = value < 153 ? 153 : value;
                                        const colorTemperature = `${CONSTANTS.ApiCommands.ColorTemperature}${value}`; //140..500
                                        await this.axiosInstance(colorTemperature);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `set color temperatur: ${value} °`);
                                    } catch (error) {
                                        this.emit('warn', `set color temperatur error: ${error}`);
                                    }
                                });
                        };
                        if (this.hue[i] !== false) {
                            switchOutletLightService.getCharacteristic(Characteristic.Hue)
                                .onGet(async () => {
                                    const value = this.hue[i] ?? 0;
                                    const logInfo = this.disableLogInfo ? false : this.emit('message', `hue: ${value} %`);
                                    return value;
                                })
                                .onSet(async (value) => {
                                    try {
                                        const hue = `${CONSTANTS.ApiCommands.HSBHue}${value}`; //0..360
                                        await this.axiosInstance(hue);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `set hue: ${value} °`);
                                    } catch (error) {
                                        this.emit('warn', `set hue error: ${error}`);
                                    }
                                });
                        };
                        if (this.saturation[i] !== false) {
                            switchOutletLightService.getCharacteristic(Characteristic.Saturation)
                                .onGet(async () => {
                                    const value = this.saturation[i] ?? 0;
                                    const logInfo = this.disableLogInfo ? false : this.emit('message', `saturation: ${value} %`);
                                    return value;
                                })
                                .onSet(async (value) => {
                                    try {
                                        const saturation = `${CONSTANTS.ApiCommands.HSBSaturation}${value}`; //0..100
                                        await this.axiosInstance(saturation);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `set saturation: ${value} °`);
                                    } catch (error) {
                                        this.emit('warn', `set saturation error: ${error}`);
                                    }
                                });
                        };
                    };
                    this.switchOutletLightServices.push(switchOutletLightService);
                };
            };

            //sensors
            const sensorsCount = this.sensorsCount;
            if (sensorsCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Sensor Services`) : false;

                //temperature
                const sensorsTemperatureCount = this.sensorsTemperatureCount;
                if (sensorsTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Temperature Sensor Services`) : false;
                    this.sensorTemperatureServices = [];
                    for (let i = 0; i < sensorsTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                        const sensorTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                        sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorTemperatureServices.push(sensorTemperatureService);
                    };
                }

                //reference temperature
                const sensorsReferenceTemperatureCount = this.sensorsReferenceTemperatureCount;
                if (sensorsReferenceTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Reference Temperature Sensor Services`) : false;
                    this.sensorReferenceTemperatureServices = [];
                    for (let i = 0; i < sensorsReferenceTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                        const sensorReferenceTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                        sensorReferenceTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorReferenceTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorReferenceTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsReferenceTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} reference temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                    };
                }

                //object temperature
                const sensorsObjTemperatureCount = this.sensorsObjTemperatureCount;
                if (sensorsObjTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Obj Temperature Sensor Services`) : false;
                    this.sensorObjTemperatureServices = [];
                    for (let i = 0; i < sensorsObjTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                        const sensorObjTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                        sensorObjTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorObjTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorObjTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsObjTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} obj temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                    };
                }

                //ambient temperature
                const sensorsAmbTemperatureCount = this.sensorsAmbTemperatureCount;
                if (sensorsAmbTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Amb Temperature Sensor Services`) : false;
                    this.sensorAmbTemperatureServices = [];
                    for (let i = 0; i < sensorsAmbTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                        const sensorAmbTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                        sensorAmbTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsAmbTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} amb temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                    };
                }

                //dew point temperature
                const sensorsDewPointTemperatureCount = this.sensorsDewPointTemperatureCount;
                if (sensorsDewPointTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Dew Point Temperature Sensor Services`) : false;
                    this.sensorDewPointTemperatureServices = [];
                    for (let i = 0; i < sensorsDewPointTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                        const sensorDewPointTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                        sensorDewPointTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorDewPointTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorDewPointTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsDewPointTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                    };
                }

                //humidity
                const sensorsHumidityCount = this.sensorsHumidityCount;
                if (sensorsHumidityCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Humidity Sensor Services`) : false;
                    this.sensorHumidityServices = [];
                    for (let i = 0; i < sensorsHumidityCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                        const sensorHumidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                        sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .onGet(async () => {
                                const value = this.sensorsHumidity[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} humidity: ${value} %`);
                                return value;
                            });
                        this.sensorHumidityServices.push(sensorHumidityService);
                    };
                }

                //pressure

                //gas

                //carbon dioxyde
                const sensorsCarbonDioxydeCount = this.sensorsCarbonDioxydeCount;
                if (sensorsCarbonDioxydeCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`) : false;
                    this.sensorCarbonDioxydeServices = [];
                    for (let i = 0; i < sensorsCarbonDioxydeCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                        const sensorCarbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                        sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                            .onGet(async () => {
                                const state = this.sensorsCarbonDioxyde[i] > 1000;
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                return state;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                return value;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                return value;
                            });
                        this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                    };
                }

                //ambient light
                const sensorsAmbientLightCount = this.sensorsAmbientLightCount;
                if (sensorsAmbientLightCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Ambient Light Sensor Services`) : false;
                    this.sensorAmbientLightServices = [];
                    for (let i = 0; i < sensorsAmbientLightCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                        const sensorAmbientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                        sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                            .onGet(async () => {
                                const value = this.sensorsAmbientLight[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} ambient light: ${value} lx`);
                                return value;
                            });
                        this.sensorAmbientLightServices.push(sensorAmbientLightService);
                    };
                }

                //motion
                const sensorsMotionCount = this.sensorsMotionCount;
                if (sensorsMotionCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Motion Sensor Services`) : false;
                    this.sensorMotionServices = [];
                    for (let i = 0; i < sensorsMotionCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                        const sensorMotionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                        sensorMotionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorMotionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorMotionService.getCharacteristic(Characteristic.MotionDetected)
                            .onGet(async () => {
                                const state = this.sensorsMotion[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            });
                        this.sensorMotionServices.push(sensorMotionService);
                    };
                }
            };

            return accessory;
        } catch (error) {
            throw new Error(`Prepare accessory error: ${error.message || error}`)
        };
    }
};
module.exports = TasmotaDevice;
