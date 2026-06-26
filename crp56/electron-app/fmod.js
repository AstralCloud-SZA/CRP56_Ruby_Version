const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

function resourcePath(...segments)
{
    return app && app.isPackaged
        ? path.join(process.resourcesPath, ...segments)
        : path.join(__dirname, ...segments);
}

function getFmodDllPath()
{
    const candidates = app && app.isPackaged
        ? [
            path.join(process.resourcesPath, 'soundengine', 'fmod.dll'),
            path.join(process.resourcesPath, 'fmod.dll')
        ]
        : [
            path.join(__dirname, 'soundengine', 'fmod.dll'),
            path.join(__dirname, '..', 'soundengine', 'fmod.dll'),
            path.join(process.cwd(), 'soundengine', 'fmod.dll')
        ];

    for (const p of candidates)
    {
        if (p && fs.existsSync(p)) return p;
    }

    throw new Error(`FMOD DLL not found. Tried: ${candidates.join(' | ')}`);
}

const dllPath = getFmodDllPath();
const lib = koffi.load(dllPath);

const FMOD_SYSTEM = 'void *';
const FMOD_SOUND = 'void *';
const FMOD_CHANNEL = 'void *';
const FMOD_CHANNELGROUP = 'void *';
const FMOD_BOOL = 'int';

const FMOD_System_Create = lib.func('FMOD_System_Create', 'int', ['_Out_ void **', 'uint']);
const FMOD_System_Init = lib.func('FMOD_System_Init', 'int', [FMOD_SYSTEM, 'int', 'uint', 'void *']);
const FMOD_System_CreateSound = lib.func('FMOD_System_CreateSound', 'int', [FMOD_SYSTEM, 'str', 'uint', 'void *', '_Out_ void **']);
const FMOD_System_PlaySound = lib.func('FMOD_System_PlaySound', 'int', [FMOD_SYSTEM, FMOD_SOUND, FMOD_CHANNELGROUP, FMOD_BOOL, '_Out_ void **']);
const FMOD_System_CreateChannelGroup = lib.func('FMOD_System_CreateChannelGroup', 'int', [FMOD_SYSTEM, 'str', '_Out_ void **']);
const FMOD_System_GetMasterChannelGroup = lib.func('FMOD_System_GetMasterChannelGroup', 'int', [FMOD_SYSTEM, '_Out_ void **']);
const FMOD_System_Update = lib.func('FMOD_System_Update', 'int', [FMOD_SYSTEM]);
const FMOD_System_Release = lib.func('FMOD_System_Release', 'int', [FMOD_SYSTEM]);

const FMOD_ChannelGroup_SetVolume = lib.func('FMOD_ChannelGroup_SetVolume', 'int', [FMOD_CHANNELGROUP, 'float']);
const FMOD_ChannelGroup_SetMute = lib.func('FMOD_ChannelGroup_SetMute', 'int', [FMOD_CHANNELGROUP, FMOD_BOOL]);
const FMOD_ChannelGroup_AddGroup = lib.func('FMOD_ChannelGroup_AddGroup', 'int', [FMOD_CHANNELGROUP, FMOD_CHANNELGROUP, FMOD_BOOL, '_Out_ void **']);

const FMOD_Channel_SetVolume = lib.func('FMOD_Channel_SetVolume', 'int', [FMOD_CHANNEL, 'float']);
const FMOD_Channel_SetPaused = lib.func('FMOD_Channel_SetPaused', 'int', [FMOD_CHANNEL, FMOD_BOOL]);
const FMOD_Channel_GetPaused = lib.func('FMOD_Channel_GetPaused', 'int', [FMOD_CHANNEL, '_Out_ int *']);
const FMOD_Channel_Stop = lib.func('FMOD_Channel_Stop', 'int', [FMOD_CHANNEL]);
const FMOD_Channel_IsPlaying = lib.func('FMOD_Channel_IsPlaying', 'int', [FMOD_CHANNEL, '_Out_ int *']);
const FMOD_Sound_Release = lib.func('FMOD_Sound_Release', 'int', [FMOD_SOUND]);

