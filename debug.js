var addon = require('bindings')('cppApiWrapper');
console.log(JSON.parse(addon.hello()));
