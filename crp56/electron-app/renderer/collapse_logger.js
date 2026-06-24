/* ============================================================
   GRAVITY COLLAPSE — audit logger
   ------------------------------------------------------------
   Records every collapse attempt to a JSON-lines file under the
   app's userData dir:  <userData>/collapse-audit.log
   (one JSON object per line — easy to append, tail, and parse.)

   Usage from main.js:
       const collapseLog = require('./collapse-logger');
       collapseLog.init(app);                 // once, after app ready-ish
       collapseLog.record({ ... });           // per collapse
       const entries = await collapseLog.read(100);   // last N entries
   ============================================================ */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

let LOG_PATH = null;
let writeChain = Promise.resolve();   // serialize appends so lines never interleave

/**
 * Initialize the logger. Pass the Electron `app` so we can resolve userData.
 * Falls back to a path next to this file if app/userData is unavailable.
 */
function init(app)
{
    try
    {
        const dir = app && typeof app.getPath === 'function'
            ? app.getPath('userData')
            : __dirname;
        LOG_PATH = path.join(dir, 'collapse-audit.log');
    }
    catch (_)
    {
        LOG_PATH = path.join(__dirname, 'collapse-audit.log');
    }
    return LOG_PATH;
}

function getPath()
{
    if (!LOG_PATH) LOG_PATH = path.join(__dirname, 'collapse-audit.log');
    return LOG_PATH;
}

/**
 * Append one audit entry. Non-throwing — logging must never break a collapse.
 * @param {object} entry  free-form; common fields below are normalized.
 *   { path, type, mode, status, files, dirs, error, durationMs }
 * @returns {Promise<object>} the full entry that was written (with id + ts)
 */
function record(entry = {})
{
    const full = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ts: new Date().toISOString(),
        path: entry.path ?? null,
        type: entry.type ?? null,          // 'folder' | 'drive'
        mode: entry.mode ?? null,          // 'quick' | 'single' | 'dod' | 'gutmann'
        status: entry.status ?? 'unknown', // 'completed' | 'failed' | 'aborted' | 'blocked'
        files: entry.files ?? null,
        dirs: entry.dirs ?? null,
        error: entry.error ?? null,
        durationMs: entry.durationMs ?? null,
    };

    const line = JSON.stringify(full) + '\n';
    // chain appends so concurrent calls don't interleave bytes
    writeChain = writeChain
        .then(() => fsp.appendFile(getPath(), line, 'utf8'))
        .catch((e) => { console.error('[collapse-logger] write failed:', e.message); });

    return writeChain.then(() => full);
}

/**
 * Read the most recent `limit` entries (newest last). Bad lines are skipped.
 * @param {number} limit  max entries to return (default all)
 * @returns {Promise<object[]>}
 */
async function read(limit = Infinity)
{
    let raw;
    try { raw = await fsp.readFile(getPath(), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }

    const entries = raw.split(/\r?\n/).filter(Boolean).map((l) =>
    {
        try { return JSON.parse(l); }
        catch { return null; }
    }).filter(Boolean);

    return limit === Infinity ? entries : entries.slice(-limit);
}

/** Delete the entire audit log. Returns true if a file was removed. */
async function clear()
{
    try { await fsp.unlink(getPath()); return true; }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

module.exports = { init, record, read, clear, getPath };