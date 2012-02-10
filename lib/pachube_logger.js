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

/**
 * Constructor.
 * Sets up a TCP client to pachube.com
 * 
 */

function PachubeLogger() {
    this.tcpClient = new net.Socket();
    this.tcpClient.connect(8081, 'beta.pachube.com', function() { // TODO: Get URL from settings
        log.info('Connection to Pachube established.');
    });
    this.tcpClient.on('data', function(data) {
        log.debug(data);
        var d = JSON.parse(data);
        if (d.status != 200) {
            log.error(data);
        }
    });
    this.tcpClient.on('error', function(data) {
        // Exit process and let someone (like forever) restart it
        log.critical('Communication error. Exiting.');
        throw new Error(data);
    });
    this.tcpClient.on('close', function() {
        log.info('Connection to Pachube closed.');
    });
}

/**
 * Writes data to pachube.com.
 * 
 * @param [{"id": "anID", "current_value": aValue, ... }, { ... } ...] values
 */
PachubeLogger.prototype.log = function(values) {
    // Add stuff...
    var p = {};
    p.method = 'put';
    p.resource = '/feeds/' + nconf.get('pachubeFeed');
    p.headers = {
        'X-PachubeApiKey': nconf.get('pachubeApiKey')
    };
    p.body = {
        "version": "1.0.0",
        "datastreams": values
    };
    log.debug(JSON.stringify(p));

    this.tcpClient.write(JSON.stringify(p));
};

/**
 * Exports constructor.
 */
exports.PachubeLogger = PachubeLogger;