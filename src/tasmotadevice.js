'use strict';
const fs = require('fs');
const fsPromises = fs.promises;
const axios = require('axios');
const EventEmitter = require('events');
const ImpulseGenerator = require('./impulsegenerator.js');
const CONSTANTS = require('./constants.json');
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class TasmotaDevice extends EventEmitter {
    constructor(api, config, defaultHeatingSetTemperatureFile, defaultCoolingSetTemperatureFile) {
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
        this.heatDryFanMode = config.heatDryFanMode || 1; //NONE, HEAT, DRY, FAN
        this.coolDryFanMode = config.coolDryFanMode || 1; //NONE, COOL, DRY, FAN
        this.autoDryFanMode = config.autoDryFanMode || 1; //NONE, AUTO, DRY, FAN
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.loadNameFromDevice = config.loadNameFromDevice || false;
        this.defaultHeatingSetTemperatureFile = defaultHeatingSetTemperatureFile;
        this.defaultCoolingSetTemperatureFile = defaultCoolingSetTemperatureFile;

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

        //mielhvac
        this.accessory = {};
        this.miElHvac = false;
        this.previousStateSwingV = 'auto';
        this.previousStateSwingH = 'center';

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
            await new Promise(resolve => setTimeout(resolve, 250));

            //status
            const friendlyNames = [];
            const status = deviceInfo.Status ?? {};
            const deviceName = this.loadNameFromDevice ? status.DeviceName ?? 'Unknown' : this.name;
            const friendlyName = status.FriendlyName ?? [];
            const relaysName = Array.isArray(friendlyName) ? friendlyName : [friendlyName];
            for (const relayName of relaysName) {
                const name = relayName ?? 'Unknown'
                friendlyNames.push(name);
            };

            //status fwr
            const statusFwr = deviceInfo.StatusFWR ?? {};
            const firmwareRevision = statusFwr.Version ?? 'Unknown';
            const modelName = statusFwr.Hardware ?? 'Unknown';

            //status net
            const statusNet = deviceInfo.StatusNET ?? {};
            const addressMac = statusNet.Mac ?? false;

            //status sns
            const statusSns = deviceInfo.StatusSNS ?? {};
            const statusSnsKeys = Object.keys(statusSns);
            this.miElHvac = statusSnsKeys.includes('MiElHVAC');

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

            //status
            const statusData = await this.axiosInstance(CONSTANTS.ApiCommands.Status);
            const status = statusData.data ?? {};
            const debug1 = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(status, null, 2)}`) : false;

            //status sns
            const statusKeys = Object.keys(status);
            const statusSNSSupported = statusKeys.includes('StatusSNS') ?? false;

            //mitsubishi hvac
            switch (this.miElHvac) {
                case true:
                    //power
                    const powersStatusData = await this.axiosInstance(CONSTANTS.ApiCommands.PowerStatus);
                    const powersStatus = powersStatusData.data ?? {};
                    const debug = this.enableDebugMode ? this.emit('debug', `Power status: ${JSON.stringify(powersStatus, null, 2)}`) : false;

                    //power
                    const power1 = powersStatus.POWER == 'ON' ?? false;

                    //status sns
                    const statusSNS = status.StatusSNS ?? {};
                    const temperatureUnit = statusSNS.TempUnit === 'C' ? '°C' : 'F';

                    //mielhvac
                    const miElHvacStatus = statusSNS.MiElHVAC ?? {};
                    const power = miElHvacStatus.Power === 'ON' ? 1 : 0;
                    const roomTemperature = miElHvacStatus.Temperature ?? 0;
                    const setTemperature = miElHvacStatus.SetTemperature ?? 0;
                    const operationMode = miElHvacStatus.Mode ?? 'Unknown';
                    const fanSpeed = miElHvacStatus.FanSpeed ?? 'Unknown';
                    const vaneVerticalDirection = miElHvacStatus.SwingV ?? 'Unknown';
                    const vaneHorizontalDirection = miElHvacStatus.SwingH ?? 'Unknown';
                    const operation = miElHvacStatus.Operation == 'ON' ?? false;
                    const compressor = miElHvacStatus.Compressor == 'ON' ?? false;
                    const swingMode = vaneVerticalDirection == 'swing' && vaneHorizontalDirection === 'swing' ? 1 : 0;
                    const defaultCoolingSetTemperature = parseFloat(await this.readData(this.defaultCoolingSetTemperatureFile));
                    const defaultHeatingSetTemperature = parseFloat(await this.readData(this.defaultHeatingSetTemperatureFile));
                    const modelSupportsHeat = true;
                    const modelSupportsDry = true;
                    const modelSupportsCool = true;
                    const modelSupportsAuto = true;
                    const modelSupportsFanSpeed = true;
                    const hasAutomaticFanSpeed = true;
                    const numberOfFanSpeeds = 5;
                    const lockPhysicalControl = 0;
                    const useFahrenheit = temperatureUnit === 'F' ?? false
                    const temperatureIncrement = 0.5;

                    this.accessory = {
                        power: power,
                        roomTemperature: roomTemperature,
                        setTemperature: setTemperature,
                        operationMode: operationMode,
                        vaneVerticalDirection: vaneVerticalDirection,
                        vaneHorizontalDirection: vaneHorizontalDirection,
                        operation: operation,
                        compressor: compressor,
                        swingMode: swingMode,
                        defaultCoolingSetTemperature: defaultCoolingSetTemperature,
                        defaultHeatingSetTemperature: defaultHeatingSetTemperature,
                        modelSupportsHeat: modelSupportsHeat,
                        modelSupportsDry: modelSupportsDry,
                        modelSupportsCool: modelSupportsCool,
                        modelSupportsAuto: modelSupportsAuto,
                        modelSupportsFanSpeed: modelSupportsFanSpeed,
                        hasAutomaticFanSpeed: hasAutomaticFanSpeed,
                        numberOfFanSpeeds: numberOfFanSpeeds,
                        lockPhysicalControl: lockPhysicalControl,
                        temperatureUnit: temperatureUnit,
                        useFahrenheit: useFahrenheit,
                        temperatureIncrement: temperatureIncrement
                    };


                    //operating mode
                    switch (operationMode) {
                        case 'heat':
                            this.accessory.currentOperationMode = roomTemperature > setTemperature ? 1 : 2; //INACTIVE, IDLE, HEATING, COOLING
                            this.accessory.targetOperationMode = 1; //AUTO, HEAT, COOL
                            break;
                        case 'dry':
                            this.accessory.currentOperationMode = 1;
                            this.accessory.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : this.accessory.targetOperationMode ?? 0;
                            break;
                        case 'cool':
                            this.accessory.currentOperationMode = roomTemperature < setTemperature ? 1 : 3;
                            this.accessory.targetOperationMode = 2;
                            break;
                        case 'fan_only':
                            this.accessory.currentOperationMode = 1;
                            this.accessory.targetOperationMode = this.autoDryFanMode === 3 ? 0 : this.heatDryFanMode === 3 ? 1 : this.coolDryFanMode === 3 ? 2 : this.accessory.targetOperationMode ?? 0;
                            break;
                        case 'auto':
                            this.accessory.currentOperationMode = roomTemperature > setTemperature ? 3 : roomTemperature < setTemperature ? 2 : 1;
                            this.accessory.targetOperationMode = 0;
                            break;
                        case 'heat_isee':
                            this.accessory.currentOperationMode = roomTemperature > setTemperature ? 1 : 2
                            this.accessory.targetOperationMode = 1;
                            break;
                        case 'dry_isee':
                            this.accessory.currentOperationMode = 1;
                            this.accessory.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : this.accessory.targetOperationMode ?? 0;
                            break;
                        case 'cool_isee':
                            this.accessory.currentOperationMode = roomTemperature < setTemperature ? 1 : 3;
                            this.accessory.targetOperationMode = 2;
                            break;
                        default:
                            this.emit('warn', `Unknown operating mode: ${operationMode}`);
                            return
                    };

                    this.accessory.currentOperationMode = !power ? 0 : !operation ? 1 : this.accessory.currentOperationMode;
                    this.accessory.operationModeSetPropsMinValue = modelSupportsAuto && modelSupportsHeat ? 0 : !modelSupportsAuto && modelSupportsHeat ? 1 : modelSupportsAuto && !modelSupportsHeat ? 0 : 2;
                    this.accessory.operationModeSetPropsMaxValue = 2
                    this.accessory.operationModeSetPropsValidValues = modelSupportsAuto && modelSupportsHeat ? [0, 1, 2] : !modelSupportsAuto && modelSupportsHeat ? [1, 2] : modelSupportsAuto && !modelSupportsHeat ? [0, 2] : [2];

                    //fan speed mode
                    const fanSpeedMap = {
                        'auto': 0,
                        'quit': 1,
                        '1': 2,
                        '2': 3,
                        '3': 4,
                        '4': 5,
                    };
                    if (modelSupportsFanSpeed) {
                        switch (numberOfFanSpeeds) {
                            case 2: //Fan speed mode 2
                                this.accessory.fanSpeed = hasAutomaticFanSpeed ? [3, 1, 2][fanSpeedMap[fanSpeed]] : [0, 1, 2][fanSpeedMap[fanSpeed]];
                                this.accessory.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 3 : 2;
                                break;
                            case 3: //Fan speed mode 3
                                this.accessory.fanSpeed = hasAutomaticFanSpeed ? [4, 1, 2, 3][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3][fanSpeedMap[fanSpeed]];
                                this.accessory.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 4 : 3;
                                break;
                            case 4: //Fan speed mode 4
                                this.accessory.fanSpeed = hasAutomaticFanSpeed ? [5, 1, 2, 3, 4][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3, 4][fanSpeedMap[fanSpeed]];
                                this.accessory.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 5 : 4;
                                break;
                            case 5: //Fan speed mode 5
                                this.accessory.fanSpeed = hasAutomaticFanSpeed ? [6, 1, 2, 3, 4, 5][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3, 4, 5][fanSpeedMap[fanSpeed]];
                                this.accessory.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 6 : 5;
                                break;
                        };
                    };

                    //update characteristics
                    if (this.miElHvacService) {
                        this.miElHvacService
                            .updateCharacteristic(Characteristic.Active, power)
                            .updateCharacteristic(Characteristic.CurrentHeaterCoolerState, this.accessory.currentOperationMode)
                            .updateCharacteristic(Characteristic.TargetHeaterCoolerState, this.accessory.targetOperationMode)
                            .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature)
                            .updateCharacteristic(Characteristic.LockPhysicalControls, lockPhysicalControl)
                            .updateCharacteristic(Characteristic.TemperatureDisplayUnits, useFahrenheit)
                            .updateCharacteristic(Characteristic.SwingMode, swingMode);
                        const updateDefCool = operationMode === 'auto' || operationMode === 'cool' ? this.miElHvacService.updateCharacteristic(Characteristic.CoolingThresholdTemperature, operationMode === 'auto' ? defaultCoolingSetTemperature : setTemperature) : false;
                        const updateDefHeat = operationMode === 'auto' || operationMode === 'heat' ? this.miElHvacService.updateCharacteristic(Characteristic.HeatingThresholdTemperature, operationMode === 'auto' ? defaultHeatingSetTemperature : setTemperature) : false;
                        const updateRS = modelSupportsFanSpeed ? this.miElHvacService.updateCharacteristic(Characteristic.RotationSpeed, this.accessory.fanSpeed) : false;
                    };

                    //log current state
                    if (!this.disableLogInfo) {
                        this.emit('message', `Power: ${power ? 'ON' : 'OFF'}`);
                        this.emit('message', `Target operation mode: ${CONSTANTS.AirConditioner.DriveMode[this.accessory.targetOperationMode]}`);
                        this.emit('message', `Current operation mode: ${CONSTANTS.AirConditioner.CurrentOperationMode[this.accessory.currentOperationMode]}`);
                        this.emit('message', `Target temperature: ${setTemperature}${temperatureUnit}`);
                        this.emit('message', `Current temperature: ${roomTemperature}${temperatureUnit}`);
                        const info4 = modelSupportsFanSpeed ? this.emit('message', `Fan speed: ${CONSTANTS.AirConditioner.FanSpeed[fanSpeedMap[fanSpeed]]}`) : false;
                        const info5 = vaneHorizontalDirection !== 'Unknown' ? this.emit('message', `Vane horizontal: ${CONSTANTS.AirConditioner.HorizontalVane[vaneHorizontalDirection] ?? vaneHorizontalDirection}`) : false;
                        const info6 = vaneVerticalDirection !== 'Unknown' ? this.emit('message', `Vane vertical: ${CONSTANTS.AirConditioner.VerticalVane[vaneVerticalDirection] ?? vaneVerticalDirection}`) : false;
                        const info7 = this.emit('message', `Air direction: ${CONSTANTS.AirConditioner.AirDirection[swingMode]}`);
                        this.emit('message', `Temperature display unit: ${temperatureUnit}`);
                        this.emit('message', `Lock physical controls: ${lockPhysicalControl ? 'LOCKED' : 'UNLOCKED'}`);
                    };
                    break;
                case false:
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

                    //status sns
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
                        const sensor = Object.entries(status.StatusSNS)
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

                        this.time = status.Time ?? '';
                        this.tempUnit = status.TempUnit ?? 'C';
                        this.pressureUnit = status.PressureUnit ?? 'hPa';
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
                    break;
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
        const log = this.miElHvac ? this.emit('devInfo', `Sensor: MiELHVAC`) : false;
        const log1 = !this.miElHvac && this.relaysCount > 0 ? this.emit('devInfo', `Relays: ${this.relaysCount}`) : false;
        const log2 = !this.miElHvac && this.sensorsCount > 0 ? this.emit('devInfo', `Sensors: ${this.sensorsCount}`) : false;
        this.emit('devInfo', `----------------------------------`);
    };

    async saveData(path, data) {
        try {
            data = JSON.stringify(data, null, 2);
            await fsPromises.writeFile(path, data);
            const debug = !this.enableDebugMode ? false : this.emit('debug', `Saved data: ${data}`);
            return true;
        } catch (error) {
            throw new Error(`Save data error: ${error.message ?? error}`);
        };
    }

    async readData(path) {
        try {
            const data = await fsPromises.readFile(path);
            return data;
        } catch (error) {
            throw new Error(`Read data error: ${error.message ?? error}`);
        };
    }

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

            switch (this.miElHvac) {
                case true:
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare mitsubishi hvac service`) : false;
                    const autoDryFanMode = [CONSTANTS.ApiCommands.HVACSetMode.Auto, CONSTANTS.ApiCommands.HVACSetMode.Auto, CONSTANTS.ApiCommands.HVACSetMode.Dry, CONSTANTS.ApiCommands.HVACSetMode.Fan][this.autoDryFanMode]; //NONE, AUTO, DRY, FAN
                    const heatDryFanMode = [CONSTANTS.ApiCommands.HVACSetMode.Heat, CONSTANTS.ApiCommands.HVACSetMode.Heat, CONSTANTS.ApiCommands.HVACSetMode.Dry, CONSTANTS.ApiCommands.HVACSetMode.Fan][this.heatDryFanMode]; //NONE, HEAT, DRY, FAN
                    const coolDryFanMode = [CONSTANTS.ApiCommands.HVACSetMode.Cool, CONSTANTS.ApiCommands.HVACSetMode.Cool, CONSTANTS.ApiCommands.HVACSetMode.Dry, CONSTANTS.ApiCommands.HVACSetMode.Fan][this.coolDryFanMode]; //NONE, COOL, DRY, FAN

                    //services
                    this.miElHvacService = new Service.HeaterCooler(accessoryName, `HeaterCooler ${this.serialNumber}`);
                    this.miElHvacService.getCharacteristic(Characteristic.Active)
                        .onGet(async () => {
                            const state = this.accessory.power;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                const power = [CONSTANTS.ApiCommands.PowerOff, CONSTANTS.ApiCommands.PowerOn][state];
                                await this.axiosInstance(power);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set power: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `Set power error: ${error}`);
                            };
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
                        .onGet(async () => {
                            const value = this.accessory.currentOperationMode;
                            return value;
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                        .setProps({
                            minValue: this.accessory.operationModeSetPropsMinValue,
                            maxValue: this.accessory.operationModeSetPropsMaxValue,
                            validValues: this.accessory.operationModeSetPropsValidValues
                        })
                        .onGet(async () => {
                            const value = this.accessory.targetOperationMode; //1 = HEAT, 2 = DRY 3 = COOL, 7 = FAN, 8 = AUTO
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                switch (value) {
                                    case 0: //AUTO
                                        await this.axiosInstance(autoDryFanMode);
                                        break;
                                    case 1: //HEAT
                                        await this.axiosInstance(heatDryFanMode);
                                        break;
                                    case 2: //COOL
                                        await this.axiosInstance(coolDryFanMode);
                                        break;
                                };

                                const info = this.disableLogInfo ? false : this.emit('message', `Set operation mode: ${CONSTANTS.AirConditioner.DriveMode[value]}`);
                            } catch (error) {
                                this.emit('warn', `Set operation mode error: ${error}`);
                            };
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.CurrentTemperature)
                        .onGet(async () => {
                            const value = this.accessory.roomTemperature;
                            return value;
                        });
                    if (this.accessory.modelSupportsFanSpeed) {
                        this.miElHvacService.getCharacteristic(Characteristic.RotationSpeed)
                            .setProps({
                                minValue: 0,
                                maxValue: this.accessory.fanSpeedSetPropsMaxValue,
                                minStep: 1
                            })
                            .onGet(async () => {
                                const value = this.accessory.fanSpeed; //AUTO, 1, 2, 3, 4, 5
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    let fanSpeedModeText = 0; //AUTO, 1, 2, 3, 4, 5
                                    let fanSpeed = 0;
                                    switch (this.accessory.numberOfFanSpeeds) {
                                        case 2: //Fan speed mode 2
                                            fanSpeed = this.accessory.hasAutomaticFanSpeed ? [0, 1, 2, 0][value] : [1, 1, 2][value];
                                            fanSpeedModeText = this.accessory.hasAutomaticFanSpeed ? [7, 1, 2, 0][value] : [7, 1, 2][value];
                                            break;
                                        case 3: //Fan speed mode 3
                                            fanSpeed = this.accessory.hasAutomaticFanSpeed ? [0, 1, 2, 3, 0][value] : [1, 1, 2, 3][value];
                                            fanSpeedModeText = this.accessory.hasAutomaticFanSpeed ? [7, 1, 2, 3, 0][value] : [7, 1, 2, 3][value];
                                            break;
                                        case 4: //Fan speed mode 4
                                            fanSpeed = this.accessory.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 0][value] : [1, 1, 2, 3, 4][value];
                                            fanSpeedModeText = this.accessory.hasAutomaticFanSpeed ? [7, 1, 2, 3, 4, 0][value] : [7, 1, 2, 3, 4][value];
                                            break;
                                        case 5: //Fan speed mode 5
                                            fanSpeed = this.accessory.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 5, 0][value] : [1, 1, 2, 3, 4, 5][value];
                                            fanSpeedModeText = this.accessory.hasAutomaticFanSpeed ? [7, 1, 2, 3, 4, 5, 0][value] : [7, 1, 2, 3, 4, 5][value];
                                            break;
                                    };

                                    await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetFanSpeed[fanSpeed]);
                                    const info = this.disableLogInfo ? false : this.emit('message', `Set fan speed mode: ${CONSTANTS.AirConditioner.FanSpeed[fanSpeedModeText]}`);
                                } catch (error) {
                                    this.emit('warn', `Set fan speed mode error: ${error}`);
                                };
                            });
                    };
                    if (this.accessory.swingMode) {
                        this.miElHvacService.getCharacteristic(Characteristic.SwingMode)
                            .onGet(async () => {
                                const value = this.accessory.swingMode;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    switch (value) {
                                        case 0:
                                            await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetSwingV[this.previousStateSwingV]);
                                            await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetSwingH[this.previousStateSwingH]);
                                            break;
                                        case 1:
                                            //set vane v
                                            this.previousStateSwingV = this.accessory.vaneVerticalDirection;
                                            await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetSwingV.Swing);

                                            //set vane h
                                            this.previousStateSwingH = this.accessory.vaneHorizontalDirection;
                                            await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetSwingH.Swing);
                                            break;
                                    }
                                    const info = this.disableLogInfo ? false : this.emit('message', `Set air direction mode: ${CONSTANTS.AirConditioner.AirDirection[value]}`);
                                } catch (error) {
                                    this.emit('warn', `Set vane swing mode error: ${error}`);
                                };
                            });
                    };
                    this.miElHvacService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                        .setProps({
                            minValue: 16,
                            maxValue: 31,
                            minStep: this.accessory.temperatureIncrement
                        })
                        .onGet(async () => {
                            const value = this.accessory.operationMode === 'auto' ? this.accessory.defaultCoolingSetTemperature : this.accessory.setTemperature;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                if (this.accessory.operationMode === 'auto') {
                                    await this.saveData(this.defaultCoolingSetTemperatureFile, value);
                                    value = (value + this.accessory.defaultHeatingSetTemperature) / 2;
                                }

                                const temp = `${CONSTANTS.ApiCommands.HVACSetTemp}${value}`
                                await this.axiosInstance(temp);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set ${this.accessory.operationMode === 'auto' ? 'cooling threshold temperature' : 'temperature'}: ${value}${this.accessory.temperatureUnit}`);
                            } catch (error) {
                                this.emit('warn', `Set cooling threshold temperature error: ${error}`);
                            };
                        });
                    if (this.accessory.modelSupportsHeat) {
                        this.miElHvacService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                            .setProps({
                                minValue: 10,
                                maxValue: 31,
                                minStep: this.accessory.temperatureIncrement
                            })
                            .onGet(async () => {
                                const value = this.accessory.operationMode === 'auto' ? this.accessory.defaultHeatingSetTemperature : this.accessory.setTemperature;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    if (this.accessory.operationMode === 'auto') {
                                        await this.saveData(this.defaultHeatingSetTemperatureFile, value);
                                        value = (value + this.accessory.defaultCoolingSetTemperature) / 2;
                                    }

                                    const temp = `${CONSTANTS.ApiCommands.HVACSetTemp}${value}`
                                    await this.axiosInstance(temp);
                                    const info = this.disableLogInfo ? false : this.emit('message', `Set ${this.accessory.operationMode === 'auto' ? 'heating threshold temperature' : 'temperature'}: ${value}${this.accessory.temperatureUnit}`);
                                } catch (error) {
                                    this.emit('warn', `Set heating threshold temperature error: ${error}`);
                                };
                            });
                    };
                    this.miElHvacService.getCharacteristic(Characteristic.LockPhysicalControls)
                        .onGet(async () => {
                            const value = this.accessory.lockPhysicalControl;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                //await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetLockControl);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set local physical controls: ${value ? 'LOCK' : 'UNLOCK'}`);
                            } catch (error) {
                                this.emit('warn', `Set lock physical controls error: ${error}`);
                            };
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                        .onGet(async () => {
                            const value = this.accessory.useFahrenheit;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                // await this.axiosInstance(CONSTANTS.ApiCommands.HVACSetTemp);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set temperature display unit: ${CONSTANTS.TemperatureDisplayUnits[value]}`);
                            } catch (error) {
                                this.emit('warn', `Set temperature display unit error: ${error}`);
                            };
                        });
                    accessory.addService(this.miElHvacService);
                    break;
                case false:
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
                    break;
            };

            return accessory;
        } catch (error) {
            throw new Error(`Prepare accessory error: ${error.message || error}`)
        };
    }
};
module.exports = TasmotaDevice;
