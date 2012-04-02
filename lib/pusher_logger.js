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
  appId: '17843',
  key: 'ace51076f0f528305227',
  secret: 'f7f115ff705383beb10f'
});

module.exports = PusherLogger;

/**
 * Constructor.
 * Sets up a websocket to pusher.com
 * Somewhat of a crash-only design, if anything goes wrong with the connection,
 * just exit and let some wrapper do a clean restart.
 */
function PusherLogger() {
    log.debug('Creating pusher logger for channel \'valarvägen\'');
}

/**
 * Send updates to Pusher
 */
PusherLogger.prototype.log = function (msg) {
    pusher.trigger('valarvägen',
        'data',
        {"message":msg);
}



