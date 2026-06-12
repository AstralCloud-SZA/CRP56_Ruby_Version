// fmod.js — FMOD Core bridge via Koffi
//   Buses:  sfx + music  ->  master  -> output
//   SFX:    auto-discovered, shuffled, one-shot
//   Music:  looped background tracks with crossfade
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
const FMOD_System_Create             = lib.func('FMOD_System_Create', 'int', ['_Out_ void **', 'uint']);
const FMOD_System_Init               = lib.func('FMOD_System_Init', 'int', [FMOD_SYSTEM, 'int', 'uint', 'void *']);
const FMOD_System_CreateSound        = lib.func('FMOD_System_CreateSound', 'int', [FMOD_SYSTEM, 'str', 'uint', 'void *', '_Out_ void **']);
const FMOD_System_PlaySound          = lib.func('FMOD_System_PlaySound', 'int', [FMOD_SYSTEM, FMOD_SOUND, FMOD_CHANNELGROUP, 'int', '_Out_ void **']);
const FMOD_System_CreateChannelGroup = lib.func('FMOD_System_CreateChannelGroup', 'int', [FMOD_SYSTEM, 'str', '_Out_ void **']);
const FMOD_System_GetMasterChannelGroup = lib.func('FMOD_System_GetMasterChannelGroup', 'int', [FMOD_SYSTEM, '_Out_ void **']);
const FMOD_System_Update             = lib.func('FMOD_System_Update', 'int', [FMOD_SYSTEM]);
const FMOD_System_Release            = lib.func('FMOD_System_Release', 'int', [FMOD_SYSTEM]);

const FMOD_ChannelGroup_SetVolume    = lib.func('FMOD_ChannelGroup_SetVolume', 'int', [FMOD_CHANNELGROUP, 'float']);
const FMOD_ChannelGroup_SetMute      = lib.func('FMOD_ChannelGroup_SetMute', 'int', [FMOD_CHANNELGROUP, 'int']);
const FMOD_ChannelGroup_AddGroup     = lib.func('FMOD_ChannelGroup_AddGroup', 'int', [FMOD_CHANNELGROUP, FMOD_CHANNELGROUP, 'int', '_Out_ void **']);

const FMOD_Channel_SetVolume         = lib.func('FMOD_Channel_SetVolume', 'int', [FMOD_CHANNEL, 'float']);
const FMOD_Channel_Stop              = lib.func('FMOD_Channel_Stop', 'int', [FMOD_CHANNEL]);
const FMOD_Channel_IsPlaying         = lib.func('FMOD_Channel_IsPlaying', 'int', [FMOD_CHANNEL, '_Out_ int *']);
const FMOD_Sound_Release             = lib.func('FMOD_Sound_Release', 'int', [FMOD_SOUND]);

// 4) Constants from fmod_common.h
const FMOD_VERSION     = 0x00020314; // FMOD 2.03.20
const FMOD_INIT_NORMAL = 0x00000000;
const FMOD_LOOP_OFF    = 0x00000001;
const FMOD_LOOP_NORMAL = 0x00000002;
const FMOD_2D          = 0x00000008;

function check(result, label)
{
    if (result !== 0) throw new Error(`FMOD error in ${label}: code ${result}`);
}

let system = null;
let masterGroup = null;  // top-level bus (everything routes here)
let sfxGroup = null;     // sound effects bus
let musicGroup = null;   // background music bus

// ---------------------------------------------------------------------------
// SFX library: auto-discover every .wav in /audiofiles, grouped by category.
// ---------------------------------------------------------------------------
const AUDIO_DIR = path.join(__dirname, 'audiofiles');
const library = {};       // category -> [full paths]
const shuffleState = {};  // category -> { order, pos }

function categoryOf(filename)
{
    return filename.split('_')[0].toLowerCase();
}

function loadLibrary()
{
    if (!fs.existsSync(AUDIO_DIR)) { console.warn('No audiofiles dir'); return; }
    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.toLowerCase().endsWith('.wav'));
    for (const f of files)
    {
        const cat = categoryOf(f);
        (library[cat] ||= []).push(path.join(AUDIO_DIR, f));
    }

    for (const cat of Object.keys(library))
    {
        reshuffle(cat);
        console.log(`🎵 sfx/${cat}: ${library[cat].length} sounds`);
    }

}

