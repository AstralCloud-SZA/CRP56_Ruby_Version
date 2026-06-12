const path = require('path');
const fmod = require('./fmod');

fmod.init();

const file = path.join(__dirname, 'audiofiles', 'confirm_style_4_005.wav');
console.log('Playing:', file);
fmod.playOnce(file);

// FMOD plays asynchronously on its own mixer thread.
// If the script exits instantly, you'd cut the sound off.
// So we pump Update() for ~1.5s, then shut down cleanly.
const fmodLib = fmod; // keep ref
let elapsed = 0;
const timer = setInterval(() => {
    elapsed += 50;
    if (elapsed >= 1500) {
        clearInterval(timer);
        fmod.shutdown();
        console.log('✅ Done');
        process.exit(0);
    }
}, 50);