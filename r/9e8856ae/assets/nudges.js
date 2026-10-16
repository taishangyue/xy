/* Repeatable clicks, using the same per-version storage keys as the original page. */
(function (root) {
  "use strict";
  const prefix = "xiyou-update-taps:v1:";
  function create(versionIds) {
    const ids = [...new Set(versionIds)];
    const counts = new Map();
    const listeners = new Set();
    function read(id) {
      let count = counts.get(id) ?? 0;
      try {
        const value = localStorage.getItem(prefix + id);
        const number = Number(value);
        count = value !== null && /^\d+$/.test(value) && Number.isSafeInteger(number) ? number : 0;
      } catch { /* Keep this page's count when storage is unavailable. */ }
      counts.set(id, count);
      return count;
    }
    const snapshot = () => ({counts:Object.fromEntries(ids.map(id => [id, counts.get(id) ?? 0]))});
    const notify = () => listeners.forEach(fn => fn(snapshot()));
    function refresh() { ids.forEach(read); notify(); }
    function vote(id) {
      if (!ids.includes(id)) return {ok:false};
      const count = Math.min(Number.MAX_SAFE_INTEGER, read(id) + 1);
      counts.set(id,count);
      try { localStorage.setItem(prefix + id,String(count)); } catch { /* Clicks still work for this page session. */ }
      notify();
      return {ok:true,count};
    }
    window.addEventListener("storage",event => {
      if (event.key === null || event.key.startsWith(prefix)) refresh();
    });
    refresh();
    return Object.freeze({snapshot,refresh,vote,subscribe(fn){listeners.add(fn);fn(snapshot());return () => listeners.delete(fn);}});
  }
  root.XiyouNudges = Object.freeze({create});
})(window);
