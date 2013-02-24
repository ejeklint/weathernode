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

module.exports = PusherLogger;

/**
 * Constructor.
 * Sets up a websocket to pusher.com
 * Somewhat of a crash-only design, if anything goes wrong with the connection,
 * just exit and let some wrapper do a clean restart.
 */
function PusherLogger(settings) {
    var self = this;
    var Pusher = require('pusher');
    self.pusher = new Pusher({
      appId: settings.appId,
      key: settings.key,
      secret: settings.secret
    });
    
    self.channel = settings.channel;
    log.info('Creating pusher logger for channel: ' + self.channel);
}

/**
 * Send updates to Pusher
 */
PusherLogger.prototype.log = function (msg) {
    var self = this;
//    var socket_id = '1302.1084207';
    self.pusher.trigger(self.channel, 'data', msg);
}



