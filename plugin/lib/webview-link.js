/*
 * Panel <-> webview link: a state machine under permanent supervision.
 *
 * UXP can unload or reload the webview at any moment (panel hidden or
 * redocked, workspace change, memory purge, sleep). The link is
 * therefore NEVER considered acquired: a ping heartbeat runs
 * continuously, fast while establishing, spaced out afterwards. With no
 * answer, the link goes back to establishing and escalates: a fallback
 * channel through the URL fragment (InDesign builds where panel to
 * webview postMessage is mute, the 20.4 bug), then recreating the
 * webview element as a last resort. The fallback channel is cut as soon
 * as a ping answers by postMessage: once established it must never be
 * used, because every write to src can reload the page (and MathJax
 * with it).
 */

const WEBVIEW_SRC = "plugin:/webview/renderer.html";

const PING_CONNECTING_MS = 1500; // rate while establishing
const PING_READY_MS = 10000; // light heartbeat once established
const LOST_AFTER_PINGS = 2; // silent pings before declaring the link lost
const HASH_AFTER_PINGS = 4; // silent pings before enabling the fallback channel
const RECREATE_AFTER_PINGS = 12; // silent pings before recreating the webview

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
      /* a ready answering a postMessage ping proves that channel works:
         the fallback channel has no reason to exist any more */
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
      /* webview still loading */
    }
    if (hashActive) {
      try {
        el.src = WEBVIEW_SRC + "#m=" + encodeURIComponent(str);
      } catch (e) {
        /* src setter unavailable: postMessage is left on its own */
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
    /* depending on the UXP host, the message event lands on the element or on window */
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
