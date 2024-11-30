export const PlatformName = "tasmotaControl";
export const PluginName = "homebridge-tasmota-control";

export const ApiCommands = {
    "Status": "Status%200",
    "PowerStatus": "Power0",
    "Power": "Power",
    "PowerOn": "Power%20on",
    "PowerOff": "Power%20off",
    "Off": "%20off",
    "On": "%20on",
    "Toggle": "%20toggle",
    "Blink": "%20blink",
    "BlinkOff": "%20blinkoff",
    "Dimmer": "Dimmer",
    "DimmerAllChannels": "Dimmer1",
    "DimmerForRgbChannels": "Dimmer2",
    "DimmerForWhiteChannels": "Dimmer3",
    "ColorTemperature": "CT",
    "HSBColor": "HSBColor",
    "HSBHue": "HSBColor1",
    "HSBSaturation": "HSBColor2"
};

export const MiElHVAC = {
    "PowerOn": "Power%20on",
    "PowerOff": "Power%20off",
    "SetMode": {
        "heat": "HVACSetMode%20heat",
        "dry": "HVACSetMode%20dry",
        "cool": "HVACSetMode%20cool",
        "fan": "HVACSetMode%20fan",
        "auto": "HVACSetMode%20auto",
        "purify": "HVACSetMode%20purify"
    },
    "SetFanSpeed": {
        "auto": "HVACSetFanSpeed%20auto",
        "quiet": "HVACSetFanSpeed%20quiet",
        "1": "HVACSetFanSpeed%201",
        "2": "HVACSetFanSpeed%202",
        "3": "HVACSetFanSpeed%203",
        "4": "HVACSetFanSpeed%204"
    },
    "SetTemp": "HVACSetTemp%20",
    "SetSwingV": {
        "auto": "HVACSetSwingV%20auto",
        "up": "HVACSetSwingV%20up",
        "up_middle": "HVACSetSwingV%20up_middle",
        "center": "HVACSetSwingV%20center",
        "down": "HVACSetSwingV%20down",
        "down_middle": "HVACSetSwingV%20down_middle",
        "swing": "HVACSetSwingV%20swing"
    },
    "SetSwingH": {
        "auto": "HVACSetSwingH%20auto",
        "left": "HVACSetSwingH%20left",
        "left_middle": "HVACSetSwingH%20left_middle",
        "center": "HVACSetSwingH%20center",
        "right_middle": "HVACSetSwingH%20right_middle",
        "right": "HVACSetSwingH%20right",
        "split": "HVACSetSwingH%20split",
        "swing": "HVACSetSwingH%20swing"
    },
    "SetAirDirection": {
        "even": "HVACSetAirDirection%20even",
        "indirect": "HVACSetAirDirection%20indirect",
        "direct": "HVACSetAirDirection%20direct"
    },
    "SetProhibit": {
        "off": "HVACSetProhibit%20off",
        "power": "HVACSetProhibit%20power",
        "mode": "HVACSetProhibit%20mode",
        "mode_power": "HVACSetProhibit%20mode_power",
        "temp": "HVACSetProhibit%20temp",
        "temp_power": "HVACSetProhibit%20temp_power",
        "temp_mode": "HVACSetProhibit%20temp_mode",
        "all": "HVACSetProhibit%20all"
    },
    "SetDisplayUnit": {
        "c": "HVACSetDisplayUnit%20c",
        "f": "HVACSetDisplayUnit%20f"
    },
    "RemoteTemp": "HVACRemoteTemp%20",
    "RemoteTempClearTime": "HVACRemoteTempClearTime%20",
    "OperationMode": [
        "AUTO",
        "HEAT",
        "COOL",
        "DRY",
        "FAN",
        "ISEE HEAT",
        "ISEE DRY",
        "ISEE COOL"
    ],
    "CurrentOperationMode": [
        "INACTIVE",
        "IDLE",
        "HEATING",
        "COOLING"
    ],
    "FanSpeed": {
        "auto": "AUTO",
        "quiet": "QUIET",
        "1": "WEAK",
        "2": "NORMAL",
        "3": "STRONG",
        "4": "ERY STRONG",
        "6": "OFF"
    },
    "VerticalVane": {
        "auto": "AUTO",
        "up": "UP",
        "up_middle": "UP MIDDLE",
        "center": "CENTER",
        "down_middle": "DOWN MIDDLE",
        "down": "DOWN",
        "swing": "SWING"
    },
    "HorizontalVane": {
        "auto": "AUTO",
        "left_middle": "LEFT",
        "left": "LEFT MIDDLE",
        "center": "CENTER",
        "right_middle": "RIGHT MIDDLE",
        "right": "RIGHT",
        "split": "SPLIT",
        "swing": "SWING"
    },
    "AirDirection": {
        "off": "OFF",
        "even": "EVEN",
        "indirect": "INDIRECT",
        "direct": "DIRECT"
    },
    "Prohibit": {
        "off": "OFF",
        "power": "POWER",
        "mode": "MODE",
        "power_mode": "POWER AND MODE",
        "temp": "TEMPERATURE",
        "temp_power": "TEMP AND POWER",
        "temp_mode": "TEMP AND MODE",
        "all": "ALL"
    },
    "Compressor": {
        "off": "OFF",
        "on": "ON"
    },
    "SwingMode": [
        "AUTO",
        "SWING"
    ]
};

export const LightKeys = [
    "Dimmer",
    "Color",
    "HSBColor",
    "HSBColor1",
    "HSBColor2",
    "HSBColor3",
    "White",
    "CT"
];

export const SensorKeys = [
    "AHT1X",
    "AHT2X",
    "AM2301",
    "AM2302",
    "AM2320",
    "AM2321",
    "APDS9960",
    "AZ7798",
    "BME280",
    "BME680",
    "CCS811",
    "DHT11",
    "DHT12",
    "DS1621",
    "DS1624",
    "DS18B20",
    "DS18S20",
    "DS1822",
    "ESP32",
    "ENS161",
    "EZO",
    "HDC1080",
    "HDC2010",
    "HP303B",
    "HYT",
    "HP303B",
    "K30",
    "K70",
    "LM75AD",
    "LMT01",
    "MAX6675",
    "MAX31855",
    "MAX31865",
    "MAX44009",
    "MCP9808",
    "MHZ19",
    "MLX90614",
    "MLX90640",
    "HTU21",
    "HYTxx",
    "SCD30",
    "SCD40",
    "SCD41",
    "SEN54",
    "SEN55",
    "SEN0390",
    "SGP30",
    "SGP40",
    "SGP41",
    "Si114",
    "Si7021",
    "SHT1X",
    "SHT10",
    "SHT3X",
    "SHT30",
    "SHT4X",
    "SHT40",
    "T6703",
    "T6713",
    "TC74",
    "VEML7700",
    "PIR",
    "ENERGY",
    "MiElHVAC"
];

export const SensorPropertiesKeys = [
    "Temperature",
    "ReferenceTemperature",
    "Humidity",
    "DewPoint",
    "Pressure",
    "Gas",
    "CarbonDioxyde",
    "Ambient",
    "Illuminance",
    "Speed",
    "Dir"
]

export const TemperatureDisplayUnits = [
    "F",
    "°C",
];