var net = require('net');
var nconf = require('nconf');
var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});

// Read config.json
nconf.file({
    file: 'config.json'
});

module.exports = PachubeLogger;

/**
 * Constructor.
 * Sets up a TCP client to pachube.com
 * Somewhat of a crash-only design, if anything goes wrong with the connection,
 * just exit and let some wrapper do a clean restart.
 */
function PachubeLogger() {
    var self = this;
    self.tcpClient = new net.Socket();
    self.tcpClient.connect(8081, 'beta.pachube.com', function() { // TODO: Get URL from settings
        log.info('Connection to Pachube established.');
    });
    self.tcpClient.on('data', function(data) {
        log.debug(data);
        var d = JSON.parse(data);
        if (d.status != 200) {
            log.error(data);
        }
    });
    self.tcpClient.on('error', function(data) {
        // WTF? Exit process.
        log.critical('Communication error. Exiting.');
        throw new Error(data);
    });
    self.tcpClient.on('close', function(data) {
        // We should never close connection. Exit process.
        log.critical('Connection to Pachube closed unexpectedly. Exiting.');
        throw new Error(data);
    });
}

/**
 * Writes data to pachube.com.
 * 
 * @param [{"id": "anID", "current_value": aValue, ... }, { ... } ...] values
 */
PachubeLogger.prototype.log = function(values) {
    var self = this;
    
    // Object to Array as Pachube prefers it
    var valuesArray = [];
    for (var name in values) {
        var valueObject = {};
        valueObject.id = name;
        valueObject.current_value = values[name];
        valuesArray.push(valueObject);
    }
    
    // Add stuff...
    var p = {};
    p.method = 'put';
    p.resource = '/feeds/' + nconf.get('pachube:feed');
    p.headers = {
        'X-PachubeApiKey': nconf.get('pachube:apiKey')
    };
    p.body = {
        "version": "1.0.0",
        "datastreams": valuesArray
    };
    log.debug(JSON.stringify(p));

    self.tcpClient.write(JSON.stringify(p));
};