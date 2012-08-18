var util = require('util');
var events = require('events');
var HID = require('HID');
var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});
var nconf = require('nconf');
// Read config.json
nconf.file({
    file: 'config.json'
});

// Need some globals for the intricate assemby of reports from the weather stations
var inbuf = new Buffer(20);
var inbufIndex = 0;
var noOfFFsFound = 0;
var expectedLength = 0;
var allValues = {}; // Collects all measurements in one object.

module.exports = OS_WStation;

/**
 * Constructor.
 * Sets up the HID manager and event handlers
 *
 * @param func() dataLogger
 */
function OS_WStation() {
    var self = this;
    var devices = HID.devices(0x0FDE, 0xCA01);

    // TODO: when a better HID manager is available, wait for device do be plugged in
    // and don't assume it already is.
    if (!devices.length) {
        throw new Error("No valid weather station could be found");
    }

    log.info('Device found. Initializing');

    events.EventEmitter.call(self);

    // Set up the logger(s)
    if (nconf.get('pubnub')) {
        var PubnubLogger = require('./pubnub_logger');
        self.pubnubLogger = new PubnubLogger();
    }
    if (nconf.get('cosm')) {
        var CosmLogger = require('./cosm_logger');
        self.dataLogger = new CosmLogger();
    }
    if (nconf.get('pusher')) {
        var CosmLogger = require('./pusher_logger');
        self.pusherLogger = new CosmLogger();
    }
    
    
    self.hid = new HID.HID(devices[0].path);

    // Initialization sequence for HID based weather stations from Oregon Scientific
    self.hid.write([0x20, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00]);

    // Bind callback function to HID library
    self.hid.read(self.handleHIDReport.bind(self));

    // Register the various decoding functions
    self.on('sensor41', self.decodeRainReport);
    self.on('sensor42', self.decodeTempAndHumidityReport);
    self.on('sensor46', self.decodeAirPressureReport);
    self.on('sensor47', self.decodeUVReport);
    self.on('sensor48', self.decodeWindReport);
    self.on('sensor60', self.decodeStatusReport);
}

// Set up inheritance from EventEmitter
util.inherits(OS_WStation, events.EventEmitter);

OS_WStation.prototype.logMinuteReport = function (values) {
    if (this.dataLogger)
        this.dataLogger.log(values);
};

OS_WStation.prototype.logCurrentValues = function (values) {
    if (this.pubnubLogger)
        this.pubnubLogger.log(values);
    if (this.pusherLogger)
        this.pusherLogger.log(values);
};

/**
 * Handles incomint HID reports and assembles valid data, usually only 1 byte for each report
 * into a complete weather station report. First byte in the HID report tells how many valid
 * bytes follows.
 *
 */
OS_WStation.prototype.handleHIDReport = function(error, data) {
    var self = this;
    if (noOfFFsFound === 2) { // Have we found sync sequence?
        // Yes! Two consecutive 0xff is detected, we are in sync.
        // Start saving data until we have a valid report from the station.
        for (var i = 0; i < data[0]; i++)
        inbuf[inbufIndex++] = data[1 + i];

        // Check expected length, if we have enough data to determine that.
        if (expectedLength === 0 && inbufIndex > 2) {
            switch (inbuf[1]) {
            case 0x41:
                expectedLength = 17;
                break;
            case 0x42:
                expectedLength = 12;
                break;
            case 0x46:
                expectedLength = 8;
                break;
            case 0x47:
                expectedLength = 6;
                break;
            case 0x48:
                expectedLength = 11;
                break;
            case 0x60:
                expectedLength = 12;
                break;
            default:
                // Unknown. Trash it and start looking for new frame.
                log.warning('Got an unknown sensor code: ' + inbuf[1].toString(16));
                inbufIndex = noOfFFsFound = expectedLength = 0;
            }
        }

        if (inbufIndex === expectedLength) {
            // Complete reading from station is aquired. Emit an event for the proper handler.
            self.emit('sensor' + inbuf[1].toString(16), inbuf.slice(0, expectedLength));
            // Start looking for new frame by resetting all counters.
            inbufIndex = noOfFFsFound = expectedLength = 0;
        }
    }
    else if (noOfFFsFound === 1 && data[1] !== 0xff) {
        noOfFFsFound = 0;
    }
    else if (data[1] === 0xff) {
        noOfFFsFound++;
    }

    // Must re-bind this callback to node-hid module for every use!
    self.hid.read(self.handleHIDReport.bind(self));
};

