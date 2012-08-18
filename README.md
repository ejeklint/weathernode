# Weather data logger

This weather data logger is compatible with Oregon Scientific USB weather stations, like WMR100, WMRS200 and a couple of others. It tries to log same data as Oregon Scientific's own software, which is Windows only and just awful, but as the data protocol is available only under NDA, and they refused to let me sign one, this implementation is based on [reversed engineering](https://github.com/ejeklint/WLoggerDaemon/blob/master/Station_protocol.md) so some tiny things might differ. 

# Installation

First build node-hid which is a dependency that must be built by hand (for now). Clone https://github.com/hanshuebner/node-hid and build it according to his instructions.

Copy the resulting `node-hid/build/Release/HID.node` file to your `node_modules`. Then go back to weathernode and

    npm install

Write a `config.json` with your own API keys. You can use the example one as a start.

Make sure you have the weather station plugged in before running weathernode as the current HID manager doesn't notify when a device is added.

Run it with

    node index.js

Or even better, run it with [forever](https://github.com/indexzero/forever) and it will be restarted automagically should it crash. And it will crash, deliberately, at times when the connection to Cosm or Pusher or Pubnub goes down. Here's how I run it:

    forever start -o log.txt --spinSleepTime 1000 server.js

meaning that it starts, logs to log.txt and wait 1000 ms before restarting after a termination. This works very well for me.