const FMOD_Sound_GetLength = lib.func('FMOD_Sound_GetLength', 'int', [FMOD_SOUND, '_Out_ uint *', 'uint']);
const FMOD_Channel_GetPosition = lib.func('FMOD_Channel_GetPosition', 'int', [FMOD_CHANNEL, '_Out_ uint *', 'uint']);
const FMOD_System_GetNumDrivers = lib.func('FMOD_System_GetNumDrivers', 'int', [FMOD_SYSTEM, '_Out_ int *']);
const FMOD_System_GetDriverInfo = lib.func('FMOD_System_GetDriverInfo', 'int', [FMOD_SYSTEM, 'int', 'char *', 'int', 'void *', 'void *', 'void *', 'void *']);
const FMOD_System_SetDriver = lib.func('FMOD_System_SetDriver', 'int', [FMOD_SYSTEM, 'int']);

const FMOD_VERSION = 0x00020314;
const FMOD_INIT_NORMAL = 0x00000000;
const FMOD_LOOP_OFF = 0x00000001;
const FMOD_LOOP_NORMAL = 0x00000002;
const FMOD_2D = 0x00000008;
const FMOD_TIMEUNIT_MS = 0x00000002;
const FMOD_ACCURATETIME = 0x00004000;

const MUSIC_DIR = resourcePath('audiofiles', 'Friday_Magic');
const AUDIO_DIR = resourcePath('audiofiles');

let musicTracks = [];
let currentMusicChannel = null;
let currentMusicSound = null;
let currentTrackName = null;
let fadeTimer = null;
let targetMusicVolume = 1.0;
let currentTrackLength_MS = 0;
let musicEndWatcher = null;

let system = null;
let masterGroup = null;
let sfxGroup = null;
let musicGroup = null;
let updateTimer = null;
let diagTimer = null;


const library = {};
const shuffleState = {};


function loadLibrary()
{
    Object.keys(library).forEach(k => delete library[k]);
    Object.keys(shuffleState).forEach(k => delete shuffleState[k]);

    log('Scanning SFX directory:', AUDIO_DIR);
    if (!fs.existsSync(AUDIO_DIR))
    {
        warn('No audiofiles dir at', AUDIO_DIR);
        return;
    }

    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.toLowerCase().endsWith('.wav'));
    log('SFX .wav files found:', files.length);

    for (const f of files)
    {
        const cat = categoryOf(f);
        (library[cat] ||= []).push(path.join(AUDIO_DIR, f));
    }

    for (const cat of Object.keys(library).sort())
    {
        reshuffle(cat);
        log(`sfx/${cat}: ${library[cat].length} sounds`);
        library[cat].forEach((file, i) => log(`  [${cat} ${i + 1}] ${file}`));
    }
}

function reshuffle(cat)
{
    const list = library[cat] || [];
    const order = list.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--)
    {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleState[cat] = { order, pos: 0 };
    log(`reshuffle(${cat}) -> [${order.join(', ')}]`);
}

function nextFile(cat)
{
    const list = library[cat];
    if (!list || list.length === 0) return null;
    if (!shuffleState[cat] || shuffleState[cat].pos >= shuffleState[cat].order.length) reshuffle(cat);
    const state = shuffleState[cat];
    const idx = state.order[state.pos++];
    const file = list[idx];
    log(`nextFile(${cat}) -> index ${idx}, pos ${state.pos}/${state.order.length}, file ${file}`);
    return file;
}



