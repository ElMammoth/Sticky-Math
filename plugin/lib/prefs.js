/*
 * Preferences persistantes du panneau : police des segments \text{} et
 * dossier de destination des SVG. Le dossier choisi est retrouve entre
 * les sessions via un jeton persistant UXP ; les fichiers ecrits ne
 * sont jamais supprimes par le plugin.
 */

const fs = require("uxp").storage.localFileSystem;

const MTEXT_FONT_KEY = "sticky-math.mtextFont";
const DEST_TOKEN_KEY = "sticky-math.destToken";
const DEST_PATH_KEY = "sticky-math.destPath";

let destFolder = null; // Entry dossier, ou null = dossier temporaire

function getMtextFont() {
  return localStorage.getItem(MTEXT_FONT_KEY) || "";
}

function setMtextFont(value) {
  localStorage.setItem(MTEXT_FONT_KEY, value);
}

/* Chemin de destination affichable, ou null si dossier temporaire. */
function destPath() {
  return destFolder ? destFolder.nativePath : null;
}

/* Retrouve le dossier choisi lors d'une session precedente. */
async function restoreDestFolder() {
  const token = localStorage.getItem(DEST_TOKEN_KEY);
  if (!token) return { restored: false };
  try {
    const entry = await fs.getEntryForPersistentToken(token);
    if (entry && entry.isFolder) {
      destFolder = entry;
      return { restored: true, path: entry.nativePath };
    }
    throw new Error("entrée invalide");
  } catch (e) {
    const lostPath = localStorage.getItem(DEST_PATH_KEY) || "";
    localStorage.removeItem(DEST_TOKEN_KEY);
    localStorage.removeItem(DEST_PATH_KEY);
    return { restored: false, lostPath };
  }
}

/* Ouvre le selecteur ; retourne le chemin choisi ou null si annule. */
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

/* Nom de fichier horodate, lisible et sans collision. */
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
 * Ecrit le SVG dans la destination ACTIVE (relue a chaque appel : un
 * changement de destination s'applique immediatement). Retourne l'Entry
 * du fichier cree.
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
