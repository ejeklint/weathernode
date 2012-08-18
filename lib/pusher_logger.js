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

// https://github.com/crossbreeze/node-pusher
var Pusher = require('node-pusher');
var pusher = new Pusher({
  appId: nconf.get('pusher:appId'),
  key: nconf.get('pusher:key'),
  secret: nconf.get('pusher:secret')
});

module.exports = PusherLogger;

/**
 * Constructor.
 * Sets up a websocket to pusher.com
 * Somewhat of a crash-only design, if anything goes wrong with the connection,
 * just exit and let some wrapper do a clean restart.
 */
function PusherLogger() {
    log.info('Creating pusher logger for channel \'valarvägen\'');
}

/**
 * Send updates to Pusher
 */
PusherLogger.prototype.log = function (msg) {
//    var socket_id = '1302.1084207';
    pusher.trigger(nconf.get('pusher:channel'), 'data', msg);
}