function init()
{
    log('Initializing FMOD');
    log('DLL path:', dllPath);
    log('Process cwd:', process.cwd());
    log('Module dir:', __dirname);

    const sysOut = [null];
    check(FMOD_System_Create(sysOut, FMOD_VERSION), 'System_Create');
    system = sysOut[0];
    log('System created ->', ptrLabel(system));

    check(FMOD_System_Init(system, 64, FMOD_INIT_NORMAL, null), 'System_Init');
    log('System initialized');

    const masterOut = [null];
    check(FMOD_System_GetMasterChannelGroup(system, masterOut), 'GetMasterChannelGroup');
    masterGroup = masterOut[0];
    log('Master group ->', ptrLabel(masterGroup));

    const sfxOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'sfx', sfxOut), 'CreateChannelGroup(sfx)');
    sfxGroup = sfxOut[0];
    log('SFX group ->', ptrLabel(sfxGroup));

    const musicOut = [null];
    check(FMOD_System_CreateChannelGroup(system, 'music', musicOut), 'CreateChannelGroup(music)');
    musicGroup = musicOut[0];
    log('Music group ->', ptrLabel(musicGroup));

    check(FMOD_ChannelGroup_AddGroup(masterGroup, sfxGroup, 0, [null]), 'AddGroup(sfx->master)');
    check(FMOD_ChannelGroup_AddGroup(masterGroup, musicGroup, 0, [null]), 'AddGroup(music->master)');
    log('Child groups routed to master');

    check(FMOD_ChannelGroup_SetVolume(masterGroup, 1.0), 'SetVolume(master init)');
    check(FMOD_ChannelGroup_SetVolume(sfxGroup, 1.0), 'SetVolume(sfx init)');
    check(FMOD_ChannelGroup_SetVolume(musicGroup, 1.0), 'SetVolume(music init)');
    check(FMOD_ChannelGroup_SetMute(masterGroup, 0), 'SetMute(master init false)');
    check(FMOD_ChannelGroup_SetMute(sfxGroup, 0), 'SetMute(sfx init false)');
    check(FMOD_ChannelGroup_SetMute(musicGroup, 0), 'SetMute(music init false)');
    log('Initial bus volumes and mute states forced to sane defaults');

    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() =>
    {
        if (!system) return;
        const rc = FMOD_System_Update(system);
        if (rc !== 0) err('System_Update returned', rc);
    }, 20);
    log('System update heartbeat started (20ms)');

    loadLibrary();
    loadMusicList();
    dumpMixerState('post-init');
    dumpMusicState('post-init');
    startDiagnostics();
    log('FMOD initialized (master > sfx + music)');
}

function play(category)
{
    if (!system)
    {
        warn('play() called but system is null');
        return;
    }

    const cat = String(category || '').toLowerCase();
    log(`play(${cat}) requested`);
    dumpMixerState(`before play(${cat})`);

    const file = nextFile(cat);
    if (!file)
    {
        warn(`No sounds for category "${cat}"`);
        return;
    }

    if (!fs.existsSync(file))
    {
        err(`Resolved SFX file does not exist: ${file}`);
        return;
    }

    const stat = safeCall(`fs.statSync(${file})`, () => fs.statSync(file), null);
    if (stat) log(`SFX file size for ${file}: ${stat.size} bytes`);

    const soundOut = [null];
    let rc = FMOD_System_CreateSound(system, file, FMOD_2D | FMOD_LOOP_OFF, null, soundOut);
    if (rc !== 0)
    {
        err(`CreateSound failed (code ${rc}) for: ${file}`);
        return;
    }

    const sound = soundOut[0];
    log('CreateSound ok -> sound ptr', ptrLabel(sound));

    const channelOut = [null];
    rc = FMOD_System_PlaySound(system, sound, sfxGroup, 0, channelOut);
    if (rc !== 0)
    {
        err(`PlaySound failed (code ${rc}) for: ${file}`);
        try { FMOD_Sound_Release(sound); } catch (_) {}
        return;
    }

    const channel = channelOut[0];
    log('PlaySound ok -> channel ptr', ptrLabel(channel));

    safeCall('Channel_SetVolume(sfx one-shot)', () => check(FMOD_Channel_SetVolume(channel, 1.0), 'Channel_SetVolume(sfx one-shot)'));
    safeCall('Channel_SetPaused(false)', () => check(FMOD_Channel_SetPaused(channel, 0), 'Channel_SetPaused(false)'));

    const pausedOut = [0];
    const pausedRc = safeCall('Channel_GetPaused(immediate)', () => FMOD_Channel_GetPaused(channel, pausedOut), -1);

    log(`playing sfx/${cat}: ${file}`);
    log(`channel immediate -> pausedRc=${pausedRc} paused=${pausedOut[0]}`);
    dumpMixerState(`after play(${cat})`);

    let pollCount = 0;
    const poll = setInterval(() =>
    {
        pollCount += 1;
        try
        {
            const playingOut = [0];
            const rr = FMOD_Channel_IsPlaying(channel, playingOut);
            if (rr !== 0)
            {
                err(`Channel_IsPlaying returned ${rr} for ${file} on poll ${pollCount}`);
                clearInterval(poll);
                try { FMOD_Sound_Release(sound); } catch (_) {}
                return;
            }

            const pausedOut2 = [0];
            const rp = FMOD_Channel_GetPaused(channel, pausedOut2);
            // log(`poll #${pollCount} for ${path.basename(file)} -> playing=${playingOut[0]} pausedRc=${rp} paused=${pausedOut2[0]}`);

            if (playingOut[0] !== 1)
            {
                log(`SFX finished for ${file}; releasing sound ptr ${ptrLabel(sound)}`);
                clearInterval(poll);
                try { FMOD_Sound_Release(sound); } catch (e) { err('Sound_Release after SFX failed:', e.message); }
            }
        }
        catch (e)
        {
            err(`SFX poll threw for ${file}:`, e.message);
            clearInterval(poll);
            try { FMOD_Sound_Release(sound); } catch (_) {}
        }
    }, 100);
}

