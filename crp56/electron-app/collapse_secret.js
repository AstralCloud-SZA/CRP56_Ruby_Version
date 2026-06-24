/* ============================================================
   GRAVITY COLLAPSE — password secret manager
   ------------------------------------------------------------
   Stores a SALTED scrypt HASH of the collapse password in
       <userData>/collapse_secret.json
   The plaintext password is NEVER written to disk. Verification
   happens here in the main process; the renderer only sends a
   candidate password to be checked.

   First run: if no secret file exists, one is seeded from
   INITIAL_PASSWORD below. CHANGE THIS VALUE ONCE, then (optionally)
   delete the literal after first launch so it isn't in the source.

   Usage from main.js:
       const collapseSecret = require('./collapse_secret');
       collapseSecret.init(app);                 // after app ready-ish
       const ok = collapseSecret.verify(candidate);   // boolean
   ============================================================ */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

/* ============================================================
   SET YOUR PASSWORD ONCE HERE.
   On first launch this seeds the hashed secret file. After the
   file exists, this value is ignored. For maximum safety you may
   blank it (set to '') once the secret file has been created.
   ============================================================ */
const INITIAL_PASSWORD = 'NuclearFlame';

/* scrypt params (N, r, p) — strong but fast enough for a desktop unlock */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SECRET_VERSION = 1;

let SECRET_PATH = null;
let cache = null; // { v, salt(hex), hash(hex) }

function secretPath()
{
    if (!SECRET_PATH) SECRET_PATH = path.join(__dirname, 'collapse_secret.json');
    return SECRET_PATH;
}

/* ---------- hashing ---------- */
function hashPassword(password, saltBuf)
{
    const salt = saltBuf || crypto.randomBytes(32);
    const derived = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
        N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
        maxmem: 256 * 1024 * 1024,
    });
    return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}

function buildRecord(password)
{
    const { salt, hash } = hashPassword(password);
    return { v: SECRET_VERSION, alg: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt, hash };
}

/* ---------- persistence ---------- */
function loadSync()
{
    try
    {
        const raw = fs.readFileSync(secretPath(), 'utf8');
        const obj = JSON.parse(raw);
        if (obj && obj.salt && obj.hash) { cache = obj; return obj; }
    }
    catch (_) { /* missing or bad file */ }
    return null;
}

function writeSync(record)
{
    fs.writeFileSync(secretPath(), JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    cache = record;
}

/**
 * Initialize. Resolves the secret path from Electron userData and seeds
 * the file from INITIAL_PASSWORD if none exists yet.
 * @returns {{ path:string, seeded:boolean, exists:boolean }}
 */
function init(app)
{
    try
    {
        const dir = app && typeof app.getPath === 'function' ? app.getPath('userData') : __dirname;
        SECRET_PATH = path.join(dir, 'collapse_secret.json');
    }
    catch (_) { SECRET_PATH = path.join(__dirname, 'collapse_secret.json'); }

    const existing = loadSync();
    if (existing) return { path: SECRET_PATH, seeded: false, exists: true };

    if (INITIAL_PASSWORD && INITIAL_PASSWORD.length)
    {
        writeSync(buildRecord(INITIAL_PASSWORD));
        return { path: SECRET_PATH, seeded: true, exists: true };
    }
    return { path: SECRET_PATH, seeded: false, exists: false };
}

/** True if a password secret is configured. */
function isSet()
{
    return !!(cache || loadSync());
}

/**
 * Verify a candidate password (constant-time compare against the stored hash).
 * @returns {boolean}
 */
function verify(candidate)
{
    const rec = cache || loadSync();
    if (!rec || !rec.salt || !rec.hash) return false;
    if (candidate == null || String(candidate).length === 0) return false;

    try
    {
        const salt = Buffer.from(rec.salt, 'hex');
        const derived = crypto.scryptSync(String(candidate), salt, (rec.hash.length / 2), {
            N: rec.N || SCRYPT.N, r: rec.r || SCRYPT.r, p: rec.p || SCRYPT.p,
            maxmem: 256 * 1024 * 1024,
        });
        const stored = Buffer.from(rec.hash, 'hex');
        if (derived.length !== stored.length) return false;
        return crypto.timingSafeEqual(derived, stored);
    }
    catch (e)
    {
        console.error('[collapse-secret] verify failed:', e.message);
        return false;
    }
}

/**
 * Programmatically (re)set the password. Not exposed to the renderer by
 * default — call from main if you ever want a change flow.
 * @returns {Promise<boolean>}
 */
async function set(newPassword)
{
    if (!newPassword || String(newPassword).length < 1) return false;
    const record = buildRecord(newPassword);
    await fsp.writeFile(secretPath(), JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    cache = record;
    return true;
}

function getPath() { return secretPath(); }

module.exports = { init, isSet, verify, set, getPath };