function reshuffle(cat)
{
    const order = library[cat].map((_, i) => i);

    for (let i = order.length - 1; i > 0; i--)
    {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleState[cat] = { order, pos: 0 };
}

function nextFile(cat)
{
    const list = library[cat];
    if (!list || list.length === 0) return null;
    if (shuffleState[cat].pos >= shuffleState[cat].order.length) reshuffle(cat);
    const idx = shuffleState[cat].order[shuffleState[cat].pos++];
    return list[idx];
}

// ---------------------------------------------------------------------------
// Music library: tracks in /music (looped background music).
// ---------------------------------------------------------------------------
const MUSIC_DIR = path.join(__dirname, 'music');
let musicTracks = [];          // [{ name, path }]
let currentMusicChannel = null; // FMOD Channel handle of the playing track
let currentMusicSound = null;   // FMOD Sound handle (so we can release it)
let currentTrackName = null;
let fadeTimer = null;
let targetMusicVolume = 1.0;    // music bus volume is separate; this is per-channel base

function loadMusicList()
{
    musicTracks = [];
    if (!fs.existsSync(MUSIC_DIR)) { console.warn('No music dir (create electron-app/music)'); return; }
    const exts = ['.mp3', '.ogg', '.wav', '.flac'];
    const files = fs.readdirSync(MUSIC_DIR).filter(f => exts.includes(path.extname(f).toLowerCase()));
    musicTracks = files.map(f => ({ name: path.parse(f).name, path: path.join(MUSIC_DIR, f) }));
    console.log(`🎼 music: ${musicTracks.length} tracks`);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init()
{
    const sysOut = [null];
    check(FMOD_System_Create(sysOut, FMOD_VERSION), 'System_Create');
    system = sysOut[0];

    check(FMOD_System_Init(system, 64, FMOD_INIT_NORMAL, null), 'System_Init');

    // Master bus = FMOD's built-in master channel group.
    const masterOut = [null];
    check(FMOD_System_GetMasterChannelGroup(system, masterOut), 'GetMasterChannelGroup');
    masterGroup = masterOut[0];

    // Create sfx + music buses, then nest them UNDER master.
    const sfxOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'sfx', sfxOut), 'CreateChannelGroup(sfx)');
    sfxGroup = sfxOut[0];

    const musicOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'music', musicOut), 'CreateChannelGroup(music)');
    musicGroup = musicOut[0];

    // AddGroup: make sfx + music children of master. (last arg = connection out, ignored)
    check(FMOD_ChannelGroup_AddGroup(masterGroup, sfxGroup, 0, [null]), 'AddGroup(sfx->master)');
    check(FMOD_ChannelGroup_AddGroup(masterGroup, musicGroup, 0, [null]), 'AddGroup(music->master)');

    // Heartbeat.
    setInterval(() => { if (system) FMOD_System_Update(system); }, 20);

    loadLibrary();
    loadMusicList();
    console.log('✅ FMOD initialized (master > sfx + music)');
}

// ---------------------------------------------------------------------------
// SFX playback (routed into sfx bus)
// ---------------------------------------------------------------------------
function play(category)
{
    if (!system) return;
    const cat = (category || '').toLowerCase();
    const file = nextFile(cat);
    if (!file) { console.warn(`No sounds for category "${cat}"`); return; }

    const soundOut = [null];
    check(FMOD_System_CreateSound(system, file, FMOD_2D | FMOD_LOOP_OFF, null, soundOut), 'CreateSound');
    check(FMOD_System_PlaySound(system, soundOut[0], sfxGroup, 0, [null]), 'PlaySound(sfx)');
}

function playAny()
{
    const cats = Object.keys(library);
    if (cats.length === 0) return;
    play(cats[Math.floor(Math.random() * cats.length)]);
}

// ---------------------------------------------------------------------------
// Music playback (routed into music bus, looped, with crossfade)
// ---------------------------------------------------------------------------
function listMusic()
{
    return musicTracks.map(t => t.name);
}

