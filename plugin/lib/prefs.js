/*
 * Persistent panel preferences: the font for \text{} segments and the
 * destination folder for SVG files. A chosen folder is recovered across
 * sessions through a UXP persistent token; files written are never
 * deleted by the plugin.
 */

const fs = require("uxp").storage.localFileSystem;

const MTEXT_FONT_KEY = "sticky-math.mtextFont";
const DEST_TOKEN_KEY = "sticky-math.destToken";
const DEST_PATH_KEY = "sticky-math.destPath";

let destFolder = null; // folder Entry, or null = temporary folder

function getMtextFont() {
  return localStorage.getItem(MTEXT_FONT_KEY) || "";
}

function setMtextFont(value) {
  localStorage.setItem(MTEXT_FONT_KEY, value);
}

/* Displayable destination path, or null if the temporary folder. */
function destPath() {
  return destFolder ? destFolder.nativePath : null;
}

/* Recovers the folder chosen during a previous session. */
async function restoreDestFolder() {
  const token = localStorage.getItem(DEST_TOKEN_KEY);
  if (!token) return { restored: false };
  try {
    const entry = await fs.getEntryForPersistentToken(token);
    if (entry && entry.isFolder) {
      destFolder = entry;
      return { restored: true, path: entry.nativePath };
    }
    throw new Error("invalid entry"); // caught just below, never surfaced
  } catch (e) {
    const lostPath = localStorage.getItem(DEST_PATH_KEY) || "";
    localStorage.removeItem(DEST_TOKEN_KEY);
    localStorage.removeItem(DEST_PATH_KEY);
    return { restored: false, lostPath };
  }
}

/* Opens the picker; returns the chosen path, or null if cancelled. */
async function chooseDestFolder() {
  const folder = await fs.getFolder();
  if (!folder) return null;
  const token = await fs.createPersistentToken(folder);
  localStorage.setItem(DEST_TOKEN_KEY, token);
  localStorage.setItem(DEST_PATH_KEY, folder.nativePath);
  destFolder = folder;
  return folder.nativePath;
}

function resetDestFolder() {
  destFolder = null;
  localStorage.removeItem(DEST_TOKEN_KEY);
  localStorage.removeItem(DEST_PATH_KEY);
}

/* Timestamped filename, readable and collision-free. */
function svgFileName() {
  const d = new Date();
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  return (
    "sticky-math-" +
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) +
    "-" + pad(d.getMilliseconds(), 3) + ".svg"
  );
}

/*
 * Writes the SVG into the ACTIVE destination (re-read on every call, so
 * a destination change takes effect immediately). Returns the Entry of
 * the created file.
 */
async function writeSvg(svgText) {
  const folder = destFolder || (await fs.getTemporaryFolder());
  const file = await folder.createFile(svgFileName(), { overwrite: true });
  await file.write(svgText);
  return file;
}

module.exports = {
  getMtextFont,
  setMtextFont,
  destPath,
  restoreDestFolder,
  chooseDestFolder,
  resetDestFolder,
  writeSvg,
};
