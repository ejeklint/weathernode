var util = require('util');
var events = require('events');
var HID = require('node-hid');
var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});

var SLACK_URL = 'https://valar.slack.com/services/hooks/incoming-webhook?token=Q5SMXDTGnk6Zwd4nupwduUq4';
var slack = require('slack-notify')(SLACK_URL);

var config = require('../config.json');

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

    log.info('Setting up xively');
    var XivelyLogger = require('./xively_logger');
    self.xively = new XivelyLogger(config.xively);

	if (!config.battery) {
		config.battery = {}
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

    slack.send({
        channel: '#devices',
        icon_emoji: ':strawberry:',
        text: 'Weathernode started on Raspberry π at Valarvägen',
        username: 'Raspberry π'
    });
}

// Set up inheritance from EventEmitter
util.inherits(OS_WStation, events.EventEmitter);

// Logs all all values present in object allValues
OS_WStation.prototype.logAllValues = function (values, callback) {
    if (this.xively)
        this.xively.log(values, callback);
};

/**
 * Handles incoming HID reports and assembles valid data, usually only 1 byte for each report
 * into a complete weather station report. First byte in the HID report tells how many valid
 * bytes follows.
 */
OS_WStation.prototype.handleHIDReport = function(error, data) {
    var self = this;
    // Must re-bind this callback to node-hid module for every use!
    self.hid.read(self.handleHIDReport.bind(self));
    
    if (typeof data === 'undefined') {
        log.error('HID data is undefined. This should not happen.');
        return;
    }

    // Have we found sync sequence?
    if (noOfFFsFound === 2) {
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
                log.warning('Unknown sensor: ' + inbuf[1].toString(16));
                
                inbufIndex = noOfFFsFound = expectedLength = 0;
            }
        }

        if (inbufIndex > 0 && inbufIndex === expectedLength) {
            // Make a copy and check data. If ok, emit an event.
            var data = new Buffer(expectedLength);
            inbuf.copy(data, 0, 0, expectedLength);
            if (self.checkData(data) == true) {
                // Complete reading from station is aquired. Emit an event for the proper handler.
                self.emit('sensor' + data[1].toString(16), data);
            }
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
};

OS_WStation.prototype.checkData = function(buf) {
    var sum = 0;
    var l = buf.length - 2;
    
    var checksum = buf.readInt16LE(l);
    for (var i = 0; i < l; i++) {
        sum += buf[i];
    }
    
    return sum === checksum ? true : false;
};

OS_WStation.prototype.roundedDoubleFromBytes = function(high, low, factor) {
    var result = (high * 256 + low) * factor;
    return Math.round(result * 10) / 10.0;
};

// Checks battery level and reports to Slack if low
OS_WStation.prototype.checkBatteryLevel = function(level, device) {
    var levels = ["none", "low", "high"];
	var level = levels[level & 0x40 ? 1 : 2];
	if (level === 'low' && device) {
		if (!config.battery[device]) config.battery[device] = {};
		config.battery[device].level = level;

		if (!config.battery[device].latest_alert
			|| (config.battery[device].latest_alert && (config.battery[device].latest_alert + 1000 * 3600 * 24) < Date.now())) {
			config.battery[device].latest_alert = Date.now();
			slack.send({
				channel: '#alerts',
				icon_emoji: ':battery:',
				text: 'Battery level is low',
				username: device.charAt(0).toUpperCase() + device.slice(1)
			});
		}
	}
    return level;
};

OS_WStation.prototype.decodeRainReport = function(data) {
    var self = this;
    // Comes in inches... * 0.254 makes mm.
    var totalRain = self.roundedDoubleFromBytes(data[9], data[8], 0.254);
    var rainRate = self.roundedDoubleFromBytes(data[3] & 0x0f, data[2], 0.254);
    var rain1hour = self.roundedDoubleFromBytes(data[5], data[4], 0.254);
    var rain24hour = self.roundedDoubleFromBytes(data[7], data[6], 0.254);

    var rainTotalSince = new Date(data[14] + 2000, data[13], data[12], data[11], data[10], 0, 0);

	self.checkBatteryLevel(data[0], 'rain gauge');

	// Report max rain rate for last minute
    allValues.rainRate = Math.max(rainRate, allValues.rainRate === undefined ? 0 : allValues.rainRate);
    allValues.rainLast1H = rain1hour;
    allValues.rainLast24H = rain24hour;
    allValues.rainTotal = totalRain;
};

