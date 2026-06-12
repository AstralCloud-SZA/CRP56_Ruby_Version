// fmod.js — minimal FMOD Core bridge via Koffi
const path = require('path');
const koffi = require('koffi');

// 1) Load the engine DLL
const dllPath = path.join(__dirname, 'soundengine', 'fmod.dll');
const lib = koffi.load(dllPath);

// 2) Opaque handle types. We never look inside these; FMOD owns them.
//    We treat each as "a pointer" — Koffi calls that 'void *'.
//    'out' means FMOD writes the pointer back to us (the ** in C).
const FMOD_SYSTEM  = 'void *';
const FMOD_SOUND   = 'void *';
const FMOD_CHANNEL = 'void *';

// 3) Declare the C functions we need (name, return type, [arg types])
//    These signatures come straight from fmod.h / fmod_common.h.
const FMOD_System_Create     = lib.func('FMOD_System_Create', 'int', ['_Out_ void **', 'uint']);
const FMOD_System_Init        = lib.func('FMOD_System_Init', 'int', [FMOD_SYSTEM, 'int', 'uint', 'void *']);
const FMOD_System_CreateSound = lib.func('FMOD_System_CreateSound', 'int', [FMOD_SYSTEM, 'str', 'uint', 'void *', '_Out_ void **']);
const FMOD_System_PlaySound   = lib.func('FMOD_System_PlaySound', 'int', [FMOD_SYSTEM, FMOD_SOUND, FMOD_CHANNEL, 'int', '_Out_ void **']);
const FMOD_System_Update      = lib.func('FMOD_System_Update', 'int', [FMOD_SYSTEM]);
const FMOD_System_Release     = lib.func('FMOD_System_Release', 'int', [FMOD_SYSTEM]);

// 4) Constants from fmod_common.h
const FMOD_VERSION       = 0x00020308; // header version (2.03.08 style). We'll verify yours below.
const FMOD_INIT_NORMAL   = 0x00000000;
const FMOD_DEFAULT       = 0x00000000;
const FMOD_LOOP_OFF      = 0x00000001;
const FMOD_2D            = 0x00000008;

// helper: throw if an FMOD call didn't return OK (0)
function check(result, label)
{
    if (result !== 0) throw new Error(`FMOD error in ${label}: code ${result}`);
}

let system = null;

function init()
{
    // FMOD_System_Create writes the new system pointer into an output box
    const sysOut = [null];
    check(FMOD_System_Create(sysOut, FMOD_VERSION), 'System_Create');
    system = sysOut[0];

    // 64 = max simultaneous sounds (channels). Plenty for UI sfx.
    check(FMOD_System_Init(system, 64, FMOD_INIT_NORMAL, null), 'System_Init');
    console.log('✅ FMOD system initialized');
}

function playOnce(filePath)
{
    // Create a Sound from a file (2D, no loop — perfect for a click)
    const soundOut = [null];
    check(FMOD_System_CreateSound(system, filePath, FMOD_2D | FMOD_LOOP_OFF, null, soundOut), 'CreateSound');
    const sound = soundOut[0];

    // Play it. channelgroup=null, paused=0 (false), get back a Channel.
    const chanOut = [null];
    check(FMOD_System_PlaySound(system, sound, null, 0, chanOut), 'PlaySound');

    // FMOD needs update() to actually push audio out
    check(FMOD_System_Update(system), 'Update');
}

function shutdown()
{
    if (system) check(FMOD_System_Release(system), 'Release');
}

module.exports = { init, playOnce, shutdown };