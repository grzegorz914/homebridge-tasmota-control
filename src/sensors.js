import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import Functions from './functions.js';
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
        this.functions = new Functions();

        //sensors
        this.sensorsCount = 0;

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
            //sensor status
            const sensorStatusData = await this.axiosInstance.get(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`);

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

                let i = 0;
                for (const [key, value] of Object.entries(sensorData)) {
                    const sensorData = value;

                    const obj = {
                        name: key,
                        time: statusSns.Time,
                        tempUnit: statusSns.TempUnit === 'C' ? '°C' : statusSns.TempUnit,
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
                        motion: sensorData.Motion,
                    };

                    const energy = {
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
                        load: sensorData.Load
                    };

                    const isEnergy = key === 'ENERGY';
                    const sensor = isEnergy ? { ...obj, ...energy } : obj;
                    this.sensors.push(sensor);

                    //update characteristics
                    const servicesMap = [
                        [this.temperatureServices?.[i], Characteristic.CurrentTemperature, sensor.temperature],
                        [this.temperatureReferenceServices?.[i], Characteristic.CurrentTemperature, sensor.referenceTemperature],
                        [this.temperatureObjServices?.[i], Characteristic.CurrentTemperature, sensor.objTemperature],
                        [this.temperatureAmbServices?.[i], Characteristic.CurrentTemperature, sensor.ambTemperature],
                        [this.temperatureDewPointServices?.[i], Characteristic.CurrentTemperature, sensor.dewPointTemperature],
                        [this.humidityServices?.[i], Characteristic.CurrentRelativeHumidity, sensor.humidity],
                        [this.carbonDioxydeServices?.[i], Characteristic.CarbonDioxideDetected, sensor.carbonDioxyde > 1000],
                        [this.carbonDioxydeServices?.[i], Characteristic.CarbonDioxideLevel, sensor.carbonDioxyde],
                        [this.carbonDioxydeServices?.[i], Characteristic.CarbonDioxidePeakLevel, sensor.carbonDioxyde],
                        [this.ambientLightServices?.[i], Characteristic.CurrentAmbientLightLevel, sensor.ambientLight],
                        [this.motionServices?.[i], Characteristic.MotionDetected, sensor.motion],
                    ];

                    for (const [service, charType, value] of servicesMap) {
                        const characteristic = service?.getCharacteristic(charType);
                        if (!characteristic) {
                            continue;
                        }
                        service.updateCharacteristic(charType, value);
                    }

                    // energy
                    if (isEnergy) {
                        const energyMap = [
                            [this.powerAndEnergyServices?.[i], Characteristic.Power, sensor.power],
                            [this.powerAndEnergyServices?.[i], Characteristic.ApparentPower, sensor.apparentPower],
                            [this.powerAndEnergyServices?.[i], Characteristic.ReactivePower, sensor.reactivePower],
                            [this.powerAndEnergyServices?.[i], Characteristic.EnergyToday, sensor.energyToday],
                            [this.powerAndEnergyServices?.[i], Characteristic.EnergyLastDay, sensor.energyLastDay],
                            [this.powerAndEnergyServices?.[i], Characteristic.EnergyLifetime, sensor.energyLifetime],
                            [this.powerAndEnergyServices?.[i], Characteristic.Current, sensor.current],
                            [this.powerAndEnergyServices?.[i], Characteristic.Voltage, sensor.voltage],
                            [this.powerAndEnergyServices?.[i], Characteristic.Factor, sensor.factor],
                            [this.powerAndEnergyServices?.[i], Characteristic.Frequency, sensor.frequency],
                            [this.powerAndEnergyServices?.[i], Characteristic.ReadingTime, sensor.time],
                        ];

                        for (const [service, charType, value] of energyMap) {
                            const characteristic = service?.getCharacteristic(charType);
                            if (!characteristic) {
                                continue;
                            }
                            service.updateCharacteristic(charType, value);
                        }
                    }

                    if (this.enableDebugMode) this.emit('debug', `Sensor: ${JSON.stringify(sensor, null, 2)}`);
                    i++;
                }

                this.sensorsCount = this.sensors.length;
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
        this.emit('devInfo', `Sensor: ${this.info.sensorName}`);
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
            const accessoryCategory = Categories.SENSOR;
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
            if (this.sensorsCount > 0) {
                if (this.enableDebugMode) this.emit('debug', `Prepare Sensor Services`);
                this.temperatureServices = [];
                this.temperatureReferenceServices = [];
                this.temperatureObjServices = [];
                this.temperatureAmbServices = [];
                this.temperatureDewPointServices = [];
                this.humidityServices = [];
                this.carbonDioxydeServices = [];
                this.ambientLightServices = [];
                this.motionServices = [];
                this.powerAndEnergyServices = [];

                //temperature
                let i = 0;
                for (const sensor of this.sensors) {
                    const sensorName = sensor.name;
                    if (sensor.temperature) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Temperature Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                        const temperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                        temperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        temperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.temperature;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.temperatureServices.push(temperatureService);
                    }

                    //reference temperature
                    if (sensor.referenceTemperature) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Reference Temperature Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                        const temperatureReferenceService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                        temperatureReferenceService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        temperatureReferenceService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        temperatureReferenceService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.referenceTemperature;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} reference temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.temperatureReferenceServices.push(temperatureReferenceService);
                    }

                    //object temperature
                    if (sensor.objTemperature) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Obj Temperature Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                        const temperatureObjService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                        temperatureObjService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        temperatureObjService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        temperatureObjService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.objTemperature;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} obj temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.temperatureObjServices.push(temperatureObjService);
                    }

                    //ambient temperature
                    if (sensor.ambTemperature) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Amb Temperature Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                        const temperatureAmbService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                        temperatureAmbService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        temperatureAmbService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        temperatureAmbService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.ambTemperature;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} amb temperature: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.temperatureAmbServices.push(temperatureAmbService);
                    }

                    //dew point temperature
                    if (sensor.dewPointTemperature) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Dew Point Temperature Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                        const temperatureDewPointService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                        temperatureDewPointService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        temperatureDewPointService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        temperatureDewPointService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = sensor.dewPointTemperature;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} dew point: ${value} °${sensor.tempUnit}`);
                                return value;
                            });
                        this.temperatureDewPointServices.push(temperatureDewPointService);
                    }

                    //humidity
                    if (sensor.humidity) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Humidity Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                        const humidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                        humidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        humidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .onGet(async () => {
                                const value = sensor.humidity;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} humidity: ${value} %`);
                                return value;
                            });
                        this.humidityServices.push(humidityService);
                    }

                    //pressure

                    //gas

                    //carbon dioxyde
                    if (sensor.carbonDioxyde) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                        const carbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                        carbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        carbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        carbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                            .onGet(async () => {
                                const state = sensor.carbonDioxyde > 1000;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                return state;
                            });
                        carbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                            .onGet(async () => {
                                const value = sensor.carbonDioxyde;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                return value;
                            });
                        carbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                            .onGet(async () => {
                                const value = sensor.carbonDioxyde;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                return value;
                            });
                        this.carbonDioxydeServices.push(carbonDioxydeService);
                    }

                    //ambient light
                    if (sensor.ambientLight) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Ambient Light Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                        const ambientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                        ambientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        ambientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        ambientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                            .onGet(async () => {
                                const value = sensor.ambientLight;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} ambient light: ${value} lx`);
                                return value;
                            });
                        this.ambientLightServices.push(ambientLightService);
                    }

                    //motion
                    if (sensor.motion) {
                        if (this.enableDebugMode) this.emit('debug', `Prepare Motion Sensor Services`);
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                        const motionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                        motionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        motionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        motionService.getCharacteristic(Characteristic.MotionDetected)
                            .onGet(async () => {
                                const state = sensor.motion;
                                if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            });
                        this.motionServices.push(motionService);
                    }

                    //energy
                    if (sensor.name === 'ENERGY') {
                        const debug4 = this.enableDebugMode ? this.emit('debug', `Prepare Power And Energy Service`) : false;
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName}` : `${sensorName}`;
                        const powerAndEnergyService = accessory.addService(Service.PowerAndEnergy, serviceName, `Energy Sensor ${i}`);
                        powerAndEnergyService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        if (sensor.power) {
                            powerAndEnergyService.getCharacteristic(Characteristic.Power)
                                .onGet(async () => {
                                    const value = sensor.power;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} power: ${value} W`);
                                    return value;
                                });
                        }
                        if (sensor.apparentPower) {
                            powerAndEnergyService.getCharacteristic(Characteristic.ApparentPower)
                                .onGet(async () => {
                                    const value = sensor.apparentPower;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} apparent power: ${value} VA`);
                                    return value;
                                });
                        }
                        if (sensor.reactivePower) {
                            powerAndEnergyService.getCharacteristic(Characteristic.ReactivePower)
                                .onGet(async () => {
                                    const value = sensor.reactivePower;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} reactive power: ${value} VAr`);
                                    return value;
                                });
                        }
                        if (sensor.energyToday) {
                            powerAndEnergyService.getCharacteristic(Characteristic.EnergyToday)
                                .onGet(async () => {
                                    const value = sensor.energyToday;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} energy today: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.energyLastDay) {
                            powerAndEnergyService.getCharacteristic(Characteristic.EnergyLastDay)
                                .onGet(async () => {
                                    const value = sensor.energyLastDay;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} energy last day: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.energyLifetime) {
                            powerAndEnergyService.getCharacteristic(Characteristic.EnergyLifetime)
                                .onGet(async () => {
                                    const value = sensor.energyLifetime;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} energy lifetime: ${value} kWh`);
                                    return value;
                                });
                        }
                        if (sensor.current) {
                            powerAndEnergyService.getCharacteristic(Characteristic.Current)
                                .onGet(async () => {
                                    const value = sensor.current;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} current: ${value} A`);
                                    return value;
                                });
                        }
                        if (sensor.voltage) {
                            powerAndEnergyService.getCharacteristic(Characteristic.Voltage)
                                .onGet(async () => {
                                    const value = sensor.voltage;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} voltage: ${value} V`);
                                    return value;
                                });
                        }
                        if (sensor.factor) {
                            powerAndEnergyService.getCharacteristic(Characteristic.Factor)
                                .onGet(async () => {
                                    const value = sensor.factor;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} power factor: ${value} cos φ`);
                                    return value;
                                });
                        }
                        if (sensor.frequency) {
                            powerAndEnergyService.getCharacteristic(Characteristic.Freqency)
                                .onGet(async () => {
                                    const value = sensor.frequency;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} frequency: ${value} Hz`);
                                    return value;
                                });
                        }
                        if (sensor.time) {
                            powerAndEnergyService.getCharacteristic(Characteristic.ReadingTime)
                                .onGet(async () => {
                                    const value = sensor.time;
                                    if (!this.disableLogInfo) this.emit('info', `sensor: ${sensorName} last report: ${value}`);
                                    return value;
                                });
                        }
                        this.powerAndEnergyServices.push(powerAndEnergyService);
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
export default Sensors;