OS_WStation.prototype.roundedDoubleFromBytes = function(high, low, factor) {
    var result = (high * 256 + low) * factor;
    return Math.round(result * 10) / 10.0;
};

OS_WStation.prototype.batteryLevel = function(level) {
    var levelString = ["none", "low", "high"];
    return levelString[level & 0x40 ? 1 : 2];
};

OS_WStation.prototype.decodeRainReport = function(data) {
    var self = this;
    // Comes in inches... * 0.254 makes mm.
    var totalRain = self.roundedDoubleFromBytes(data[9], data[8], 0.254);
    var rainRate = self.roundedDoubleFromBytes(data[3] & 0x0f, data[2], 0.254);
    var rain1hour = self.roundedDoubleFromBytes(data[5], data[4], 0.254);
    var rain24hour = self.roundedDoubleFromBytes(data[7], data[6], 0.254);

    var rainTotalSince = new Date(data[14] + 2000, data[13], data[12], data[11], data[10], 0, 0);

    var obj = {};
    obj.reading = 'rain';
    obj.batteryLevel = self.batteryLevel(data[0]);
    obj.rainRate = rainRate;
    obj.lastHour = rain1hour;
    obj.last24hours = rain24hour;
    obj.total = totalRain;
    obj.totalSince = rainTotalSince;
    
    allValues.rainRate = Math.max(rainRate, allValues.rainRate === undefined ? 0 : allValues.rainRate);
    allValues.rainLast1H = rain1hour;
    allValues.rainLast24H = rain24hour;
    allValues.rainTotal = totalRain;

    log.debug(JSON.stringify(obj));
};

OS_WStation.prototype.decodeTempAndHumidityReport = function(data) {
    var self = this;
    var sensor = data[2] & 0x0f;
    var temp = self.roundedDoubleFromBytes(data[4] & 0x0f, data[3], 0.1);
    if (data[4] & 0x80) temp *= -1.0;

    var hum = data[5];

    var obj = {};
    obj.reading = 'temperature';
    obj.batteryLevel = self.batteryLevel(data[0]);
    obj.sensor = sensor;
    obj.temperature = temp;
    obj.humidity = hum;

    // Dewpoint is of interest for outdoor sensor (no. 1)
    if (sensor === 1) {
        var dew = self.roundedDoubleFromBytes(data[7] & 0x0f, data[6], 0.1);
        if (data[7] & 0x80) dew *= -1.0;
        obj.dewpoint = dew;
        
        allValues.dewpoint = dew;
        allValues.outdoorTemp = temp;
        allValues.outdoorHumidity = hum;
        
        self.logCurrentValues([{
            type: 'outdoorTemp',
            value: temp,
            unit: '°C'
        },
        {
            type: 'outdoorHumidity',
            value: hum,
            unit: '%'
        }]);
    } else if (sensor === 0) { // Main unit indooor
        allValues.indoorTemp = temp;
        allValues.indoorHumidity = hum;
        self.logCurrentValues([{
            type: 'indoorTemp',
            value: temp,
            unit: '°C'
        },
        {
            type: 'indoorHumidity',
            value: hum,
            unit: '%'
        }]);
    } else { // Extra units
        allValues['sensor' + sensor + 'temp'] = temp;
        allValues['sensor' + sensor + 'humidity'] = hum;
    }

    log.debug(JSON.stringify(obj));
};

