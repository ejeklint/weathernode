var PachubeLogger = require('./lib/pachube_logger').PachubeLogger;
var dataLogger = new PachubeLogger();

var OS_WStation = require('./lib/os_wstation').OS_WStation;
var weatherStation = new OS_WStation(dataLogger);