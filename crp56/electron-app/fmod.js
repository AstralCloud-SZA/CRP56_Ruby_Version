// fmod.js — FMOD Core bridge via Koffi: auto-discovery + shuffle + volume groups
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

// 1) Load the engine DLL
const dllPath = path.join(__dirname, 'soundengine', 'fmod.dll');
const lib = koffi.load(dllPath);

// 2) Opaque handle types (pointers FMOD owns).
const FMOD_SYSTEM       = 'void *';
const FMOD_SOUND        = 'void *';
const FMOD_CHANNEL      = 'void *';
const FMOD_CHANNELGROUP = 'void *';

// 3) FMOD C functions
const FMOD_System_Create            = lib.func('FMOD_System_Create', 'int', ['_Out_ void **', 'uint']);
const FMOD_System_Init              = lib.func('FMOD_System_Init', 'int', [FMOD_SYSTEM, 'int', 'uint', 'void *']);
const FMOD_System_CreateSound       = lib.func('FMOD_System_CreateSound', 'int', [FMOD_SYSTEM, 'str', 'uint', 'void *', '_Out_ void **']);
const FMOD_System_PlaySound         = lib.func('FMOD_System_PlaySound', 'int', [FMOD_SYSTEM, FMOD_SOUND, FMOD_CHANNELGROUP, 'int', '_Out_ void **']);
const FMOD_System_CreateChannelGroup= lib.func('FMOD_System_CreateChannelGroup', 'int', [FMOD_SYSTEM, 'str', '_Out_ void **']);
const FMOD_System_Update            = lib.func('FMOD_System_Update', 'int', [FMOD_SYSTEM]);
const FMOD_System_Release           = lib.func('FMOD_System_Release', 'int', [FMOD_SYSTEM]);
const FMOD_ChannelGroup_SetVolume   = lib.func('FMOD_ChannelGroup_SetVolume', 'int', [FMOD_CHANNELGROUP, 'float']);

// 4) Constants from fmod_common.h
const FMOD_VERSION     = 0x00020314; // FMOD 2.03.20
const FMOD_INIT_NORMAL = 0x00000000;
const FMOD_LOOP_OFF    = 0x00000001;
const FMOD_2D          = 0x00000008;

function check(result, label) {
    if (result !== 0) throw new Error(`FMOD error in ${label}: code ${result}`);
}

let system = null;
let sfxGroup = null;     // mixer bus for sound effects
let musicGroup = null;   // mixer bus for background music (ready for later)

// ---------------------------------------------------------------------------
// Sound library: auto-discover every .wav in /audiofiles, grouped by category.
// ---------------------------------------------------------------------------
const AUDIO_DIR = path.join(__dirname, 'audiofiles');
const library = {};       // category -> [full paths]
const shuffleState = {};  // category -> { order, pos }

function categoryOf(filename) {
    return filename.split('_')[0].toLowerCase();
}

function loadLibrary() {
    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.toLowerCase().endsWith('.wav'));
    for (const f of files) {
        const cat = categoryOf(f);
        (library[cat] ||= []).push(path.join(AUDIO_DIR, f));
    }
    for (const cat of Object.keys(library)) {
        reshuffle(cat);
        console.log(`🎵 ${cat}: ${library[cat].length} sounds`);
    }
}

function reshuffle(cat) {
    const order = library[cat].map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleState[cat] = { order, pos: 0 };
}

function nextFile(cat) {
    const list = library[cat];
    if (!list || list.length === 0) return null;
    if (shuffleState[cat].pos >= shuffleState[cat].order.length) reshuffle(cat);
    const idx = shuffleState[cat].order[shuffleState[cat].pos++];
    return list[idx];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function init() {
    const sysOut = [null];
    check(FMOD_System_Create(sysOut, FMOD_VERSION), 'System_Create');
    system = sysOut[0];

    check(FMOD_System_Init(system, 64, FMOD_INIT_NORMAL, null), 'System_Init');

    // Create the two mixer buses.
    const sfxOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'sfx', sfxOut), 'CreateChannelGroup(sfx)');
    sfxGroup = sfxOut[0];

    const musicOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'music', musicOut), 'CreateChannelGroup(music)');
    musicGroup = musicOut[0];

    // Heartbeat: FMOD processes audio on its mixer thread when we update.
    setInterval(() => { if (system) FMOD_System_Update(system); }, 20);

    loadLibrary();
    console.log('✅ FMOD system initialized (sfx + music groups ready)');
}

// Play a random sound from a category, routed into the SFX group.
function play(category) {
    if (!system) return;
    const cat = (category || '').toLowerCase();
    const file = nextFile(cat);
    if (!file) { console.warn(`No sounds for category "${cat}"`); return; }

    const soundOut = [null];
    check(FMOD_System_CreateSound(system, file, FMOD_2D | FMOD_LOOP_OFF, null, soundOut), 'CreateSound');
    // 4th arg = channelgroup -> route into sfxGroup so the SFX volume slider controls it.
    check(FMOD_System_PlaySound(system, soundOut[0], sfxGroup, 0, [null]), 'PlaySound');
}

function playAny() {
    const cats = Object.keys(library);
    if (cats.length === 0) return;
    play(cats[Math.floor(Math.random() * cats.length)]);
}

// Volume setters (0.0 = silent, 1.0 = full). Clamped for safety.
function setSfxVolume(v) {
    if (!sfxGroup) return;
    const vol = Math.max(0, Math.min(1, Number(v)));
    check(FMOD_ChannelGroup_SetVolume(sfxGroup, vol), 'SetVolume(sfx)');
}

function setMusicVolume(v) {
    if (!musicGroup) return;
    const vol = Math.max(0, Math.min(1, Number(v)));
    check(FMOD_ChannelGroup_SetVolume(musicGroup, vol), 'SetVolume(music)');
}

function categories() {
    return Object.keys(library).map(c => ({ category: c, count: library[c].length }));
}

function shutdown() {
    if (system) check(FMOD_System_Release(system), 'Release');
}

module.exports = { init, play, playAny, setSfxVolume, setMusicVolume, categories, shutdown };