OS_WStation.prototype.decodeAirPressureReport = function(data) {
    var self = this;
    var rel = data[4] + (data[5] & 0x0f) * 256;
    var abs = (data[2] + (data[3] & 0x0f) * 256);
    var fcabs = (data[3] >>> 4);
    var fcstring = ["partly cloudy", "rainy", "cloudy", "sunny", "unknown", "snowy", "unknown"];

    var obj = {};
    obj.reading = 'pressure';
    obj.absolutePressure = abs;
    obj.relativePressure = rel;
    obj.forecast = fcstring[fcabs];
    
    allValues.absoluteAirPressure = abs;
    allValues.relativeAirPressure = rel;
    
    self.logCurrentValues([{
        type: 'absoluteAirPressure',
        value: abs,
        unit: ' mBar'
    },
    {
        type: 'relativeAirPressure',
        value: rel,
        unit: ' mBar'
    },
    {
        type: 'forecast',
        value: fcstring[fcabs],
        unit: ''
    }]);


    log.debug(JSON.stringify(obj));
};

OS_WStation.prototype.decodeUVReport = function(data) {
    var self = this;
    var idx = data[3];

    var obj = {};
    obj.reading = 'uv';
    obj.batteryLevel = self.batteryLevel(data[0]);
    obj.index = idx;
    
    allValues.uvIndex = idx;

    self.logCurrentValues([{
        type: 'uvIndex',
        value: idx,
        unit: ''
    }]);

    log.debug(JSON.stringify(obj));
};

OS_WStation.prototype.decodeWindReport = function(data) {
    var self = this;
    var gust = self.roundedDoubleFromBytes(data[5] & 0x0f, data[4], 0.1);

    var avg = data[6] * 16 + (data[5] >>> 4);
    avg = avg / 10.0;
	
    var dir = (data[2] & 0x0f) * 360.0 / 16.0;

    var obj = {};
    obj.reading = 'wind';
    obj.batteryLevel = self.batteryLevel(data[0]);
    obj.gust = gust;
    obj.average = avg;
    obj.direction = dir;
    
    allValues.windGust = Math.max(gust, allValues.windGust === undefined ? 0 : allValues.windGust);
	allValues.windAverage = Math.max(avg, allValues.windAverage === undefined ? 0 : allValues.windAverage);
    allValues.windDirection = dir;

    self.logCurrentValues([{
        type: 'windAverage',
        value: avg,
        unit: ' m/s'
    },
    {
        type: 'windGust',
        value: gust,
        unit: ' m/s'
    }]);
    
    // Might have wind chill data here too
    if (data[8] != 0x20) {
        var chill = (self.roundedDoubleFromBytes(data[8] & 0x0f, data[7], 0.1) - 32) / 1.8;
        chill = Math.round(chill * 10.0) / 10.0;
        obj.windChill = chill;
        allValues.windChill = Math.min(chill, allValues.windChill === undefined ? 0 : allValues.windChill);;
    }

    log.debug(JSON.stringify(obj));
};

OS_WStation.prototype.decodeStatusReport = function(data) {
    var self = this;
    var internalClock = new Date(data[8] + 2000, data[7], data[6], data[5], data[4], 0, 0);

    var powered = data[0] & 0x80 ? 'no' : 'yes';
    var rcsync = data[0] & 0x20 ? 'yes' : 'no';
    var rcsignal = data[0] & 0x10 ? 'low' : 'high';

    var obj = {};
    obj.reading = 'status';
    obj.battery_level = self.batteryLevel(data[0]);
    obj.internal_clock = internalClock;
    obj.powered = data[0] & 0x80 ? 'no' : 'yes';
    obj.radioClockSync = data[0] & 0x20 ? 'yes' : 'no';
    obj.radioClockSignal = data[0] & 0x10 ? 'low' : 'high';
    
    self.dataLogger.log(allValues);
    
    allValues = {}; // Toss old values
    
    log.debug(JSON.stringify(obj));
};