function playAny()
{
    const cats = Object.keys(library);
    if (cats.length === 0)
    {
        warn('playAny() called but no SFX categories are loaded');
        return;
    }
    const idx = Math.floor(Math.random() * cats.length);
    log(`playAny() -> category index ${idx}, category ${cats[idx]}`);
    play(cats[idx]);
}

function listMusic()
{
    return musicTracks.map(t => t.name);
}

function newChannelSetPaused(channel, paused)
{
    if (!channel) return;
    safeCall(`SetPaused(${paused})`, () => check(FMOD_Channel_SetPaused(channel, paused ? 1 : 0), `SetPaused(${paused})`));
}

function crossfade(oldChannel, oldSound, newChannel, fadeMs)
{
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    const steps = Math.max(1, Math.floor(fadeMs / 40));
    let step = 0;
    log(`crossfade start -> fadeMs=${fadeMs}, steps=${steps}, old=${ptrLabel(oldChannel)}, new=${ptrLabel(newChannel)}`);
    fadeTimer = setInterval(() =>
    {
        step++;
        const t = step / steps;
        if (newChannel) FMOD_Channel_SetVolume(newChannel, Math.min(1, t) * targetMusicVolume);
        if (oldChannel) FMOD_Channel_SetVolume(oldChannel, Math.max(0, 1 - t) * targetMusicVolume);
        if (step >= steps)
        {
            clearInterval(fadeTimer); fadeTimer = null;
            if (oldChannel) { try { FMOD_Channel_Stop(oldChannel); } catch (_) {} }
            if (oldSound) { try { FMOD_Sound_Release(oldSound); } catch (_) {} }
            log('crossfade complete');
            dumpMusicState('after crossfade complete');
        }
    }, 40);
}

function playMusic(name, { fadeMs = 1200 } = {})
{
    if (!system) { warn('playMusic() called but system is null'); return; }
    const track = musicTracks.find(t => t.name === name) || musicTracks[0];
    if (!track) { warn('No music tracks available'); return; }

    if (currentTrackName === track.name && isMusicPlaying())
    {
        log(`playMusic(${track.name}) ignored; already playing`);
        return;
    }

    log(`[music] playMusic called with: ${name}`);
    log('[music] resolved track:', { name: track.name, path: track.path });

    const soundOut = [null];
    const createRc = FMOD_System_CreateSound(system, track.path, FMOD_2D | FMOD_LOOP_OFF | FMOD_ACCURATETIME, null, soundOut);
    log('[music] CreateSound rc:', createRc);
    check(createRc, 'CreateSound(music)');
    const newSound = soundOut[0];
    log('[music] sound ptr ->', ptrLabel(newSound));

    const lenOut = [0];
    const lenRc = FMOD_Sound_GetLength(newSound, lenOut, FMOD_TIMEUNIT_MS);

    let trackLengthMs;
    if (lenRc === 0)
    {
        trackLengthMs = lenOut[0];
    }
    else
    {
        trackLengthMs = 0;
        warn('[music] GetLength failed rc:', lenRc, '-> track length unknown, watcher will use IsPlaying fallback');
    }

    log('[music] track length ms:', trackLengthMs, '(rc:', lenRc + ')');
    const chanOut = [null];
    const playRc = FMOD_System_PlaySound(system, newSound, musicGroup, 0, chanOut);
    log('[music] PlaySound rc:', playRc);
    check(playRc, 'PlaySound(music)');
    const newChannel = chanOut[0];
    log('[music] channel ptr ->', ptrLabel(newChannel));

    FMOD_Channel_SetVolume(newChannel, 0.0);

    const oldChannel = currentMusicChannel;
    const oldSound = currentMusicSound;

    currentMusicChannel = newChannel;
    currentMusicSound = newSound;
    currentTrackName = track.name;
    currentTrackLength_MS = trackLengthMs;

    crossfade(oldChannel, oldSound, newChannel, fadeMs);
    dumpMixerState(`after playMusic(${track.name})`);
    log('[music] playing music:', track.name);
    startMusicEndWatcher();
}

