/* Anonymous, per-browser update requests. Only the backend can confirm a vote. */
(function (root) {
  "use strict";
  const ids = ["xiaoyao","shie","taishang","zaixu","huodong","original","mogai"];
  const browserKey = "xiyou-nudge:browser:v1";
  const refreshKey = "xiyou-nudge:refresh:v1";
  function create(endpoint) {
    const listeners = new Set();
    let browserId = null, epoch = 0, controller = null, refreshing = null;
    let state = {status:"loading",counts:{},voted:[],pending:null,storageAvailable:true};
    const snapshot = () => ({...state,counts:{...state.counts},voted:[...state.voted]});
    const notify = () => listeners.forEach(fn => fn(snapshot()));
    function identity() {
      try {
        let value = localStorage.getItem(browserKey);
        if (!/^[a-f0-9]{64}$/.test(value || "")) {
          value = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2,"0")).join("");
          localStorage.setItem(browserKey,value);
          value = localStorage.getItem(browserKey);
          if (!/^[a-f0-9]{64}$/.test(value || "")) throw new Error("storage unavailable");
        }
        state.storageAvailable = true;
        return value;
      } catch { state.storageAvailable = false; return null; }
    }
    function invalidate() {
      epoch++;
      controller?.abort(); controller = null; refreshing = null;
      state.pending = null;
    }
    function unavailable() {
      invalidate(); state.status = "unavailable"; state.counts = {}; notify();
    }
    function syncIdentity() {
      const next = identity();
      if (next !== browserId) { invalidate(); browserId = next; state.voted = []; }
    }
    function valid(data) {
      return data?.ok === true && data.apiVersion === 1 && ids.every(id => Number.isSafeInteger(data.counts?.[id]) && data.counts[id] >= 0)
        && Array.isArray(data.voted) && data.voted.every(id => ids.includes(id)) && new Set(data.voted).size === data.voted.length;
    }
    async function request(path,data,signal) {
      const url = new URL(endpoint + path);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("invalid endpoint");
      const response = await fetch(url.href,{
        method:data ? "POST" : "GET", headers:data ? {"Content-Type":"application/json"} : {},
        body:data ? JSON.stringify(data) : undefined, credentials:"omit",cache:"no-store",mode:"cors",redirect:"error",referrerPolicy:"no-referrer",signal,
      });
      if (!response.ok) throw new Error("backend unavailable");
      const result = await response.json();
      if (!valid(result)) throw new Error("invalid backend response");
      return result;
    }
    function apply(result) {
      state.counts = Object.fromEntries(ids.map(id => [id,result.counts[id]]));
      state.voted = [...result.voted]; state.status = "ready";
    }
    async function refresh() {
      syncIdentity();
      if (state.pending) return false;
      if (refreshing) return refreshing;
      if (navigator.onLine === false || !endpoint) { unavailable(); return false; }
      const generation = ++epoch, identityAtStart = browserId;
      const ctrl = new AbortController(); controller = ctrl;
      const timer = setTimeout(() => ctrl.abort(),10000);
      state.status = "loading"; notify();
      const job = (async () => {
        try {
          const result = await request(browserId ? "/state" : "",browserId ? {browserId} : null,ctrl.signal);
          if (generation !== epoch || identityAtStart !== identity() || navigator.onLine === false) return false;
          apply(result); return true;
        } catch {
          if (generation === epoch) { state.status = "unavailable"; state.counts = {}; }
          return false;
        } finally {
          clearTimeout(timer);
          if (generation === epoch) { controller = null; refreshing = null; notify(); }
        }
      })();
      refreshing = job;
      return job;
    }
    async function vote(versionId) {
      const previousId = browserId;
      syncIdentity();
      if (browserId !== previousId) { await refresh(); return {ok:false}; }
      if (!ids.includes(versionId) || !browserId || state.pending || state.status !== "ready" || navigator.onLine === false) return {ok:false};
      if (state.voted.includes(versionId)) return {ok:true,added:false};
      invalidate();
      const generation = epoch, identityAtStart = browserId;
      const ctrl = new AbortController(); controller = ctrl;
      const timer = setTimeout(() => ctrl.abort(),10000);
      state.pending = versionId; notify();
      try {
        const result = await request("/vote",{browserId,versionId},ctrl.signal);
        if (generation !== epoch || identityAtStart !== identity() || navigator.onLine === false) return {ok:false};
        if (!result.voted.includes(versionId) || typeof result.added !== "boolean") throw new Error("unconfirmed vote");
        apply(result);
        try { localStorage.setItem(refreshKey,String(Date.now()) + ":" + Math.random().toString(36).slice(2)); } catch { /* Backend confirmation remains valid. */ }
        return {ok:true,added:result.added};
      } catch {
        if (generation === epoch) { state.status = "unavailable"; state.counts = {}; }
        return {ok:false};
      } finally {
        clearTimeout(timer);
        if (generation === epoch) { state.pending = null; controller = null; notify(); }
      }
    }
    window.addEventListener("storage",event => {
      if (event.key === browserKey || event.key === null) { syncIdentity(); void refresh(); }
      else if (event.key === refreshKey) void refresh();
    });
    window.addEventListener("offline",unavailable);
    window.addEventListener("online",() => void refresh());
    window.addEventListener("pagehide",unavailable);
    window.addEventListener("pageshow",event => { if (event.persisted) void refresh(); });
    window.addEventListener("focus",() => { if (document.visibilityState === "visible") void refresh(); });
    document.addEventListener("visibilitychange",() => { if (document.visibilityState === "visible") void refresh(); else unavailable(); });
    setInterval(() => { if (document.visibilityState === "visible") void refresh(); },30000);
    return Object.freeze({snapshot,refresh,vote,subscribe(fn){listeners.add(fn);fn(snapshot());return () => listeners.delete(fn);}});
  }
  root.XiyouNudges = Object.freeze({create});
})(window);