OS_WStation.prototype.decodeTempAndHumidityReport = function(data) {
    var self = this;
    var sensor = data[2] & 0x0f;
    var temp = self.roundedDoubleFromBytes(data[4] & 0x0f, data[3], 0.1);
    if (data[4] & 0x80) temp *= -1.0;
    
    if (temp > 100) {
    	slack.send({
			channel: '#alerts',
			icon_emoji: ':warning:',
			text: 'Temp value: ' + temp + ', buf: ' + data.toString('hex'),
			username: 'Temp sensor ' + sensor
		});
    }

	self.checkBatteryLevel(data[0], 'temp sensor ' + sensor);

    var hum = data[5];

    // Dewpoint is of interest for outdoor sensor (no. 1)
    if (sensor === 1) {
        var dew = self.roundedDoubleFromBytes(data[7] & 0x0f, data[6], 0.1);
        if (data[7] & 0x80) dew *= -1.0;

        allValues.dewpoint = dew;
        allValues.outdoorTemp = temp;
        allValues.outdoorHumidity = hum;
    } else if (sensor === 0) { // Main unit indooor
        allValues.indoorTemp = temp;
        allValues.indoorHumidity = hum;
    } else { // Extra units
        allValues['sensor' + sensor + 'temp'] = temp;
        allValues['sensor' + sensor + 'humidity'] = hum;
    }
};

OS_WStation.prototype.decodeAirPressureReport = function(data) {
    var self = this;
    var rel = data[4] + (data[5] & 0x0f) * 256;
    var abs = (data[2] + (data[3] & 0x0f) * 256);
    var fcabs = (data[3] >>> 4);
    var fcstring = ["partly cloudy", "rainy", "cloudy", "sunny", "unknown", "snowy", "unknown"];

    allValues.absoluteAirPressure = abs;
    allValues.relativeAirPressure = rel;
	allValues.forecast = fcstring[fcabs];
};

OS_WStation.prototype.decodeUVReport = function(data) {
    var self = this;
    var idx = data[3];

	self.checkBatteryLevel(data[0], 'uv meter');

    allValues.uvIndex = idx;
};

OS_WStation.prototype.decodeWindReport = function(data) {
    var self = this;
    var gust = self.roundedDoubleFromBytes(data[5] & 0x0f, data[4], 0.1);

    var avg = data[6] * 16 + (data[5] >>> 4);
    avg = avg / 10.0;
	
    var dir = (data[2] & 0x0f) * 360.0 / 16.0;

	self.checkBatteryLevel(data[0], 'wind meter');

    var values = {};
    values.windGust = Math.max(gust, allValues.windGust === undefined ? 0 : allValues.windGust);
    values.windAverage = Math.max(avg, allValues.windAverage === undefined ? 0 : allValues.windAverage);
    values.windDirection = dir;

	// Might have wind chill data here too
	if (data[8] != 0x20) {
		var chill = (self.roundedDoubleFromBytes(data[8] & 0x0f, data[7], 0.1) - 32) / 1.8;
		chill = Math.round(chill * 10.0) / 10.0;
		values.windChill = Math.min(chill, allValues.windChill === undefined ? 0 : allValues.windChill);;
	}

    self.logAllValues(values);
};

// Status report comes once every minute. Log all collected data.
OS_WStation.prototype.decodeStatusReport = function(data) {
    var self = this;
    var internalClock = new Date(data[8] + 2000, data[7], data[6], data[5], data[4], 0, 0);
    
    var powered = data[0] & 0x80 ? 'no' : 'yes';
    var rcsync = data[0] & 0x20 ? 'yes' : 'no';
    var rcsignal = data[0] & 0x10 ? 'low' : 'high';

	self.checkBatteryLevel(data[0], 'base station');

    console.log('Radio clock: ' + rcsync + ', signal: ' + rcsignal + ', internal clock: ' + internalClock.toString());
    
    self.logAllValues(allValues);
    
    allValues = {}; // Toss old values
};
