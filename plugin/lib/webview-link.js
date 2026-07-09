/*
 * Liaison panneau <-> webview : machine d'etat avec surveillance permanente.
 *
 * La webview peut etre dechargee ou rechargee par UXP a tout moment
 * (panneau masque ou redocke, changement d'espace de travail, purge
 * memoire, veille). La liaison n'est donc JAMAIS consideree comme
 * acquise : un battement de ping tourne en continu, rapide pendant
 * l'etablissement, espace ensuite. Sans reponse, la liaison repasse en
 * etablissement et escalade : canal de secours par fragment d'URL
 * (builds InDesign dont postMessage panneau vers webview est muet,
 * type bug 20.4), puis recreation de l'element webview en dernier
 * recours. Le canal de secours est coupe des qu'un ping repond par
 * postMessage : en regime etabli il ne doit jamais servir, car chaque
 * ecriture de src peut recharger la page (et MathJax avec).
 */

const WEBVIEW_SRC = "plugin:/webview/renderer.html";

const PING_CONNECTING_MS = 1500; // cadence d'etablissement
const PING_READY_MS = 10000; // battement leger en regime etabli
const LOST_AFTER_PINGS = 2; // pings muets avant de declarer la liaison perdue
const HASH_AFTER_PINGS = 4; // pings muets avant d'activer le canal de secours
const RECREATE_AFTER_PINGS = 12; // pings muets avant de recreer la webview

function createWebviewLink({ getWebview, replaceWebview, onConnected, onLost, onMessage, onState }) {
  let state = "connecting";
  let everConnected = false;
  let hashActive = false;
  let postMessageConfirmed = false;
  let unanswered = 0;
  let msgSeq = 0;
  let timer = null;
  let recreated = false;

  function handleRaw(data) {
    let msg = data;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch (e) {
        return;
      }
    }
    if (!msg || !msg.type) return;
    unanswered = 0;

    if (msg.type === "ready") {
      /* un ready repondant a un ping postMessage prouve ce canal :
         le canal de secours n'a plus de raison d'etre */
      if (msg.via === "postMessage") {
        postMessageConfirmed = true;
        hashActive = false;
      }
      if (state !== "ready") {
        state = "ready";
        recreated = false;
        schedule(PING_READY_MS);
        const isReconnect = everConnected;
        everConnected = true;
        onState("ready", hashActive ? "hash" : "postMessage");
        onConnected(isReconnect);
      }
      return;
    }
    onMessage(msg);
  }

  function attach(el) {
    el.addEventListener("message", (e) => handleRaw(e.data));
  }

  function send(msg) {
    msg.seq = ++msgSeq;
    const str = JSON.stringify(msg);
    const el = getWebview();
    try {
      el.postMessage(str);
    } catch (e) {
      /* webview en cours de chargement */
    }
    if (hashActive) {
      try {
        el.src = WEBVIEW_SRC + "#m=" + encodeURIComponent(str);
      } catch (e) {
        /* setter src indisponible : postMessage reste seul */
      }
    }
  }

  function tick() {
    unanswered++;
    if (state === "ready" && unanswered >= LOST_AFTER_PINGS) {
      state = "connecting";
      schedule(PING_CONNECTING_MS);
      onState("connecting", "perdue");
      onLost();
    }
    if (state === "connecting") {
      if (!hashActive && !postMessageConfirmed && unanswered >= HASH_AFTER_PINGS) {
        hashActive = true;
        onState("connecting", "escalade-hash");
      }
      if (!recreated && unanswered >= RECREATE_AFTER_PINGS) {
        recreated = true;
        attach(replaceWebview());
        onState("connecting", "webview-recreee");
      }
    }
    send({ type: "ping" });
  }

  function schedule(ms) {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, ms);
  }

  function start() {
    attach(getWebview());
    /* selon les hotes UXP, l'evenement message arrive sur l'element ou sur window */
    window.addEventListener("message", (e) => handleRaw(e.data));
    schedule(PING_CONNECTING_MS);
    onState("connecting", "etablissement");
    send({ type: "ping" });
  }

  return {
    start,
    send,
    isReady: () => state === "ready",
  };
}

module.exports = { createWebviewLink, WEBVIEW_SRC };
