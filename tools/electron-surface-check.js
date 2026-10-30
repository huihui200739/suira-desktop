'use strict';
require('./product-screenshots').run().catch(error => { console.error(error); process.exitCode = 1; });