function stopMusic({ fadeMs = 800 } = {})
{
    log('[music] stopMusic called');

    if (musicEndWatcher)
    {
        clearInterval(musicEndWatcher);
        musicEndWatcher = null;
        log('[music] cleared end watcher in stopMusic');
    }

    if (!currentMusicChannel)
    {
        log('stopMusic() ignored; no current music channel');
        return;
    }

    const ch = currentMusicChannel;
    const snd = currentMusicSound;
    currentMusicChannel = null;
    currentMusicSound = null;
    currentTrackName = null;
    currentTrackLength_MS = 0;

    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }

    const steps = Math.max(1, Math.floor(fadeMs / 40));
    let step = 0;
    log(`stopMusic() -> fadeMs=${fadeMs}, steps=${steps}, channel=${ptrLabel(ch)}`);

    fadeTimer = setInterval(() =>
    {
        step++;
        const t = 1 - step / steps;
        FMOD_Channel_SetVolume(ch, Math.max(0, t) * targetMusicVolume);
        if (step >= steps)
        {
            clearInterval(fadeTimer); fadeTimer = null;
            try { FMOD_Channel_Stop(ch); } catch (_) {}
            try { if (snd) FMOD_Sound_Release(snd); } catch (_) {}
            log('stopMusic() complete');
            dumpMusicState('after stopMusic');
        }
    }, 40);
}

function isMusicPlaying()
{
    if (!currentMusicChannel) return false;
    const out = [0];
    const r = FMOD_Channel_IsPlaying(currentMusicChannel, out);
    log(`isMusicPlaying() -> rc=${r}, playing=${out[0]}`);
    return r === 0 && out[0] === 1;
}


//
function categories()
{
    return Object.keys(library).map(c => ({ category: c, count: library[c].length }));
}

function advanceToNextTrack(fromTrackName)
{
    if (!musicTracks.length)
    {
        warn('[music watcher] no tracks available to advance to');
        return;
    }

    const available = musicTracks.filter(t => t.name !== fromTrackName);
    const pool = available.length > 0 ? available : musicTracks;
    const nextTrack = pool[Math.floor(Math.random() * pool.length)];

    log('[music watcher] next track selected:', nextTrack ? nextTrack.name : null);

    if (nextTrack)
    {
        playMusic(nextTrack.name);
    }
}

