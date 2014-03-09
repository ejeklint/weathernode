var request = require('request');
var Logme = require('logme').Logme;
var log = new Logme({
    level: 'info',
    theme: 'clean'
});

module.exports = CosmLogger;

/**
 * Constructor.
 */
function CosmLogger(settings) {
    var self = this;
    self.feed = settings.feed;
    self.apiKey = settings.apiKey;
};

/**
 * Writes data to cosm.com. See API doc at https://cosm.com/docs/v2/
 *
 * @param [{"id": "anID", "current_value": aValue, ... }, { ... } ...] values
 */
CosmLogger.prototype.log = function(values) {
    var self = this;
    // Transform object with measurements into Array, as Cosm prefers it
    var valuesArray = [];
    for (var name in values) {
        var valueObject = {};
        valueObject.id = name;
        valueObject.current_value = values[name];
        valuesArray.push(valueObject);
    }
    
    // Data in body
    var p = {
        "version": "1.0.0",
        "datastreams": valuesArray
    };

    var url = 'http://api.cosm.com/v2/feeds/' + self.feed;
    request.put({url: url, json: p, headers: {'X-ApiKey': self.apiKey}}, function (error, response, body) {
        if (error) {
            log.error('Cosm error: ' + error.message);
        } else if(response && response.statusCode !== 200){
            log.error('Cosm status code: ' + response.statusCode);
        }
    });
};
