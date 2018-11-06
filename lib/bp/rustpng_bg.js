
const path = require('path').join(__dirname, 'output.wasm');
const bytes = require('fs').readFileSync(path);
let imports = {};
imports['./rustpng'] = require('./rustpng');

const wasmModule = new WebAssembly.Module(bytes);
const wasmInstance = new WebAssembly.Instance(wasmModule, imports);
module.exports = wasmInstance.exports;