function startMusicEndWatcher()
{
    if (musicEndWatcher)
    {
        clearInterval(musicEndWatcher);
        musicEndWatcher = null;
        log('[music watcher] cleared existing watcher before starting new one');
    }

    if (!currentMusicChannel)
    {
        log('[music watcher] no current music channel; aborting');
        return;
    }

    const watchChannel = currentMusicChannel;
    const watchTrack = currentTrackName;
    const watchLengthMs = Number(currentTrackLength_MS) || 0;
    let notPlayingCount = 0;

    log('[music watcher] started for track:', watchTrack, 'channel:', ptrLabel(watchChannel), 'length:', watchLengthMs + 'ms');

    musicEndWatcher = setInterval(() =>
    {
        if (!system)
        {
            log('[music watcher] system missing; stopping');
            clearInterval(musicEndWatcher);
            musicEndWatcher = null;
            return;
        }

        if (watchChannel !== currentMusicChannel || watchTrack !== currentTrackName)
        {
            log('[music watcher] track/channel changed; stopping watcher');
            clearInterval(musicEndWatcher);
            musicEndWatcher = null;
            return;
        }

        const posOut = [0];
        const posRc = FMOD_Channel_GetPosition(watchChannel, posOut, FMOD_TIMEUNIT_MS);
        const posMs = Number(posOut[0]) || 0;

        if (posRc === 0 && watchLengthMs > 0)
        {
            const safeLead = Math.min(1300, Math.max(250, Math.floor(watchLengthMs * 0.05)));
            const endThreshold = Math.max(0, watchLengthMs - safeLead);
            log('[music watcher] poll', { track: watchTrack, posMs, watchLengthMs, endThreshold, posRc });

            if (posMs >= endThreshold)
            {
                log('[music watcher] near end -> pos:', posMs, '/ length:', watchLengthMs, '-> advancing');
                clearInterval(musicEndWatcher);
                musicEndWatcher = null;
                advanceToNextTrack(watchTrack);
                return;
            }

            notPlayingCount = 0;
            return;
        }

        const out = [0];
        const rc = FMOD_Channel_IsPlaying(watchChannel, out);
        const playing = out[0] === 1;

        log('[music watcher] fallback poll', { track: watchTrack, posRc, rc, playing, notPlayingCount });

        if (rc === 0 && playing)
        {
            notPlayingCount = 0;
            return;
        }

        notPlayingCount += 1;
        if (notPlayingCount < 3) return;

        clearInterval(musicEndWatcher);
        musicEndWatcher = null;
        log('[music watcher] fallback: track ended');
        advanceToNextTrack(watchTrack);

    }, 500);
}

function shutdown()
{
    log('shutdown() called');
    if (musicEndWatcher) { clearInterval(musicEndWatcher); musicEndWatcher = null; }
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (diagTimer) { clearInterval(diagTimer); diagTimer = null; }
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    dumpMixerState('pre-shutdown');
    dumpMusicState('pre-shutdown');

    if (system)
    {
        check(FMOD_System_Release(system), 'Release');
        system = null;
        masterGroup = null;
        sfxGroup = null;
        musicGroup = null;
        currentMusicChannel = null;
        currentMusicSound = null;
        currentTrackName = null;
        currentTrackLength_MS = 0;
        log('FMOD system released');
    }
}

// Setting Values Functions

function clamp01(v)
{
    return Math.max(0, Math.min(1, Number(v)));
}

function setMasterVolume(v)
{
    const n = clamp01(v);
    log('setMasterVolume ->', n);
    if (masterGroup) check(FMOD_ChannelGroup_SetVolume(masterGroup, n), 'SetVolume(master)');
    dumpMixerState('after setMasterVolume');
}

function setSfxVolume(v)
{
    const n = clamp01(v);
    log('setSfxVolume ->', n);
    if (sfxGroup) check(FMOD_ChannelGroup_SetVolume(sfxGroup, n), 'SetVolume(sfx)');
    dumpMixerState('after setSfxVolume');
}

function setMusicVolume(v)
{
    const n = clamp01(v);
    targetMusicVolume = n;
    log('setMusicVolume -> bus', n, 'targetMusicVolume', targetMusicVolume);
    if (musicGroup) check(FMOD_ChannelGroup_SetVolume(musicGroup, n), 'SetVolume(music)');

    if (currentMusicChannel)
    {
        safeCall('Channel_SetVolume(current music)', () => check(FMOD_Channel_SetVolume(currentMusicChannel, targetMusicVolume), 'Channel_SetVolume(current music)'));
    }

    dumpMixerState('after setMusicVolume');
    dumpMusicState('after setMusicVolume');
}

function setMuteAll(muted)
{
    log('setMuteAll ->', !!muted);
    if (masterGroup) check(FMOD_ChannelGroup_SetMute(masterGroup, muted ? 1 : 0), 'SetMute(master)');
    dumpMixerState('after setMuteAll');
}

//HELPERS  & DEBUGGING

