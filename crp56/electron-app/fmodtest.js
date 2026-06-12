const path = require('path');
const koffi = require('koffi');

const dllPath = path.join(__dirname, 'soundengine', 'fmod.dll');
console.log('Trying to load:', dllPath);

try {
    const fmod = koffi.load(dllPath);
    console.log(' SUCCESS -> Koffi opened fmod.dll');
} catch (err) {
    console.error(' FAILED -> to load fmod.dll');
    console.error(err.message);
}