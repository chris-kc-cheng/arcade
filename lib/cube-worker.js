const { parentPort, workerData } = require('node:worker_threads');
const { Cube } = require('./cube');
Cube.initSolver();
parentPort.postMessage(Cube.fromString(workerData).solve().trim().split(/\s+/).filter(Boolean));
