import axios from 'axios';
import EventEmitter from 'events';
import { ApiCommands, LightKeys } from './constants.js';

class DeviceInfo extends EventEmitter {
    constructor(url, auth, user, passwd, deviceName, loadNameFromDevice, enableDebugMode, refreshInterval) {
        super();
        this.name = deviceName
        this.loadNameFromDevice = loadNameFromDevice;
        this.enableDebugMode = enableDebugMode;

        //axios instance
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: refreshInterval > 10000 ? 10000 : refreshInterval,
            withCredentials: auth,
            auth: {
                username: user,
                password: passwd
            }
        });

    }

    async getInfo() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting info`) : false;
        try {
            const deviceInfoData = await this.axiosInstance(ApiCommands.Status);
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
            }

            //status FWR
            const statusFwr = deviceInfo.StatusFWR ?? {};
            const firmwareRevision = statusFwr.Version ?? 'Unknown';
            const modelName = statusFwr.Hardware ?? 'Unknown';

            //status NET
            const statusNet = deviceInfo.StatusNET ?? {};
            const addressMac = statusNet.Mac ?? false;

            //status SNS
            const statusSns = deviceInfo.StatusSNS ?? {};
            const statusSnsKeys = Object.keys(statusSns);

            //status STS
            const statusSts = deviceInfo.StatusSTS ?? {};
            const statusStsKeys = Object.keys(statusSts);
            const deviceType = statusSnsKeys.includes('MiElHVAC') ? 0 : statusStsKeys.some(key => LightKeys.includes(key)) ? 2 : statusStsKeys.includes('FanSpeed') ? 3 : 1;
            const obj = {
                deviceType: deviceType,
                deviceName: deviceName,
                friendlyNames: friendlyNames,
                modelName: modelName,
                serialNumber: addressMac,
                firmwareRevision: firmwareRevision,
                relaysCount: friendlyNames.length
            };
            return obj;
        } catch (error) {
            throw new Error(`Check info error: ${error}`);
        }
    }
}
export default DeviceInfo;