function dumpMusicState(context = 'snapshot')
{
    log(`==== MUSIC STATE (${context}) ====`);
    log('system ptr:', ptrLabel(system));
    log('music group ptr:', ptrLabel(musicGroup));
    log('current music channel:', ptrLabel(currentMusicChannel));
    log('current music sound:', ptrLabel(currentMusicSound));
    log('current track name:', currentTrackName);
    log('current track length (ms):', currentTrackLength_MS);
    log('music tracks:', musicTracks.map(t => t.name));
    log('musicEndWatcher:', musicEndWatcher ? 'active' : 'null');
    log('==============================');
}

function loadMusicList()
{
    musicTracks = [];
    log('Scanning music directory:', MUSIC_DIR);
    if (!fs.existsSync(MUSIC_DIR))
    {
        warn('No music dir (create electron-app/audiofiles/Friday_Magic) at', MUSIC_DIR);
        return;
    }
    const exts = ['.mp3', '.ogg', '.wav', '.flac'];
    const files = fs.readdirSync(MUSIC_DIR).filter(f => exts.includes(path.extname(f).toLowerCase()));
    musicTracks = files.map(f => ({ name: path.parse(f).name, path: path.join(MUSIC_DIR, f) }));
    log(`music tracks found: ${musicTracks.length}`);
    musicTracks.forEach((t, i) => log(`  [music ${i + 1}] ${t.name} -> ${t.path}`));
}

function dumpMixerState(context = 'snapshot')
{
    log(`==== MIXER STATE (${context}) ====`);
    log('system ptr:', ptrLabel(system));
    log('master group ptr:', ptrLabel(masterGroup));
    log('sfx group ptr:', ptrLabel(sfxGroup));
    log('music group ptr:', ptrLabel(musicGroup));
    log('music channel ptr:', ptrLabel(currentMusicChannel));
    log('current track name:', currentTrackName);
    log('==============================');
}

function startDiagnostics()
{
    if (diagTimer) clearInterval(diagTimer);
    diagTimer = setInterval(() =>
    {
        if (!system) return;
        dumpMixerState('heartbeat');
        dumpMusicState('heartbeat');
    }, 15000);
}

function listOutputDevices()
{
    if (!system)
    {
        warn('listOutputDevices() called but system is null');
        return [];
    }

    const outCount = [0];
    const rcCount = FMOD_System_GetNumDrivers(system, outCount);
    check(rcCount, 'GetNumDrivers');
    const count = outCount[0];

    const devices = [];
    const nameBufSize = 256;

    for (let i = 0; i < count; i++)
    {
        const buf = Buffer.alloc(nameBufSize);
        const rcInfo = FMOD_System_GetDriverInfo(system, i, buf, nameBufSize, null, null, null, null);
        if (rcInfo !== 0)
        {
            warn('GetDriverInfo failed for index', i, 'rc=', rcInfo);
            continue;
        }

        const rawName = buf.toString('utf8').replace(/\0+$/, '');
        devices.push({
            id: i,
            name: rawName || `Device ${i}`,
            isDefault: i === 0
        });
    }

    log('Output devices:', devices);
    return devices;
}

function setOutputDevice(index)
{
    if (!system)
    {
        warn('setOutputDevice() called but system is null');
        return;
    }

    const idx = Number(index) | 0;
    log('setOutputDevice ->', idx);
    check(FMOD_System_SetDriver(system, idx), 'SetDriver');
    dumpMixerState('after setOutputDevice');
}

function log(...args) { console.log('[fmod]', ...args); }
function warn(...args) { console.warn('[fmod]', ...args); }
function err(...args) { console.error('[fmod]', ...args); }

function check(result, label)
{
    if (result !== 0) throw new Error(`FMOD error in ${label}: code ${result}`);
}

function safeCall(label, fn, fallback = null)
{
    try { return fn(); }
    catch (e)
    {
        err(`${label} threw:`, e.message);
        return fallback;
    }
}

function ptrLabel(value)
{
    if (value === null || value === undefined) return 'null';
    try { return String(value); }
    catch (_) { return '[ptr]'; }
}



function categoryOf(filename)
{
    return filename.split('_')[0].toLowerCase();
}

module.exports = {
    init,
    play, playAny, categories,
    playMusic, stopMusic, listMusic, isMusicPlaying,
    setMasterVolume, setSfxVolume, setMusicVolume, setMuteAll,
    listOutputDevices, setOutputDevice,
    shutdown
};

