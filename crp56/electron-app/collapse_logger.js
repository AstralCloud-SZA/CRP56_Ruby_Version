/* ============================================================
   GRAVITY COLLAPSE — audit logger
   ------------------------------------------------------------
   Stores every collapse event as a pretty-printed JSON array in
   a plain .txt file INSIDE the project folder:

       <project-root>/logs/gravity_collapse.txt

   Interface (matches main.js usage):
       init(app)          -> returns the absolute log path (and ensures dir/file exist)
       record(entry)      -> async; appends one entry (auto-stamps id + timestamp)
       read(limit = 100)  -> async; returns the most recent `limit` entries (newest last)
       clear()            -> async; empties the log to []

   Notes
   - "Project folder" = the app directory (__dirname of this file), NOT Electron's
     userData dir, so the log lives next to your source for long-term storage.
   - Writes are serialized through a tiny promise queue so concurrent record()
     calls can't corrupt the JSON array.
   - Each write is atomic (temp file + rename) to avoid half-written files.
   ============================================================ */

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

/* ---------- module state ---------- */
let LOG_DIR = null;     // <project>/logs
let LOG_FILE = null;    // <project>/logs/gravity_collapse.txt
let counter = 0;        // monotonic id within this process
let writeChain = Promise.resolve(); // serialization queue

/* Cap how many entries we keep on disk so the file can't grow unbounded.
   Set to 0 to keep everything. */
const MAX_ENTRIES = 5000;

/* ---------- helpers ---------- */

function ensurePaths()
{
    // Default to this file's directory (the project/app folder) if init() wasn't called.
    if (!LOG_DIR)
    {
        LOG_DIR = path.join(__dirname, "logs");
        LOG_FILE = path.join(LOG_DIR, "gravity_collapse.txt");
    }
}

function readArraySync()
{
    ensurePaths();
    try
    {
        const raw = fs.readFileSync(LOG_FILE, "utf8").trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (_)
    {
        return [];
    }
}

async function readArray()
{
    ensurePaths();
    try
    {
        const raw = (await fsp.readFile(LOG_FILE, "utf8")).trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (err)
    {
        // Missing file or corrupt JSON -> start fresh (and back up corrupt data).
        if (err && err.code !== "ENOENT")
        {
            try
            {
                const bak = LOG_FILE + ".corrupt-" + Date.now() + ".bak";
                await fsp.copyFile(LOG_FILE, bak).catch(() => {});
            }
            catch (_) {}
        }
        return [];
    }
}

async function writeArrayAtomic(arr)
{
    ensurePaths();
    await fsp.mkdir(LOG_DIR, { recursive: true });

    const json = JSON.stringify(arr, null, 2) + "\n";
    const tmp = LOG_FILE + ".tmp-" + process.pid;
    await fsp.writeFile(tmp, json, "utf8");
    await fsp.rename(tmp, LOG_FILE);
}

/* Push a job onto the serialized write queue. */
function enqueue(job)
{
    const run = writeChain.then(job, job); // run even if a prior job rejected
    // Keep the chain alive but swallow rejections so one failure doesn't poison the queue.
    writeChain = run.catch(() => {});
    return run;
}

/* ---------- public API ---------- */

/**
 * Initialize the logger. Call once on app ready.
 * @param {Electron.App} [app] - optional; reserved for future use.
 * @returns {string} absolute path to the log file.
 */
function init(app)
{
    // Project folder = where the app code lives.
    LOG_DIR = path.join(__dirname, "logs");
    LOG_FILE = path.join(LOG_DIR, "gravity_collapse.txt");

    try
    {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LOG_FILE))
        {
            fs.writeFileSync(LOG_FILE, "[]\n", "utf8");
        }
        else
        {
            // Validate existing content; reset if unreadable.
            const arr = readArraySync();
            if (!Array.isArray(arr)) fs.writeFileSync(LOG_FILE, "[]\n", "utf8");
            counter = arr.length;
        }
    }
    catch (err)
    {
        console.error("[collapse_logger init failed]", err);
    }

    return LOG_FILE;
}

/**
 * Append a single collapse event. Auto-adds id + ISO timestamp.
 * Safe to call without awaiting; writes are serialized.
 * @param {object} entry
 * @returns {Promise<object>} the stored entry (with id + timestamp).
 */
function record(entry)
{
    const stamped = {
        id: ++counter,
        timestamp: new Date().toISOString(),
        ...(entry && typeof entry === "object" ? entry : { value: entry }),
    };

    return enqueue(async () =>
    {
        const arr = await readArray();
        arr.push(stamped);

        // Trim oldest if over the cap.
        if (MAX_ENTRIES > 0 && arr.length > MAX_ENTRIES)
        {
            arr.splice(0, arr.length - MAX_ENTRIES);
        }

        await writeArrayAtomic(arr);
        return stamped;
    });
}

/**
 * Read the most recent entries.
 * @param {number} [limit=100] - max entries to return (newest last). 0 = all.
 * @returns {Promise<object[]>}
 */
async function read(limit = 100)
{
    const arr = await readArray();
    if (!limit || limit <= 0) return arr;
    return arr.slice(-limit);
}

/**
 * Empty the log (reset to []).
 * @returns {Promise<boolean>}
 */
function clear()
{
    return enqueue(async () =>
    {
        await writeArrayAtomic([]);
        counter = 0;
        return true;
    });
}

/** Absolute path to the active log file (or null before init). */
function getLogPath()
{
    ensurePaths();
    return LOG_FILE;
}

module.exports = { init, record, read, clear, getLogPath };