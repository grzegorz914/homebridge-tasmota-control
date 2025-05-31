import { promises as fsPromises } from 'fs';
import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import { ApiCommands, SensorKeys } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Lights extends EventEmitter {
    constructor(api, config, info, refreshInterval) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        AccessoryUUID = api.hap.uuid;

        //info
        this.info = info;

        //other config
        this.lightsNamePrefix = config.lightsNamePrefix || false;
        this.sensorsNamePrefix = config.sensorsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.refreshInterval = refreshInterval;

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
        const url = `http://${config.host}/cm?cmnd=`;
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: refreshInterval > 10000 ? 10000 : refreshInterval,
            withCredentials: config.auth,
            auth: {
                username: config.user,
                password: config.passwd
            }
        });

        //impulse generator
        this.impulseGenerator = new ImpulseGenerator();
        this.impulseGenerator.on('checkDeviceState', async () => {
            try {
                await this.checkDeviceState();
            } catch (error) {
                this.emit('error', `Impulse generator error: ${error}`);
            }
        }).on('state', (state) => {
            const emitState = state ? this.emit('success', `Impulse generator started`) : this.emit('warn', `Impulse generator stopped`);
        });
    }

    async checkDeviceState() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting status`) : false;
        try {
            //power status
            const powerStatusData = await this.axiosInstance(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            const powerStatusKeys = Object.keys(powerStatus);
            const debug = this.enableDebugMode ? this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`) : false;

            //sensor status
            const sensorStatusData = await this.axiosInstance(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            const debug1 = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`) : false;

            //sensor status keys
            const sensorStatusKeys = Object.keys(sensorStatus);

            //status SNS
            const statusSnsSupported = sensorStatusKeys.includes('StatusSNS');
            const statusSns = statusSnsSupported ? sensorStatus.StatusSNS : {};

            //status STS
            const statusStsSupported = sensorStatusKeys.includes('StatusSTS');
            const statusSts = statusStsSupported ? sensorStatus.StatusSTS : {};

            //relays
            const relaysCount = this.info.relaysCount;
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
                    const colorTemperature = colorTemp !== false ? await this.scaleValue(colorTemp, 153, 500, 140, 500) : false;

                    //hasb color map to array number
                    const hsbColor = statusSts.HSBColor ? statusSts.HSBColor.split(',').map((value) => Number(value.trim())) : false;

                    //extract hsb colors
                    const [hue, saturation, brightness] = hsbColor !== false ? hsbColor : [false, false, false];

                    //brightness type and brightness
                    const brightnessType = brightness !== false ? 2 : dimmer !== false ? 1 : 0;
                    const bright = [0, dimmer, brightness][brightnessType];

                    //push to array
                    const light = {
                        friendlyName: friendlyName,
                        power: power,
                        brightness: bright,
                        colorTemperature: colorTemperature,
                        hue: hue,
                        saturation: saturation,
                        brightnessType: brightnessType
                    };
                    this.lights.push(light);

                    //update characteristics
                    if (this.lightServices) {
                        this.lightServices[i].updateCharacteristic(Characteristic.On, power);

                        if (brightnessType > 0) {
                            this.lightServices[i].updateCharacteristic(Characteristic.Brightness, bright);
                        }
                        if (colorTemperature !== false) {
                            this.lightServices[i].updateCharacteristic(Characteristic.ColorTemperature, colorTemperature);
                        }
                        if (hue !== false) {
                            this.lightServices[i].updateCharacteristic(Characteristic.Hue, hue);
                        }
                        if (saturation !== false) {
                            this.lightServices[i].updateCharacteristic(Characteristic.Saturation, saturation);
                        }
                    }

                    //log info
                    if (!this.disableLogInfo) {
                        this.emit('info', `${friendlyName}, state: ${power ? 'ON' : 'OFF'}`);
                        const logInfo = brightnessType === 0 ? false : this.emit('info', `${friendlyName}, brightness: ${bright} %`);
                        const logInfo1 = colorTemperature === false ? false : this.emit('info', `${friendlyName}, color temperatur: ${colorTemperature}`);
                        const logInfo2 = hue === false ? false : this.emit('info', `${friendlyName}, hue: ${hue}`);
                        const logInfo3 = saturation === false ? false : this.emit('info', `${friendlyName}, saturation: ${saturation}`);
                    }
                }
            }

            //status SNS
            if (statusSnsSupported) {
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

                const sensor = Object.entries(statusSns)
                    .filter(([key]) => SensorKeys.some(type => key.includes(type)))
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
                }

                this.time = sensorStatus.Time ?? '';
                this.tempUnit = sensorStatus.TempUnit === 'C' ? '°C' : 'F';
                this.pressureUnit = sensorStatus.PressureUnit ?? 'hPa';
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
                    }
                }

                if (this.sensorReferenceTemperatureServices) {
                    for (let i = 0; i < this.sensorsReferenceTemperatureCount; i++) {
                        const value = this.sensorsReferenceTemperature[i];
                        this.sensorReferenceTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    }
                }

                if (this.sensorObjTemperatureServices) {
                    for (let i = 0; i < this.sensorsObjTemperatureCount; i++) {
                        const value = this.sensorsObjTemperature[i];
                        this.sensorObjTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    }
                }

                if (this.sensorAmbTemperatureServices) {
                    for (let i = 0; i < this.sensorsAmbTemperatureCount; i++) {
                        const value = this.sensorsAmbTemperature[i];
                        this.sensorAmbTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    }
                }

                if (this.sensorDewPointTemperatureServices) {
                    for (let i = 0; i < this.sensorsDewPointTemperatureCount; i++) {
                        const value = this.sensorsDewPointTemperature[i];
                        this.sensorDewPointTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                    }
                }

                if (this.sensorHumidityServices) {
                    for (let i = 0; i < this.sensorsHumidityCount; i++) {
                        const value = this.sensorsHumidity[i];
                        this.sensorHumidityServices[i].updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
                    }
                }

                if (this.sensorCarbonDioxydeServices) {
                    for (let i = 0; i < this.sensorsCarbonDioxydeCount; i++) {
                        const state = this.sensorsCarbonDioxyde[i] > 1000;
                        const value = this.sensorsCarbonDioxyde[i];
                        this.sensorCarbonDioxydeServices[i]
                            .updateCharacteristic(Characteristic.CarbonDioxideDetected, state)
                            .updateCharacteristic(Characteristic.CarbonDioxideLevel, value)
                            .updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, value);
                    }
                }

                if (this.sensorAmbientLightServices) {
                    for (let i = 0; i < this.sensorsAmbientLightCount; i++) {
                        const value = this.sensorsAmbientLight[i];
                        this.sensorAmbientLightServices[i].updateCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
                    }
                }

                if (this.sensorMotionServices) {
                    for (let i = 0; i < this.sensorsMotionCount; i++) {
                        const state = this.sensorsMotion[i];
                        this.sensorMotionServices[i].updateCharacteristic(Characteristic.MotionDetected, state);
                    }
                }
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
    }

    async scaleValue(value, inMin, inMax, outMin, outMax) {
        const scaledValue = parseFloat((((Math.max(inMin, Math.min(inMax, value)) - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin).toFixed(0));
        return scaledValue;
    }

    async saveData(path, data) {
        try {
            data = JSON.stringify(data, null, 2);
            await fsPromises.writeFile(path, data);
            const debug = !this.enableDebugMode ? false : this.emit('debug', `Saved data: ${data}`);
            return true;
        } catch (error) {
            throw new Error(`Save data error: ${error}`);
        }
    }

    async readData(path) {
        try {
            const data = await fsPromises.readFile(path);
            return data;
        } catch (error) {
            throw new Error(`Read data error: ${error}`);
        }
    }

    async startImpulseGenerator() {
        try {
            //start impulse generator 
            const timers = [{ name: 'checkDeviceState', sampling: this.refreshInterval }]; e;
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
        this.emit('devInfo', `Serialnr: ${this.info.serialNumber}`)
        this.emit('devInfo', `Firmware: ${this.info.firmwareRevision}`);
        this.emit('devInfo', `Relays: ${this.info.relaysCount}`);
        this.emit('devInfo', `Sensors: ${this.sensorsCount}`);
        this.emit('devInfo', `----------------------------------`);
        return;
    }

    //prepare accessory
    async prepareAccessory() {
        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Accessory`) : false;

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.info.serialNumber);
            const accessoryCategory = Categories.LIGHTBULB
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            const debug1 = this.enableDebugMode ? this.emit('debug', `Prepare Information Service`) : false;
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.info.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            const debug2 = this.enableDebugMode ? this.emit('debug', `Prepare Services`) : false;
            if (this.lights.length > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Light Services`) : false;
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

                                await this.axiosInstance(state);
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
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
                                    await this.axiosInstance(brightness);
                                    const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set brightness: ${value} %`);
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
                                    value = await this.scaleValue(value, 140, 500, 153, 500);
                                    const colorTemperature = `${ApiCommands.ColorTemperature}${value}`; //153..500
                                    await this.axiosInstance(colorTemperature);
                                    const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set color temperatur: ${value}`);
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
                                    await this.axiosInstance(hue);
                                    const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set hue: ${value}`);
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
                                    await this.axiosInstance(saturation);
                                    const logInfo = this.disableLogInfo ? false : this.emit('info', `set saturation: ${value}`);
                                } catch (error) {
                                    this.emit('warn', `set saturation error: ${error}`);
                                }
                            });
                    }
                    this.lightServices.push(lightService);
                }
            }

            //sensors
            if (this.sensorsCount > 0) {
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorTemperatureServices.push(sensorTemperatureService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} reference temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} obj temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} amb temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} humidity: ${value} %`);
                                return value;
                            });
                        this.sensorHumidityServices.push(sensorHumidityService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                return state;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                return value;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                return value;
                            });
                        this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} ambient light: ${value} lx`);
                                return value;
                            });
                        this.sensorAmbientLightServices.push(sensorAmbientLightService);
                    }
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
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            });
                        this.sensorMotionServices.push(sensorMotionService);
                    }
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
            await this.checkDeviceState();

            //connect to deice success
            this.emit('success', `Connect Success`)

            //check device info 
            const devInfo = !this.disableLogDeviceInfo ? await this.deviceInfo() : false;

            //start prepare accessory
            if (this.startPrepareAccessory) {
                const accessory = await this.prepareAccessory();
                const publishAccessory = this.emit('publishAccessory', accessory);
                this.startPrepareAccessory = false;
            }

            return true;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        }
    }
}
export default Lights;
