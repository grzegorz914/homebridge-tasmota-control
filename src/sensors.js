import { promises as fsPromises } from 'fs';
import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import { ApiCommands, SensorKeys } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Sensors extends EventEmitter {
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

        //other config
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
            //sensor status
            const sensorStatusData = await this.axiosInstance(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            const debug1 = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`) : false;

            //sensor status keys
            const sensorStatusKeys = Object.keys(sensorStatus);

            //status SNS
            const statusSnsSupported = sensorStatusKeys.includes('StatusSNS');
            const statusSns = statusSnsSupported ? sensorStatus.StatusSNS : {};

            //status SNS
            if (statusSnsSupported) {
                this.sensors = [];
                const sensorData = Object.entries(statusSns)
                    .filter(([key]) => SensorKeys.some(type => key.includes(type)))
                    .reduce((obj, [key, value]) => {
                        obj[key] = value;
                        return obj;
                    }, {});

                for (const [key, value] of Object.entries(sensorData)) {
                    const sensorData = value;

                    //sensor
                    const obj = {
                        name: key,
                        time: statusSns.Time,
                        tempUnit: statusSns.TempUnit,
                        pressureUnit: statusSns.PressureUnit,
                        temperature: sensorData.Temperature,
                        referenceTemperature: sensorData.ReferenceTemperature,
                        objTemperature: sensorData.OBJTMP,
                        ambTemperature: sensorData.AMBTMP,
                        dewPointTemperature: sensorData.DewPoint,
                        humidity: sensorData.Humidity,
                        pressure: sensorData.Pressure,
                        gas: sensorData.Gas,
                        carbonDioxyde: sensorData.CarbonDioxyde,
                        ambientLight: sensorData.Ambient,
                        motion: sensorData.Motion
                    }
                    if (obj.tempUnit === 'C') {
                        obj.tempUnit = '°C';
                    }

                    //energy
                    const obj1 = {
                        power: sensorData.Power,
                        apparentPower: sensorData.ApparentPower,
                        reactivePower: sensorData.ReactivePower,
                        energyToday: sensorData.Today,
                        energyLastDay: sensorData.Yesterday,
                        energyLifetime: sensorData.Total,
                        energyLifeTimeStartTime: sensorData.TotalStartTime,
                        energyPeriod: sensorData.Period,
                        current: sensorData.Current,
                        voltage: sensorData.Voltage,
                        factor: sensorData.Factor,
                        frequency: sensorData.Frequency,
                        load: sensorData.Load,
                    }
                    const sensor = key === 'ENERGY' ? { ...obj, ...obj1 } : obj;
                    const debug1 = this.enableDebugMode ? this.emit('debug', `Sensor: ${JSON.stringify(sensor, null, 2)}`) : false;

                    //push to array
                    this.sensors.push(sensor);
                }
                this.sensorsCount = this.sensors.length;

                //update characteristics
                if (this.sensorsCount > 0) {
                    for (let i = 0; i < this.sensorsCount; i++) {
                        const sensor = this.sensors[i];

                        this.sensorTemperatureServices?.[i]?.updateCharacteristic(Characteristic.CurrentTemperature, sensor.temperature);
                        this.sensorReferenceTemperatureServices?.[i]?.updateCharacteristic(Characteristic.CurrentTemperature, sensor.referenceTemperature);
                        this.sensorObjTemperatureServices?.[i]?.updateCharacteristic(Characteristic.CurrentTemperature, sensor.objTemperature);
                        this.sensorAmbTemperatureServices?.[i]?.updateCharacteristic(Characteristic.CurrentTemperature, sensor.ambTemperature);
                        this.sensorDewPointTemperatureServices?.[i]?.updateCharacteristic(Characteristic.CurrentTemperature, sensor.dewPointTemperature);
                        this.sensorHumidityServices?.[i]?.updateCharacteristic(Characteristic.CurrentRelativeHumidity, sensor.humidity);

                        const co2Service = this.sensorCarbonDioxydeServices?.[i];
                        co2Service?.updateCharacteristic(Characteristic.CarbonDioxideDetected, sensor.carbonDioxyde > 1000);
                        co2Service?.updateCharacteristic(Characteristic.CarbonDioxideLevel, sensor.carbonDioxyde);
                        co2Service?.updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, sensor.carbonDioxyde);

                        this.sensorAmbientLightServices?.[i]?.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, sensor.ambientLight);
                        this.sensorMotionServices?.[i]?.updateCharacteristic(Characteristic.MotionDetected, sensor.motion);


                        //energy
                        const fields = [
                            'Power', 'ApparentPower', 'ReactivePower', 'EnergyToday', 'EnergyLastDay',
                            'EnergyLifetime', 'Current', 'Voltage', 'Factor', 'Frequency', 'ReadingTime'
                        ];
                        const characteristic = this.sensorEnergyServices?.[i]?.Characteristic;
                        for (const key of fields) {
                            characteristic?.[key]?.updateCharacteristic(Characteristic[key], sensor[key.toLowerCase()]);
                        }

                    }
                }
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
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
            const timers = [{ name: 'checkDeviceState', sampling: this.refreshInterval }];
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
        this.emit('devInfo', `Sensor: ${this.info.sensorName}`);
        this.emit('devInfo', `----------------------------------`);
        return;
    }

    //prepare accessory
    async prepareAccessory() {
        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Accessory`) : false;

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.SENSOR;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            const debug1 = this.enableDebugMode ? this.emit('debug', `Prepare Information Service`) : false;
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            if (this.sensorsCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Sensor Services`) : false;

                //temperature
                let i = 0;
                for (const sensor of this.sensors) {
                    const sensorName = sensor.name;
                    if (sensor.temperature) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Temperature Sensor Services`) : false;
                        this.sensorTemperatureServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                        const sensorTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                        sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.temperature;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.sensorTemperatureServices.push(sensorTemperatureService);
                    }

                    //reference temperature
                    if (sensor.referenceTemperature) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Reference Temperature Sensor Services`) : false;
                        this.sensorReferenceTemperatureServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                        const sensorReferenceTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                        sensorReferenceTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorReferenceTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorReferenceTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.referenceTemperature;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} reference temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                    }

                    //object temperature
                    if (sensor.objTemperature) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Obj Temperature Sensor Services`) : false;
                        this.sensorObjTemperatureServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                        const sensorObjTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                        sensorObjTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorObjTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorObjTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.objTemperature;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} obj temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                    }

                    //ambient temperature
                    if (sensor.ambTemperature) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Amb Temperature Sensor Services`) : false;
                        this.sensorAmbTemperatureServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                        const sensorAmbTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                        sensorAmbTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.ambTemperature;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} amb temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                    }

                    //dew point temperature
                    if (sensor.dewPointTemperature) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Dew Point Temperature Sensor Services`) : false;
                        this.sensorDewPointTemperatureServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                        const sensorDewPointTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                        sensorDewPointTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorDewPointTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorDewPointTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.dewPointTemperature;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} dew point: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                    }

                    //humidity
                    if (sensor.humidity) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Humidity Sensor Services`) : false;
                        this.sensorHumidityServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                        const sensorHumidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                        sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .onGet(async () => {
                                const value = sensor.humidity;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} humidity: ${value} %`);
                                return value;
                            });
                        this.sensorHumidityServices.push(sensorHumidityService);
                    }

                    //pressure

                    //gas

                    //carbon dioxyde
                    if (sensor.carbonDioxyde) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`) : false;
                        this.sensorCarbonDioxydeServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                        const sensorCarbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                        sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                            .onGet(async () => {
                                const state = sensor.carbonDioxyde > 1000;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                return state;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                            .onGet(async () => {
                                const value = sensor.carbonDioxyde;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                return value;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                            .onGet(async () => {
                                const value = sensor.carbonDioxyde;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                return value;
                            });
                        this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                    }

                    //ambient light
                    if (sensor.ambientLight) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Ambient Light Sensor Services`) : false;
                        this.sensorAmbientLightServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                        const sensorAmbientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                        sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                            .onGet(async () => {
                                const value = sensor.ambientLight;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} ambient light: ${value} lx`);
                                return value;
                            });
                        this.sensorAmbientLightServices.push(sensorAmbientLightService);
                    }

                    //motion
                    if (sensor.motion) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Motion Sensor Services`) : false;
                        this.sensorMotionServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                        const sensorMotionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                        sensorMotionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorMotionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorMotionService.getCharacteristic(Characteristic.MotionDetected)
                            .onGet(async () => {
                                const state = sensor.motion;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            });
                        this.sensorMotionServices.push(sensorMotionService);
                    }

                    //energy
                    if (sensor.name === 'ENERGY') {
                        const debug4 = this.enableDebugMode ? this.emit('debug', `Prepare Power And Energy Service`) : false;
                        this.sensorEnergyServices = [];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName}` : `${sensorName} Sensor`;
                        const energyService = accessory.addService(Service.PowerAndEnergyService, serviceName, `Energy Sensor ${i}`);
                        energyService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        if (sensor.power) {
                            energyService.getCharacteristic(Characteristic.Power)
                                .onGet(async () => {
                                    const value = sensor.power;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} power: ${value} W`);
                                    return value;
                                });
                        }
                        if (sensor.apparentPower) {
                            energyService.getCharacteristic(Characteristic.ApparentPower)
                                .onGet(async () => {
                                    const value = sensor.apparentPower;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} apparent power: ${value} VA`);
                                    return value;
                                });
                        }
                        if (sensor.reactivePower) {
                            energyService.getCharacteristic(Characteristic.ReactivePower)
                                .onGet(async () => {
                                    const value = sensor.reactivePower;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} reactive power: ${value} VAr`);
                                    return value;
                                });
                        }
                        if (sensor.energyToday) {
                            energyService.getCharacteristic(Characteristic.EnergyToday)
                                .onGet(async () => {
                                    const value = sensor.energyToday;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} energy today: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.energyLastDay) {
                            energyService.getCharacteristic(Characteristic.EnergyLastDay)
                                .onGet(async () => {
                                    const value = sensor.energyLastDay;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} energy last day: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.energyLifetime) {
                            energyService.getCharacteristic(Characteristic.EnergyLifetime)
                                .onGet(async () => {
                                    const value = sensor.energyLifetime;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} energy lifetime: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.current) {
                            energyService.getCharacteristic(Characteristic.Current)
                                .onGet(async () => {
                                    const value = sensor.current;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} current: ${value} A`);
                                    return value;
                                });
                        }
                        if (sensor.voltage) {
                            energyService.getCharacteristic(Characteristic.Voltage)
                                .onGet(async () => {
                                    const value = sensor.voltage;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} voltage: ${value} V`);
                                    return value;
                                });
                        }
                        if (sensor.factor) {
                            energyService.getCharacteristic(Characteristic.Factor)
                                .onGet(async () => {
                                    const value = sensor.factor;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} power factor: ${value} cos φ`);
                                    return value;
                                });
                        }
                        if (sensor.frequency) {
                            energyService.getCharacteristic(Characteristic.Freqency)
                                .onGet(async () => {
                                    const value = sensor.frequency;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} frequency: ${value} Hz`);
                                    return value;
                                });
                        }
                        if (sensor.time) {
                            energyService.getCharacteristic(Characteristic.ReadingTime)
                                .onGet(async () => {
                                    const value = sensor.time;
                                    const info = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} last report: ${value}`);
                                    return value;
                                });
                        }
                        this.sensorEnergyServices.push(energyService);
                    }
                    i++;
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
export default Sensors;
