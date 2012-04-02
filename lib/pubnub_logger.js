var nconf = require('nconf');
var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});
var pubnub = require('pubnub');

// Read config.json
nconf.file({
    file: 'config.json'
});

var pubnub = require('pubnub').init({
    publish_key: nconf.get('pubnub:publishKey'),
    subscribe_key: nconf.get('pubnub:subscribeKey'),
    secret_key: nconf.get('pubnub:secretKey'),
});

var pubnubChannel = nconf.get('pubnub:channel');

module.exports = PubnubLogger;

/**
 * Constructor.
 * Sets up a TCP client to pachube.com
 * Somewhat of a crash-only design, if anything goes wrong with the connection,
 * just exit and let some wrapper do a clean restart.
 */
function PubnubLogger() {
    log.debug('Creating pubnub logger for channel ' + pubnubChannel);
}

/**
 * Send updates to pubnub
 */
PubnubLogger.prototype.log = function (msg) {
    pubnub.publish({
        channel: pubnubChannel,
        message: msg,
        callback : function (info) {
            log.debug(info);
        }
    });
}