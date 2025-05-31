import { promises as fsPromises } from 'fs';
import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import { ApiCommands, MiElHVAC, TemperatureDisplayUnits } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class MiElHvac extends EventEmitter {
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

        //mitsubishi ac
        const miElHvac = config.miElHvac ?? {};
        this.heatDryFanMode = miElHvac.heatDryFanMode || 1; //NONE, HEAT, DRY, FAN
        this.coolDryFanMode = miElHvac.coolDryFanMode || 1; //NONE, COOL, DRY, FAN
        this.autoDryFanMode = miElHvac.autoDryFanMode || 1; //NONE, COOL, DRY, FAN

        //external sensor
        const remoteTemperatureSensor = miElHvac.remoteTemperatureSensor ?? {};
        const remoteTemperatureSensorEnable = remoteTemperatureSensor.enable || false;
        const remoteTemperatureSensorPath = remoteTemperatureSensor.path;
        const remoteTemperatureSensorRefreshInterval = remoteTemperatureSensor.refreshInterval * 1000 || 5000;
        const remoteTemperatureSensorAuth = remoteTemperatureSensor.auth || false;
        const remoteTemperatureSensorUser = remoteTemperatureSensor.user;
        const remoteTemperatureSensorPasswd = remoteTemperatureSensor.passwd;
        this.remoteTemperatureSensorEnable = remoteTemperatureSensorEnable;
        this.remoteTemperatureSensorRefreshInterval = remoteTemperatureSensorRefreshInterval;

        //presets
        const presets = miElHvac.presets || [];
        this.presetsConfigured = [];
        for (const preset of presets) {
            const displayType = preset.displayType ?? 0;
            if (displayType === 0) {
                continue;
            }

            const presetyServiceType = ['', Service.Outlet, Service.Switch, Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][displayType];
            const presetCharacteristicType = ['', Characteristic.On, Characteristic.On, Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][displayType];
            preset.serviceType = presetyServiceType;
            preset.characteristicType = presetCharacteristicType;
            preset.name = preset.name || 'Preset';
            preset.state = false;
            preset.previousSettings = {};
            this.presetsConfigured.push(preset);
        }
        this.presetsConfiguredCount = this.presetsConfigured.length || 0;

        //buttons
        const buttons = miElHvac.buttons || [];
        this.buttonsConfigured = [];
        for (const button of buttons) {
            const displayType = button.displayType ?? 0;
            if (displayType === 0) {
                continue;
            }

            const buttonServiceType = ['', Service.Outlet, Service.Switch][displayType];
            const buttonCharacteristicType = ['', Characteristic.On, Characteristic.On][displayType];
            button.serviceType = buttonServiceType;
            button.characteristicType = buttonCharacteristicType;
            button.name = button.name || 'Button';
            button.state = false;
            button.previousValue = null;
            this.buttonsConfigured.push(button);
        }
        this.buttonsConfiguredCount = this.buttonsConfigured.length || 0;

        //sensors
        const sensors = miElHvac.sensors || [];
        this.sensorsConfigured = [];
        for (const sensor of sensors) {
            const displayType = sensor.displayType ?? 0;
            if (displayType === 0) {
                continue;
            }

            const sensorServiceType = ['', Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][displayType];
            const sensorCharacteristicType = ['', Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][displayType];
            sensor.serviceType = sensorServiceType;
            sensor.characteristicType = sensorCharacteristicType;
            sensor.name = sensor.name || 'Sensor';
            sensor.state = false;
            sensor.previousValue = null;
            this.sensorsConfigured.push(sensor);
        }
        this.sensorsConfiguredCount = this.sensorsConfigured.length || 0;

        //frost protect
        const frostProtect = miElHvac.frostProtect ?? {};
        this.frostProtectEnable = frostProtect.enable || false;
        this.frostProtectLowTemp = frostProtect.lowTemp || 14;
        this.frostProtectHighTemp = frostProtect.highTemp || 16;
        this.frostProtectActive = false;

        //extra sensors
        this.temperatureSensor = miElHvac.temperatureSensor || false;
        this.temperatureSensorOutdoor = miElHvac.temperatureSensorOutdoor || false;

        //other config
        this.sensorsNamePrefix = config.sensorsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.refreshInterval = refreshInterval;

        //variable
        this.startPrepareAccessory = true;

        //mielhvac
        this.mielHvac = {};
        this.previousStateSwingV = 'auto';
        this.previousStateSwingH = 'center';

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

        //axios instance remote temp
        if (remoteTemperatureSensorEnable) {
            const path = remoteTemperatureSensorPath;
            this.axiosInstanceRemoteTemp = axios.create({
                method: 'GET',
                baseURL: path,
                timeout: remoteTemperatureSensorRefreshInterval > 10000 ? 10000 : remoteTemperatureSensorRefreshInterval,
                withCredentials: remoteTemperatureSensorAuth,
                auth: {
                    username: remoteTemperatureSensorUser,
                    password: remoteTemperatureSensorPasswd
                }
            });
        }

        //impulse generator
        this.impulseGenerator = new ImpulseGenerator();
        this.impulseGenerator.on('checkDeviceState', async () => {
            try {
                await this.checkDeviceState();
            } catch (error) {
                this.emit('error', `Impulse generator error: ${error}`);
            }
        }).on('updateRemoteTemp', async () => {
            try {
                await this.updateRemoteTemp();
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

            //power
            const power1 = powerStatus.POWER == 'ON' ? 1 : 0;

            //status SNS
            const time = statusSns.Time ?? '';
            const temperatureUnit = statusSns.TempUnit === 'C' ? '°C' : 'F';

            //mielhvac
            const miElHvac = statusSns.MiElHVAC ?? {};
            const power = miElHvac.Power === 'on' ? 1 : 0;
            const roomTemperature = miElHvac.Temperature ?? null;
            const outdoorTemperature = miElHvac.OutdoorTemperature ?? null;
            const setTemperature = miElHvac.SetTemperature;
            const operationMode = miElHvac.Mode ?? 'Unknown';
            const operationModeStage = miElHvac.ModeStage ?? 'Unknown';
            const fanSpeed = miElHvac.FanSpeed ?? 'Unknown';
            const fanSpeedStage = miElHvac.FanStage ?? 'Unknown';
            const vaneVerticalDirection = miElHvac.SwingV ?? 'Unknown';
            const vaneHorizontalDirection = miElHvac.SwingH ?? 'Unknown';
            const prohibit = miElHvac.Prohibit ?? 'Unknown';
            const airDirection = miElHvac.AirDirection ?? 'Unknown';
            const compressor = miElHvac.Compressor ?? 'Unknown';
            const compressorFrequency = miElHvac.CompressorFrequency ?? 0;
            const operationPower = miElHvac.OperationPower ?? 0;
            const operationEnergy = miElHvac.OperationEnergy ?? 0;
            const operationStage = miElHvac.OperationStage ?? 'Unknown';
            const swingMode = vaneVerticalDirection === 'swing' && vaneHorizontalDirection === 'swing' ? 1 : 0;
            const defaultCoolingSetTemperature = parseFloat(await this.readData(this.info.defaultCoolingSetTemperatureFile));
            const defaultHeatingSetTemperature = parseFloat(await this.readData(this.info.defaultHeatingSetTemperatureFile));
            const remoteTemperatureSensorState = miElHvac.RemoteTemperatureSensorState ?? false; //ON, OFF
            const remoteTemperatureSensorAutoClearTime = miElHvac.RemoteTemperatureSensorAutoClearTime ?? 0; //time in ms

            const modelSupportsHeat = true;
            const modelSupportsDry = true;
            const modelSupportsCool = true;
            const modelSupportsAuto = true;
            const modelSupportsFanSpeed = true;
            const hasAutomaticFanSpeed = true;
            const numberOfFanSpeeds = 5;
            const lockPhysicalControl = prohibit === 'all' ?? false;
            const useFahrenheit = temperatureUnit === 'F' ?? false;
            const temperatureIncrement = useFahrenheit ? 1 : 0.5;

            const hideDryModeControl = false;
            const hideVaneControls = false;

            const obj = {
                time: time,
                power: power,
                roomTemperature: roomTemperature,
                outdoorTemperature: outdoorTemperature,
                setTemperature: setTemperature,
                operationMode: operationMode,
                operationModeStage: operationModeStage,
                currentOperationMode: 0,
                targetOperationMode: 0,
                vaneVerticalDirection: vaneVerticalDirection,
                vaneHorizontalDirection: vaneHorizontalDirection,
                prohibit: prohibit,
                airDirection: airDirection,
                swingMode: swingMode,
                compressor: compressor,
                compressorFrequency: compressorFrequency,
                operationPower: operationPower,
                operationEnergy: operationEnergy,
                operationStage: operationStage,
                defaultCoolingSetTemperature: defaultCoolingSetTemperature,
                defaultHeatingSetTemperature: defaultHeatingSetTemperature,
                remoteTemperatureSensorState: remoteTemperatureSensorState,
                remoteTemperatureSensorAutoClearTime: remoteTemperatureSensorAutoClearTime,
                modelSupportsHeat: modelSupportsHeat,
                modelSupportsDry: modelSupportsDry,
                modelSupportsCool: modelSupportsCool,
                modelSupportsAuto: modelSupportsAuto,
                modelSupportsFanSpeed: modelSupportsFanSpeed,
                hasAutomaticFanSpeed: hasAutomaticFanSpeed,
                numberOfFanSpeeds: numberOfFanSpeeds,
                lockPhysicalControl: prohibit === 'all' ? 1 : 0,
                temperatureUnit: temperatureUnit,
                useFahrenheit: useFahrenheit,
                temperatureIncrement: temperatureIncrement,
                hideDryModeControl: hideDryModeControl,
                hideVaneControls: hideVaneControls
            };

            //operation mode
            const operationModeStageMap = {
                'manual': 0,
                'heat': 2,
                'dry': 1,
                'cool': 3,
                'fan': 1,
                'heat_isee': 2,
                'dry_isee': 1,
                'cool_isee': 3,
                'auto_fan': 1,
                'auto_heat': 2,
                'auto_cool': 3,
                'auto_leader': 4
            };
            switch (operationMode) {
                case 'heat':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][operationModeStageMap[operationModeStage]]; //INACTIVE, IDLE, HEATING, COOLING
                    obj.targetOperationMode = 1; //AUTO, HEAT, COOL
                    break;
                case 'dry':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : obj.targetOperationMode;
                    break;
                case 'cool':
                    obj.currentOperationMode = [3, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = 2;
                    break;
                case 'fan':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = this.autoDryFanMode === 3 ? 0 : this.heatDryFanMode === 3 ? 1 : this.coolDryFanMode === 3 ? 2 : obj.targetOperationMode;
                    break;
                case 'auto':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = 0;
                    break;
                case 'heat_isee':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = 1;
                    break;
                case 'dry_isee':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : obj.targetOperationMode;
                    break;
                case 'cool_isee':
                    obj.currentOperationMode = [3, 1, 2, 3, 0][operationModeStageMap[operationModeStage]];
                    obj.targetOperationMode = 2;
                    break;
                default:
                    this.emit('warn', `Unknown operating mode: ${operationMode}`);
                    return
            }

            obj.currentOperationMode = !power ? 0 : obj.currentOperationMode;
            obj.operationModeSetPropsMinValue = modelSupportsAuto && modelSupportsHeat ? 0 : !modelSupportsAuto && modelSupportsHeat ? 1 : modelSupportsAuto && !modelSupportsHeat ? 0 : 2;
            obj.operationModeSetPropsMaxValue = 2
            obj.operationModeSetPropsValidValues = modelSupportsAuto && modelSupportsHeat ? [0, 1, 2] : !modelSupportsAuto && modelSupportsHeat ? [1, 2] : modelSupportsAuto && !modelSupportsHeat ? [0, 2] : [2];

            if (modelSupportsFanSpeed) {
                //fan speed mode
                const fanSpeedMap = {
                    'auto': 0,
                    'quiet': 1,
                    '1': 2,
                    '2': 3,
                    '3': 4,
                    '4': 5
                };

                switch (numberOfFanSpeeds) {
                    case 2: //Fan speed mode 2
                        obj.fanSpeed = hasAutomaticFanSpeed ? [3, 1, 2][fanSpeedMap[fanSpeed]] : [0, 1, 2][fanSpeedMap[fanSpeed]];
                        obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 3 : 2;
                        break;
                    case 3: //Fan speed mode 3
                        obj.fanSpeed = hasAutomaticFanSpeed ? [4, 1, 2, 3][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3][fanSpeedMap[fanSpeed]];
                        obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 4 : 3;
                        break;
                    case 4: //Fan speed mode 4
                        obj.fanSpeed = hasAutomaticFanSpeed ? [5, 1, 2, 3, 4][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3, 4][fanSpeedMap[fanSpeed]];
                        obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 5 : 4;
                        break;
                    case 5: //Fan speed mode 5
                        obj.fanSpeed = hasAutomaticFanSpeed ? [6, 1, 2, 3, 4, 5][fanSpeedMap[fanSpeed]] : [0, 1, 2, 3, 4, 5][fanSpeedMap[fanSpeed]];
                        obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 6 : 5;
                        break;
                }
            }
            this.mielHvac = obj;

            //update characteristics
            if (this.miElHvacService) {
                this.miElHvacService
                    .updateCharacteristic(Characteristic.Active, power)
                    .updateCharacteristic(Characteristic.CurrentHeaterCoolerState, obj.currentOperationMode)
                    .updateCharacteristic(Characteristic.TargetHeaterCoolerState, obj.targetOperationMode)
                    .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature)
                    .updateCharacteristic(Characteristic.LockPhysicalControls, lockPhysicalControl)
                    .updateCharacteristic(Characteristic.TemperatureDisplayUnits, useFahrenheit)
                    .updateCharacteristic(Characteristic.SwingMode, swingMode);
                const updateDefCool = obj.targetOperationMode === 0 || obj.targetOperationMode === 2 ? this.miElHvacService.updateCharacteristic(Characteristic.CoolingThresholdTemperature, obj.targetOperationMode === 0 ? defaultCoolingSetTemperature : setTemperature) : false;
                const updateDefHeat = obj.targetOperationMode === 0 || obj.targetOperationMode === 1 ? this.miElHvacService.updateCharacteristic(Characteristic.HeatingThresholdTemperature, obj.targetOperationMode === 0 ? defaultHeatingSetTemperature : setTemperature) : false;
                const updateRS = modelSupportsFanSpeed ? this.miElHvacService.updateCharacteristic(Characteristic.RotationSpeed, obj.fanSpeed) : false;

                if (this.frostProtectEnable) {
                    if (roomTemperature <= this.frostProtectLowTemp && !power) {
                        this.miElHvacService
                            .setCharacteristic(Characteristic.Active, true)
                            .setCharacteristic(Characteristic.TargetHeaterCoolerState, 1)
                            .setCharacteristic(Characteristic.HeatingThresholdTemperature, this.frostProtectHighTemp);
                        this.frostProtectActive = true;

                    }

                    if (roomTemperature >= this.frostProtectHighTemp && this.frostProtectActive) {
                        this.miElHvacService.setCharacteristic(Characteristic.Active, false);
                        this.frostProtectActive = false;
                    }
                }
            }

            //update presets state
            if (this.presetsConfiguredCount > 0) {
                this.presetsConfigured.forEach((preset, index) => {

                    let iseeMode = operationMode;
                    iseeMode = (operationMode === 'heat' || operationMode === 'heat_isee') ? 'heat' : iseeMode;
                    iseeMode = (operationMode === 'dry' || operationMode === 'dry_isee') ? 'dry' : iseeMode;
                    iseeMode = (operationMode === 'cool' || operationMode === 'cool_isee') ? 'cool' : iseeMode;

                    preset.state = power ? (preset.mode === iseeMode
                        && (preset.setTemp).toFixed(1) === parseFloat(setTemperature).toFixed(1)
                        && preset.fanSpeed === fanSpeed
                        && preset.swingV === vaneVerticalDirection
                        && preset.swingH === vaneHorizontalDirection) : false;

                    if (this.presetsServices) {
                        const characteristicType = preset.characteristicType;
                        this.presetsServices[index]
                            .updateCharacteristic(characteristicType, preset.state);
                    }
                });
            }

            //update buttons state
            if (this.buttonsConfiguredCount > 0) {
                this.buttonsConfigured.forEach((button, index) => {
                    const mode = button.mode;
                    switch (mode) {
                        case 0: //POWER ON,OFF
                            button.state = power === 1;
                            break;
                        case 1: //OPERATING MODE HEAT
                            button.state = power ? (operationMode === 'heat' || operationMode === 'heat_isee') : false;
                            break;
                        case 2: //OPERATING MODE DRY
                            button.state = power ? (operationMode === 'dry' || operationMode === 'dry_isee') : false;
                            break
                        case 3: //OPERATING MODE COOL
                            button.state = power ? (operationMode === 'cool' || operationMode === 'cool_isee') : false;
                            break;
                        case 4: //OPERATING MODE FAN
                            button.state = power ? (operationMode === 'fan') : false;
                            break;
                        case 5: //OPERATING MODE AUTO
                            button.state = power ? (operationMode === 'auto') : false;
                            break;
                        case 6: //OPERATING MODE PURIFY
                            button.state = power ? (operationMode === 'purify') : false;
                            break;
                        case 10: //VANE H AUTO
                            button.state = power ? (vaneHorizontalDirection === 'auto') : false;
                            break;
                        case 11: //VANE H LEFT
                            button.state = power ? (vaneHorizontalDirection === 'left') : false;
                            break;
                        case 12: //VANE H LEFT MIDDLE
                            button.state = power ? (vaneHorizontalDirection === 'left_middle') : false;
                            break;
                        case 13: //VANE H CENTER
                            button.state = power ? (vaneHorizontalDirection === 'center') : false;
                            break;
                        case 14: //VANE H RIGHT MIDDLE
                            button.state = power ? (vaneHorizontalDirection === 'right_middle') : false;
                            break;
                        case 15: //VANE H RIGHT
                            button.state = power ? (vaneHorizontalDirection === 'right') : false;
                            break;
                        case 16: //VANE H SPLIT
                            button.state = power ? (vaneHorizontalDirection === 'split') : false;
                            break;
                        case 17: //VANE H SWING
                            button.state = power ? (vaneHorizontalDirection === 'swing') : false;
                            break;
                        case 20: //VANE V AUTO
                            button.state = power ? (vaneVerticalDirection === 'auto') : false;
                            break;
                        case 21: //VANE V UP
                            button.state = power ? (vaneVerticalDirection === 'up') : false;
                            break;
                        case 22: //VANE V UP MIDDLE
                            button.state = power ? (vaneVerticalDirection === 'up_middle') : false;
                            break;
                        case 23: //VANE V CENTER
                            button.state = power ? (vaneVerticalDirection === 'center') : false;
                            break;
                        case 24: //VANE V DOWN MIDDLE
                            button.state = power ? (vaneVerticalDirection === 'down_middle') : false;
                            break;
                        case 25: //VANE V DOWN
                            button.state = power ? (vaneVerticalDirection === 'down') : false;
                            break;
                        case 26: //VANE V SWING
                            button.state = power ? (vaneVerticalDirection === 'swing') : false;
                            break;
                        case 30: //FAN SPEED MODE AUTO
                            button.state = power ? (fanSpeed === 'auto') : false;
                            break;
                        case 31: //FAN SPEED MODE 1
                            button.state = power ? (fanSpeed === 'quiet') : false;
                            break;
                        case 32: //FAN SPEED MODE 2
                            button.state = power ? (fanSpeed === '1') : false;
                            break;
                        case 33: //FAN SPEED MODE 3
                            button.state = power ? (fanSpeed === '2') : false;
                            break;
                        case 34: //FAN SPEED MODE 4
                            button.state = power ? (fanSpeed === '3') : false;
                            break;
                        case 35: //FAN SPEED  MODE 5
                            button.state = power ? (fanSpeed === '4') : false;
                            break;
                        case 40: //AIR DIRECTION EVEN
                            button.state = power ? (airDirection === 'even') : false;
                            break;
                        case 41: //AIR DIRECTION INDIRECT
                            button.state = power ? (airDirection === 'indirect') : false;
                            break;
                        case 42: //AIR DIRECTION DIRECT
                            button.state = power ? (airDirection === 'direct') : false;
                            break;
                        case 50: //PHYSICAL LOCK CONTROLS ALL
                            button.state = prohibit === 'all';
                            break;
                        case 51: //PHYSICAL LOCK CONTROLS POWER
                            button.state = prohibit === 'power';
                            break;
                        case 52: //PHYSICAL LOCK CONTROLS MODE
                            button.state = prohibit === 'mode';
                            break;
                        case 53: //PHYSICAL LOCK CONTROLS TEMP
                            button.state = prohibit === 'temp';
                            break;
                        default: //Unknown button
                            this.emit('warn', `Unknown button mode: ${mode} detected`);
                            break;
                    }

                    //update services
                    if (this.buttonsServices) {
                        const characteristicType = button.characteristicType;
                        this.buttonsServices[index]
                            .updateCharacteristic(characteristicType, button.state);
                    }
                });
            }

            //update sensors state
            if (this.sensorsConfiguredCount > 0) {
                this.sensorsConfigured.forEach((sensor, index) => {
                    const mode = sensor.mode;
                    switch (mode) {
                        case 0: //POWER ON,OFF
                            sensor.state = power === 1;
                            break;
                        case 1: //OPERATING MODE HEAT
                            sensor.state = power ? (operationMode === 'heat' || operationMode === 'heat_isee') : false;
                            break;
                        case 2: //OPERATING MODE DRY
                            sensor.state = power ? (operationMode === 'dry' || operationMode === 'dry_isee') : false;
                            break
                        case 3: //OPERATING MODE COOL
                            sensor.state = power ? (operationMode === 'cool' || operationMode === 'cool_isee') : false;
                            break;
                        case 4: //OPERATING MODE FAN
                            sensor.state = power ? (operationMode === 'fan') : false;
                            break;
                        case 5: //OPERATING MODE AUTO
                            sensor.state = power ? (operationMode === 'auto') : false;
                            break;
                        case 6: //OPERATING MODE PURIFY
                            sensor.state = power ? (operationMode === 'purify') : false;
                            break;
                        case 10: //VANE H AUTO
                            sensor.state = power ? (vaneHorizontalDirection === 'auto') : false;
                            break;
                        case 11: //VANE H LEFT
                            sensor.state = power ? (vaneHorizontalDirection === 'left') : false;
                            break;
                        case 12: //VANE H LEFT MIDDLE
                            sensor.state = power ? (vaneHorizontalDirection === 'left_middle') : false;
                            break;
                        case 13: //VANE H CENTER
                            sensor.state = power ? (vaneHorizontalDirection === 'center') : false;
                            break;
                        case 14: //VANE H RIGHT MIDDLE
                            sensor.state = power ? (vaneHorizontalDirection === 'right_middle') : false;
                            break;
                        case 15: //VANE H RIGHT
                            sensor.state = power ? (vaneHorizontalDirection === 'right') : false;
                            break;
                        case 16: //VANE H SPLIT
                            sensor.state = power ? (vaneHorizontalDirection === 'split') : false;
                            break;
                        case 17: //VANE H SWING
                            sensor.state = power ? (vaneHorizontalDirection === 'swing') : false;
                            break;
                        case 20: //VANE V AUTO
                            sensor.state = power ? (vaneVerticalDirection === 'auto') : false;
                            break;
                        case 21: //VANE V UP
                            sensor.state = power ? (vaneVerticalDirection === 'up') : false;
                            break;
                        case 22: //VANE V UP MIDDLE
                            sensor.state = power ? (vaneVerticalDirection === 'up_middle') : false;
                            break;
                        case 23: //VANE V CENTER
                            sensor.state = power ? (vaneVerticalDirection === 'center') : false;
                            break;
                        case 24: //VANE V DOWN MIDDLE
                            sensor.state = power ? (vaneVerticalDirection === 'down_middle') : false;
                            break;
                        case 25: //VANE V DOWN
                            sensor.state = power ? (vaneVerticalDirection === 'down') : false;
                            break;
                        case 26: //VANE V SWING
                            sensor.state = power ? (vaneVerticalDirection === 'swing') : false;
                            break;
                        case 27: //VANE H/V CONTROLS HIDE
                            sensor.state = power ? (hideVaneControls === true) : false;
                            break;
                        case 30: //FAN SPEED MODE AUTO
                            sensor.state = power ? (fanSpeed === 'auto') : false;
                            break;
                        case 31: //FAN SPEED MODE 1
                            sensor.state = power ? (fanSpeed === 'quiet') : false;
                            break;
                        case 32: //FAN SPEED MODE 2
                            sensor.state = power ? (fanSpeed === '1') : false;
                            break;
                        case 33: //FAN SPEED MODE 3
                            sensor.state = power ? (fanSpeed === '2') : false;
                            break;
                        case 34: //FAN SPEED MODE 4
                            sensor.state = power ? (fanSpeed === '3') : false;
                            break;
                        case 35: //FAN SPEED  MODE 5
                            sensor.state = power ? (fanSpeed === '4') : false;
                            break;
                        case 40: //AIR DIRECTION EVEN
                            sensor.state = power ? (airDirection === 'even') : false;
                            break;
                        case 41: //AIR DIRECTION INDIRECT
                            sensor.state = power ? (airDirection === 'indirect') : false;
                            break;
                        case 42: //AIR DIRECTION DIRECT
                            sensor.state = power ? (airDirection === 'direct') : false;
                            break;
                        case 50: //PHYSICAL LOCK CONTROLS ALL
                            sensor.state = prohibit === 'all';
                            break;
                        case 51: //PHYSICAL LOCK CONTROLS POWER
                            sensor.state = prohibit === 'power';
                            break;
                        case 52: //PHYSICAL LOCK CONTROLS MODE
                            sensor.state = prohibit === 'mode';
                            break;
                        case 53: //PHYSICAL LOCK CONTROLS TEMP
                            sensor.state = prohibit === 'temp';
                            break;
                        case 60: //REMOTE TEMPERATURE STATE
                            sensor.state = remoteTemperatureSensorState;
                            break;
                        case 70: //OPERATION STAGE NORMAL
                            sensor.state = operationStage === 'normal';
                            break;
                        case 71: //OPERATION STAGE DEFROST
                            sensor.state = operationStage === 'defrost';
                            break;
                        case 72: //OPERATION STAGE PREHEAT
                            sensor.state = operationStage === 'preheat';
                            break;
                        case 73: //OPERATION STAGE STANDBY
                            sensor.state = operationStage === 'standby';
                            break;
                        case 80: //FAN STAGE OFF
                            sensor.state = fanSpeedStage === 'off';
                            break;
                        case 81: //FAN STAGE QUIET
                            sensor.state = fanSpeedStage === 'quiet';;
                            break;
                        case 82: //FAN STAGE 1
                            sensor.state = fanSpeedStage === '1';;
                            break;
                        case 83: //FAN STAGE 2
                            sensor.state = fanSpeedStage === '2';;
                            break;
                        case 84: //FAN STAGE 3
                            sensor.state = fanSpeedStage === '3';;
                            break;
                        case 85: //FAN STAGE 4
                            sensor.state = fanSpeedStage === '4';;
                            break;
                        case 86: //FAN STAGE 5
                            sensor.state = fanSpeedStage === '5';;
                            break;
                        case 90: //MODE STAGE AUTO OFF
                            sensor.state = operationMode !== 'auto';
                            break;
                        case 91: //MODE STAGE AUTO FAN
                            sensor.state = operationModeStage === 'auto_fan';
                            break;
                        case 92: //MODE STAGE AUTO HEAT
                            sensor.state = operationModeStage === 'auto_heat';
                            break;
                        case 93: //MODE STAGE AUTO COOL
                            sensor.state = operationModeStage === 'auto_cool';;
                            break;
                        case 94: //MODE STAGE AUTO LEADER
                            sensor.state = operationModeStage === 'auto_leader';;
                            break;
                        default: //Unknown sensor
                            this.emit('warn', `Unknown sensor mode: ${mode} detected`);
                            break;
                    }

                    //update services
                    if (this.sensorsServices) {
                        const characteristicType = sensor.characteristicType;
                        this.sensorsServices[index]
                            .updateCharacteristic(characteristicType, sensor.state);
                    }
                });
            }

            //update room temperature sensor
            if (this.roomTemperatureSensorService) {
                this.roomTemperatureSensorService
                    .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature);
            }

            //update outdoor temperature sensor
            if (this.outdoorTemperatureSensorService) {
                this.outdoorTemperatureSensorService
                    .updateCharacteristic(Characteristic.CurrentTemperature, outdoorTemperature);
            }

            //log current state
            if (!this.disableLogInfo) {
                this.emit('info', `Power: ${power ? 'ON' : 'OFF'}`);
                const info = power ? this.emit('info', `Target operation mode: ${operationMode.toUpperCase()}`) : false;
                const info1 = power ? this.emit('info', `Current operation mode: ${operationModeStage.toUpperCase()}`) : false;
                const info2 = power ? this.emit('info', `Target temperature: ${setTemperature}${temperatureUnit}`) : false;
                const info3 = power ? this.emit('info', `Current temperature: ${roomTemperature}${temperatureUnit}`) : false;
                const info4 = power && outdoorTemperature !== null ? this.emit('info', `Outdoor temperature: ${outdoorTemperature}${temperatureUnit}`) : false;
                const info5 = power && modelSupportsFanSpeed ? this.emit('info', `Target Fan speed: ${fanSpeed.toUpperCase()}`) : false;
                const info6 = power && modelSupportsFanSpeed ? this.emit('info', `Current Fan speed: ${fanSpeedStage.toUpperCase()}`) : false;
                const info7 = power && vaneHorizontalDirection !== 'Unknown' ? this.emit('info', `Vane horizontal: ${MiElHVAC.HorizontalVane[vaneHorizontalDirection] ?? vaneHorizontalDirection}`) : false;
                const info8 = power && vaneVerticalDirection !== 'Unknown' ? this.emit('info', `Vane vertical: ${MiElHVAC.VerticalVane[vaneVerticalDirection] ?? vaneVerticalDirection}`) : false;
                const info9 = power ? this.emit('info', `Swing mode: ${MiElHVAC.SwingMode[swingMode]}`) : false;
                const info10 = power && vaneHorizontalDirection === 'isee' && airDirection !== 'Unknown' ? this.emit('info', `Air direction: ${MiElHVAC.AirDirection[airDirection]}`) : false;
                const info11 = power ? this.emit('info', `Prohibit: ${MiElHVAC.Prohibit[prohibit]}`) : false;
                const info12 = power ? this.emit('info', `Temperature display unit: ${temperatureUnit}`) : false;
                const info13 = power ? this.emit('info', `Compressor: ${compressor.toUpperCase()}`) : false;
                const info14 = power ? this.emit('info', `OperationPower: ${operationPower}W`) : false;
                const info15 = power ? this.emit('info', `OperationEnergy: ${operationEnergy}kWh`) : false;
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
    }

    async updateRemoteTemp() {
        try {
            //get remote temp
            const rmoteTempData = await this.axiosInstanceRemoteTemp();
            const remoteTemp = rmoteTempData.data ?? false;
            const debug = this.enableDebugMode ? this.emit('debug', `Remote temp: ${JSON.stringify(remoteTemp, null, 2)}`) : false;

            //set remote temp
            const temp = `${MiElHVAC.RemoteTemp}${remoteTemp}`
            await this.axiosInstance(temp);

            return true
        } catch (error) {
            throw new Error(`Update remote temperature error: ${error}`);
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
            const remoteTempSensor = this.remoteTemperatureSensorEnable ? timers.push({ name: 'updateRemoteTemp', sampling: this.remoteTemperatureSensorRefreshInterval }) : false;
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
        this.emit('devInfo', `Sensor: MiELHVAC`);
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
            const accessoryCategory = Categories.AIR_CONDITIONER
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
            const debug2 = this.enableDebugMode ? this.emit('debug', `Prepare Services`) : false;
            const debug = this.enableDebugMode ? this.emit('debug', `Prepare mitsubishi hvac service`) : false;
            const autoDryFanMode = [MiElHVAC.SetMode.auto, MiElHVAC.SetMode.auto, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.autoDryFanMode]; //NONE, AUTO, DRY, FAN
            const heatDryFanMode = [MiElHVAC.SetMode.heat, MiElHVAC.SetMode.heat, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.heatDryFanMode]; //NONE, HEAT, DRY, FAN
            const coolDryFanMode = [MiElHVAC.SetMode.cool, MiElHVAC.SetMode.cool, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.coolDryFanMode]; //NONE, COOL, DRY, FAN

            //services
            this.miElHvacService = new Service.HeaterCooler(accessoryName, `HeaterCooler ${this.serialNumber}`);
            this.miElHvacService.setPrimaryService(true);
            this.miElHvacService.getCharacteristic(Characteristic.Active)
                .onGet(async () => {
                    const state = this.mielHvac.power;
                    return state;
                })
                .onSet(async (state) => {
                    try {
                        const power = [MiElHVAC.PowerOff, MiElHVAC.PowerOn][state];
                        await this.axiosInstance(power);
                        const info = this.disableLogInfo ? false : this.emit('info', `Set power: ${state ? 'ON' : 'OFF'}`);
                    } catch (error) {
                        this.emit('warn', `Set power error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
                .onGet(async () => {
                    const value = this.mielHvac.currentOperationMode;
                    return value;
                });
            this.miElHvacService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                .setProps({
                    minValue: this.mielHvac.operationModeSetPropsMinValue,
                    maxValue: this.mielHvac.operationModeSetPropsMaxValue,
                    validValues: this.mielHvac.operationModeSetPropsValidValues
                })
                .onGet(async () => {
                    const value = this.mielHvac.targetOperationMode; //1 = HEAT, 2 = DRY 3 = COOL, 7 = FAN, 8 = AUTO
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

                        const info = this.disableLogInfo ? false : this.emit('info', `Set operation mode: ${MiElHVAC.OperationMode[value]}`);
                    } catch (error) {
                        this.emit('warn', `Set operation mode error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.CurrentTemperature)
                .onGet(async () => {
                    const value = this.mielHvac.roomTemperature;
                    return value;
                });
            if (this.mielHvac.modelSupportsFanSpeed) {
                this.miElHvacService.getCharacteristic(Characteristic.RotationSpeed)
                    .setProps({
                        minValue: 0,
                        maxValue: this.mielHvac.fanSpeedSetPropsMaxValue,
                        minStep: 1
                    })
                    .onGet(async () => {
                        const value = this.mielHvac.fanSpeed; //AUTO, 1, 2, 3, 4, 5
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            let fanSpeed = 0;
                            let fanSpeedModeText = 'off';
                            switch (this.mielHvac.numberOfFanSpeeds) {
                                case 2: //Fan speed mode 2
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 0][value] : [1, 1, 2][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', 'auto'][value] : ['off', 'quiet', '1'][value];
                                    break;
                                case 3: //Fan speed mode 3
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 0][value] : [1, 1, 2, 3][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', 'auto'][value] : ['off', 'quiet', '1', '2',][value];
                                    break;
                                case 4: //Fan speed mode 4
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 0][value] : [1, 1, 2, 3, 4][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', '3', 'auto'][value] : ['off', 'quiet', '1', '2', '3'][value];
                                    break;
                                case 5: //Fan speed mode 5
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 5, 0][value] : [1, 1, 2, 3, 4, 5][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', '3', '4', 'auto'][value] : ['off', 'quiet', '1', '2', '3', '4'][value];
                                    break;
                            }

                            //fan speed mode
                            const fanSpeedMap = ['auto', 'quiet', '1', '2', '3', '4'][fanSpeed];
                            await this.axiosInstance(MiElHVAC.SetFanSpeed[fanSpeedMap]);
                            const info = this.disableLogInfo ? false : this.emit('info', `Set fan speed mode: ${MiElHVAC.FanSpeed[fanSpeedModeText]}`);
                        } catch (error) {
                            this.emit('warn', `Set fan speed mode error: ${error}`);
                        }
                    });
            }
            if (this.mielHvac.swingMode) {
                this.miElHvacService.getCharacteristic(Characteristic.SwingMode)
                    .onGet(async () => {
                        const value = this.mielHvac.swingMode;
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            switch (value) {
                                case 0:
                                    await this.axiosInstance(MiElHVAC.SetSwingV[this.previousStateSwingV]);
                                    await this.axiosInstance(MiElHVAC.SetSwingH[this.previousStateSwingH]);
                                    break;
                                case 1:
                                    //set vane v
                                    this.previousStateSwingV = this.mielHvac.vaneVerticalDirection;
                                    await this.axiosInstance(MiElHVAC.SetSwingV.swing);

                                    //set vane h
                                    this.previousStateSwingH = this.mielHvac.vaneHorizontalDirection;
                                    await this.axiosInstance(MiElHVAC.SetSwingH.swing);
                                    break;
                            }
                            const info = this.disableLogInfo ? false : this.emit('info', `Set air direction mode: ${MiElHVAC.SwingMode[value]}`);
                        } catch (error) {
                            this.emit('warn', `Set vane swing mode error: ${error}`);
                        }
                    });
            }
            this.miElHvacService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                .setProps({
                    minValue: 16,
                    maxValue: 31,
                    minStep: this.mielHvac.temperatureIncrement
                })
                .onGet(async () => {
                    const value = this.mielHvac.targetOperationMode === 2 ? this.mielHvac.setTemperature : this.mielHvac.defaultCoolingSetTemperature;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        if (this.mielHvac.targetOperationMode === 0) {
                            await this.saveData(this.info.defaultCoolingSetTemperatureFile, value);
                            value = (value + this.info.mielHvac.defaultHeatingSetTemperature) / 2;
                        }

                        const temp = `${MiElHVAC.SetTemp}${value}`
                        await this.axiosInstance(temp);
                        const info = this.disableLogInfo ? false : this.emit('info', `Set ${this.mielHvac.targetOperationMode === 2 ? 'temperature' : 'cooling threshold temperature'}: ${value}${this.mielHvac.temperatureUnit}`);
                    } catch (error) {
                        this.emit('warn', `Set cooling threshold temperature error: ${error}`);
                    }
                });
            if (this.mielHvac.modelSupportsHeat) {
                this.miElHvacService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                    .setProps({
                        minValue: 10,
                        maxValue: 31,
                        minStep: this.mielHvac.temperatureIncrement
                    })
                    .onGet(async () => {
                        const value = this.mielHvac.targetOperationMode === 1 ? this.mielHvac.setTemperature : this.mielHvac.defaultHeatingSetTemperature;
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            if (this.mielHvac.targetOperationMode === 0) {
                                await this.saveData(this.info.defaultHeatingSetTemperatureFile, value);
                                value = (value + this.info.mielHvac.defaultCoolingSetTemperature) / 2;
                            }

                            const temp = `${MiElHVAC.SetTemp}${value}`
                            await this.axiosInstance(temp);
                            const info = this.disableLogInfo ? false : this.emit('info', `Set ${this.mielHvac.targetOperationMode === 1 ? 'temperature' : 'heating threshold temperature'}: ${value}${this.mielHvac.temperatureUnit}`);
                        } catch (error) {
                            this.emit('warn', `Set heating threshold temperature error: ${error}`);
                        }
                    });
            }
            this.miElHvacService.getCharacteristic(Characteristic.LockPhysicalControls)
                .onGet(async () => {
                    const value = this.mielHvac.lockPhysicalControl;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        const lock = [MiElHVAC.SetProhibit.off, MiElHVAC.SetProhibit.all][value];
                        await this.axiosInstance(lock);
                        const info = this.disableLogInfo ? false : this.emit('info', `Set local physical controls: ${value ? 'LOCK' : 'UNLOCK'}`);
                    } catch (error) {
                        this.emit('warn', `Set lock physical controls error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                .onGet(async () => {
                    const value = this.mielHvac.useFahrenheit;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        const unit = [MiElHVAC.SetDisplayUnit.c, MiElHVAC.SetDisplayUnit.f][value];
                        //await this.axiosInstance(unit);
                        const info = this.disableLogInfo ? false : this.emit('info', `Set temperature display unit: ${TemperatureDisplayUnits[value]}`);
                    } catch (error) {
                        this.emit('warn', `Set temperature display unit error: ${error}`);
                    }
                });
            accessory.addService(this.miElHvacService);

            //presets services
            if (this.presetsConfiguredCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare presets services`) : false;
                this.presetsServices = [];

                this.presetsConfigured.forEach((preset, index) => {
                    //get preset name
                    const presetName = preset.name;

                    //get preset name prefix
                    const presetNamePrefix = preset.namePrefix;

                    const serviceName = presetNamePrefix ? `${accessoryName} ${presetName}` : presetName;
                    const serviceType = preset.serviceType;
                    const characteristicType = preset.characteristicType;
                    const presetService = new serviceType(serviceName, `Preset ${index}`);
                    presetService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    presetService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    presetService.getCharacteristic(characteristicType)
                        .onGet(async () => {
                            const state = preset.state;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                let data = '';
                                switch (state) {
                                    case true:
                                        const setPower = !this.mielHvac.power ? await this.axiosInstance(MiElHVAC.PowerOn) : false;
                                        data = MiElHVAC.SetMode[preset.mode];
                                        await this.axiosInstance(data);
                                        data = `${MiElHVAC.SetTemp}${preset.setTemp}`;
                                        await this.axiosInstance(data);
                                        data = MiElHVAC.SetFanSpeed[preset.fanSpeed];
                                        await this.axiosInstance(data);
                                        data = MiElHVAC.SetSwingV[preset.swingV];
                                        await this.axiosInstance(data);
                                        data = MiElHVAC.SetSwingH[preset.swingH];
                                        await this.axiosInstance(data);
                                        break;
                                    case false:
                                        break;
                                }

                                const info = this.disableLogInfo || !state ? false : this.emit('info', `Set: ${presetName}`);
                                await new Promise(resolve => setTimeout(resolve, 250));
                            } catch (error) {
                                this.emit('warn', `Set preset error: ${error}`);
                            }
                        });
                    this.presetsServices.push(presetService);
                    accessory.addService(presetService);
                });
            }

            //buttons services
            if (this.buttonsConfiguredCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare buttons services`) : false;
                this.buttonsServices = [];

                this.buttonsConfigured.forEach((button, index) => {
                    //get button mode
                    const mode = button.mode;

                    //get button name
                    const buttonName = button.name;

                    //get button name prefix
                    const buttonNamePrefix = button.namePrefix;

                    const serviceName = buttonNamePrefix ? `${accessoryName} ${buttonName}` : buttonName;
                    const serviceType = button.serviceType;
                    const characteristicType = button.characteristicType;
                    const buttonService = new serviceType(serviceName, `Button ${index}`);
                    buttonService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    buttonService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    buttonService.getCharacteristic(characteristicType)
                        .onGet(async () => {
                            const state = button.state;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                let data = '';
                                switch (mode) {
                                    case 0: //POWER ON,OFF
                                        data = state ? MiElHVAC.PowerOn : MiElHVAC.PowerOff;
                                        break;
                                    case 1: //OPERATING MODE HEAT
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.heat : button.previousValue;
                                        break;
                                    case 2: //OPERATING MODE DRY
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.dry : button.previousValue;
                                        break
                                    case 3: //OPERATING MODE COOL
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.cool : button.previousValue;
                                        break;
                                    case 4: //OPERATING MODE FAN
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.fan : button.previousValue;
                                        break;
                                    case 5: //OPERATING MODE AUTO
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.auto : button.previousValue;
                                        break;
                                    case 6: //OPERATING MODE PURIFY
                                        button.previousValue = state ? MiElHVAC.SetMode[this.mielHvac.operationMode] : button.previousValue;
                                        data = state ? MiElHVAC.SetMode.purify : button.previousValue;
                                        break;
                                    case 10: //VANE H AUTO
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.auto : button.previousValue;
                                        break;
                                    case 11: //VANE H LEFT
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.left : button.previousValue;
                                        break;
                                    case 12: //VANE H LEFT MIDDLE
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.left_middle : button.previousValue;
                                        break;
                                    case 13: //VANE H CENTER
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.center : button.previousValue;
                                        break;
                                    case 14: //VANE H RIGHT MIDDLE
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.right_middle : button.previousValue;
                                        break;
                                    case 15: //VANE H RIGHT
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.right : button.previousValue;
                                        break;
                                    case 16: //VANE H SPLIT
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.split : button.previousValue;
                                        break;
                                    case 17: //VANE H SWING
                                        button.previousValue = state ? MiElHVAC.SetSwingH[this.mielHvac.vaneHorizontalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingH.swing : button.previousValue;
                                        break;
                                    case 20: //VANE V AUTO
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.auto : button.previousValue;
                                        break;
                                    case 21: //VANE V UP
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.up : button.previousValue;
                                        break;
                                    case 22: //VANE V UP MIDDLE
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.up_middle : button.previousValue;
                                        break;
                                    case 23: //VANE V CENTER
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.center : button.previousValue;
                                        break;
                                    case 24: //VANE V DOWN MIDDLE
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.down_middle : button.previousValue;
                                        break;
                                    case 25: //VANE V DOWN
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.down : button.previousValue;
                                        break;
                                    case 26: //VANE V SWING
                                        button.previousValue = state ? MiElHVAC.SetSwingV[this.mielHvac.vaneVerticalDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetSwingV.swing : button.previousValue;
                                        break;
                                    case 30: //FAN SPEED AUTO
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed.auto : button.previousValue;
                                        break;
                                    case 31: //FAN SPEED QUIET
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed.quiet : button.previousValue;
                                        break;
                                    case 32: //FAN SPEED 1
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed['1'] : button.previousValue;
                                        break;
                                    case 33: //FAN SPEED 2
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed['2'] : button.previousValue;
                                        break;
                                    case 34: //FAN 3
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed['3'] : button.previousValue;
                                        break;
                                    case 35: //FAN SPEED 4
                                        button.previousValue = state ? MiElHVAC.SetFanSpeed[this.mielHvac.fanSpeed] : button.previousValue;
                                        data = state ? MiElHVAC.SetFanSpeed['4'] : button.previousValue;
                                        break;
                                    case 40: //AIR DIRECTION EVEN
                                        button.previousValue = state ? MiElHVAC.SetAirDirection[this.mielHvac.airDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetAirDirection.even : button.previousValue;
                                        break;
                                    case 41: //AIR DIRECTION INDIRECT
                                        button.previousValue = state ? MiElHVAC.SetAirDirection[this.mielHvac.airDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetAirDirection.indirect : button.previousValue;
                                        break;
                                    case 42: //AIR DIRECTION DIRECT
                                        button.previousValue = state ? MiElHVAC.SetAirDirection[this.mielHvac.airDirection] : button.previousValue;
                                        data = state ? MiElHVAC.SetAirDirection.direct : button.previousValue;
                                        break;
                                    case 50: //PHYSICAL LOCK CONTROLS
                                        button.previousValue = state ? MiElHVAC.SetProhibit[this.mielHvac.prohibit] : button.previousValue;
                                        data = state ? MiElHVAC.SetProhibit.all : button.previousValue;
                                        break;
                                    case 51: //PHYSICAL LOCK CONTROLS POWER
                                        button.previousValue = state ? MiElHVAC.SetProhibit[this.mielHvac.prohibit] : button.previousValue;
                                        data = state ? MiElHVAC.SetProhibit.power : button.previousValue;
                                        break;
                                    case 52: //PHYSICAL LOCK CONTROLS MODE
                                        button.previousValue = state ? MiElHVAC.SetProhibit[this.mielHvac.prohibit] : button.previousValue;
                                        data = state ? MiElHVAC.SetProhibit.mode : button.previousValue;
                                        break;
                                    case 53: //PHYSICAL LOCK CONTROLS TEMP
                                        button.previousValue = state ? MiElHVAC.SetProhibit[this.mielHvac.prohibit] : button.previousValue;
                                        data = state ? MiElHVAC.SetProhibit.temp : button.previousValue;
                                        break;
                                    default:
                                        this.emit('warn', `Unknown button mode: ${mode}`);
                                        return;
                                }

                                const setPower = !this.mielHvac.power && state && (mode > 0 && mode < 50) ? await this.axiosInstance(MiElHVAC.PowerOn) : false;
                                await this.axiosInstance(data);
                                const info = this.disableLogInfo ? false : mode > 0 ? this.emit('info', `${state ? `Set: ${buttonName}` : `Unset: ${buttonName}, Set: ${button.previousValue}`}`) : `Set: ${buttonName}`;
                                await new Promise(resolve => setTimeout(resolve, 250));
                            } catch (error) {
                                this.emit('warn', `Set button error: ${error}`);
                            }
                        });
                    this.buttonsServices.push(buttonService);
                    accessory.addService(buttonService);
                });
            }

            //sensors services
            if (this.sensorsConfiguredCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare sensors services`) : false;
                this.sensorsServices = [];

                this.sensorsConfigured.forEach((sensor, index) => {
                    //get sensor name
                    const sensorName = sensor.name;

                    //get sensor name prefix
                    const sensorNamePrefix = sensor.namePrefix;

                    const serviceName = sensorNamePrefix ? `${accessoryName} ${sensorName}` : sensorName;
                    const serviceType = sensor.serviceType;
                    const characteristicType = sensor.characteristicType;
                    const sensorService = new serviceType(serviceName, `Sensor ${index}`);
                    sensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    sensorService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    sensorService.getCharacteristic(characteristicType)
                        .onGet(async () => {
                            const state = sensor.state;
                            return state;
                        });
                    this.sensorsServices.push(sensorService);
                    accessory.addService(sensorService);
                });
            }

            //room temperature sensor service
            if (this.temperatureSensor && this.mielHvac.roomTemperature !== null) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare room temperature sensor service`) : false;
                this.roomTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Room`, `Room Temperature Sensor`);
                this.roomTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.roomTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Room`);
                this.roomTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                    .setProps({
                        minValue: -35,
                        maxValue: 150,
                        minStep: 0.5
                    })
                    .onGet(async () => {
                        const state = this.mielHvac.roomTemperature;
                        return state;
                    })
                accessory.addService(this.roomTemperatureSensorService);
            }

            //outdoor temperature sensor service
            if (this.temperatureSensorOutdoor && this.mielHvac.hasOutdoorTemperature && this.mielHvac.outdoorTemperature !== null) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare outdoor temperature sensor service`) : false;
                this.outdoorTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Outdoor`, `Outdoor Temperature Sensor`);
                this.outdoorTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.outdoorTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Outdoor`);
                this.outdoorTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                    .setProps({
                        minValue: -35,
                        maxValue: 150,
                        minStep: 0.5
                    })
                    .onGet(async () => {
                        const state = this.mielHvac.outdoorTemperature;
                        return state;
                    })
                accessory.addService(this.outdoorTemperatureSensorService);
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
export default MiElHvac;