// Start a track by name (matches file name without extension). Crossfades from
// any currently-playing track.
function playMusic(name, { fadeMs = 1200 } = {})
{
    if (!system) return;
    const track = musicTracks.find(t => t.name === name) || musicTracks[0];
    if (!track) { console.warn('No music tracks available'); return; }
    if (currentTrackName === track.name && isMusicPlaying()) return; // already playing

    // Create the looping sound.
    const soundOut = [null];
    check(FMOD_System_CreateSound(system, track.path, FMOD_2D | FMOD_LOOP_NORMAL, null, soundOut), 'CreateSound(music)');
    const newSound = soundOut[0];

    // Play it PAUSED so we can set start volume to 0 before it's audible.
    const chanOut = [null];
    check(FMOD_System_PlaySound(system, newSound, musicGroup, 1 /* paused */, chanOut), 'PlaySound(music)');
    const newChannel = chanOut[0];
    FMOD_Channel_SetVolume(newChannel, 0.0);

    // Capture the old track to fade out.
    const oldChannel = currentMusicChannel;
    const oldSound = currentMusicSound;

    currentMusicChannel = newChannel;
    currentMusicSound = newSound;
    currentTrackName = track.name;

    // Unpause the new channel (paused flag lives on the channel; easiest is to set volume up via fade)
    // We unpause by toggling stop->no; FMOD plays once we ramp volume. Simplest: just set paused off.
    // Koffi: use SetVolume ramp; channel was started paused=1, so we must clear paused.
    // (We re-declare SetPaused here inline.)
    newChannelSetPaused(newChannel, false);

    crossfade(oldChannel, oldSound, newChannel, fadeMs);
    console.log('🎼 playing music:', track.name);
}

// inline binding for SetPaused (kept here to keep the public surface tidy)
const FMOD_Channel_SetPaused = lib.func('FMOD_Channel_SetPaused', 'int', [FMOD_CHANNEL, 'int']);
function newChannelSetPaused(channel, paused)
{
    if (channel) FMOD_Channel_SetPaused(channel, paused ? 1 : 0);
}

function crossfade(oldChannel, oldSound, newChannel, fadeMs)
{
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    const steps = Math.max(1, Math.floor(fadeMs / 40));
    let step = 0;
    fadeTimer = setInterval(() =>
    {
        step++;
        const t = step / steps;            // 0 -> 1
        if (newChannel) FMOD_Channel_SetVolume(newChannel, Math.min(1, t) * targetMusicVolume);
        if (oldChannel) FMOD_Channel_SetVolume(oldChannel, Math.max(0, 1 - t) * targetMusicVolume);
        if (step >= steps)
        {
            clearInterval(fadeTimer); fadeTimer = null;
            if (oldChannel) { try { FMOD_Channel_Stop(oldChannel); } catch (_) {} }
            if (oldSound)   { try { FMOD_Sound_Release(oldSound); } catch (_) {} }
        }
    }, 40);
}

function stopMusic({ fadeMs = 800 } = {})
{
    if (!currentMusicChannel) return;
    const ch = currentMusicChannel;
    const snd = currentMusicSound;
    currentMusicChannel = null;
    currentMusicSound = null;
    currentTrackName = null;
    // fade out then stop
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    const steps = Math.max(1, Math.floor(fadeMs / 40));
    let step = 0;
    fadeTimer = setInterval(() =>
    {
        step++;
        const t = 1 - step / steps;
        FMOD_Channel_SetVolume(ch, Math.max(0, t) * targetMusicVolume);
        if (step >= steps) {
            clearInterval(fadeTimer); fadeTimer = null;
            try { FMOD_Channel_Stop(ch); } catch (_) {}
            try { if (snd) FMOD_Sound_Release(snd); } catch (_) {}
        }
    }, 40);
}

function isMusicPlaying()
{
    if (!currentMusicChannel) return false;
    const out = [0];
    const r = FMOD_Channel_IsPlaying(currentMusicChannel, out);
    return r === 0 && out[0] === 1;
}

// ---------------------------------------------------------------------------
// Volume / mute (bus-level)
// ---------------------------------------------------------------------------
function clamp01(v) { return Math.max(0, Math.min(1, Number(v))); }

function setMasterVolume(v) { if (masterGroup) check(FMOD_ChannelGroup_SetVolume(masterGroup, clamp01(v)), 'SetVolume(master)'); }
function setSfxVolume(v)    { if (sfxGroup)    check(FMOD_ChannelGroup_SetVolume(sfxGroup, clamp01(v)), 'SetVolume(sfx)'); }
function setMusicVolume(v)  { if (musicGroup)  check(FMOD_ChannelGroup_SetVolume(musicGroup, clamp01(v)), 'SetVolume(music)'); }
function setMuteAll(muted)  { if (masterGroup) check(FMOD_ChannelGroup_SetMute(masterGroup, muted ? 1 : 0), 'SetMute(master)'); }

function categories()
{
    return Object.keys(library).map(c => ({ category: c, count: library[c].length }));
}

function shutdown() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (system) check(FMOD_System_Release(system), 'Release');
}

module.exports = {
    init,
    // sfx
    play, playAny, categories,
    // music
    playMusic, stopMusic, listMusic, isMusicPlaying,
    // mixer
    setMasterVolume, setSfxVolume, setMusicVolume, setMuteAll,
    shutdown,
};