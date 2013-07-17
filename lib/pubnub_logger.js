var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});
var pubnub = require('pubnub');

var pubnub ;
var channel;

module.exports = PubnubLogger;

/**
 * Constructor.
 */
function PubnubLogger(settings) {
    pubnub = require('pubnub').init({
        publish_key: settings.publishKey,
        subscribe_key: settings.subscribeKey,
        secret_key: settings.secretKey
    });

    channel = settings.channel
    log.info('Creating pubnub logger for channel ' + channel);
}

/**
 * Send updates to pubnub
 */
PubnubLogger.prototype.log = function (msg) {
    pubnub.publish({
        channel: channel,
        message: msg,
        callback : function (info) {
            log.debug(info);
        }
    });
}