# Installation

First build node-hid which is a dependency that must be built by hand (for now). Clone https://github.com/hanshuebner/node-hid and build it:

    cd src/
    node-waf configure build

and copy the resulting `node_modules/HID.node` file to your `node_modules`. Then go back to weathernode and

    npm install

Run it with

    node index.js

Note: you must have the weather station plugged in before running weathernode.