// Settings are bootstrapped with the page so the first render has the same
// layout on every project port. Note filters, grades and drafts stay local.
const sharedAppearance = (() => {
  const outbox = 'studio.appearancePending';
  function outstanding() {
    try { return JSON.parse(localStorage.getItem(outbox) || '{}') || {}; } catch { return {}; }
  }
  function recordPending(changes, acknowledged = false) {
    try {
      const current = outstanding();
      for (const [key,value] of Object.entries(changes)) {
        if (!acknowledged) current[key] = value;
        else if (current[key] === value) delete current[key];
      }
      if (Object.keys(current).length) localStorage.setItem(outbox,JSON.stringify(current)); else localStorage.removeItem(outbox);
    } catch { /* local storage may be unavailable */ }
  }
  let pending = outstanding(), busy = false, timer = 0;
  const snapshot = {...window.__studioAppearance,...pending};
  const simple = new Set(['lside','side','tlh','vzoom','timelineThumbnails','tabL','tabR']);
  const shared = k => simple.has(k) || k === 'workspaceV2';
  const local = k => { try { return JSON.parse(localStorage.getItem('studio.'+k) ?? 'null'); } catch { return null; } };
  function flatten(out, path, value) {
    if (value && typeof value === 'object') {
      for (const [k,v] of Object.entries(value)) flatten(out,path+'.'+k,v);
    } else if (value !== undefined) out[path] = value;
  }
  function get(key, fallback) {
    if (Object.hasOwn(snapshot,key)) return snapshot[key];
    const saved = local(key) ?? fallback;
    if (key !== 'workspaceV2') return saved;
    const result = saved ? structuredClone(saved) : {};
    for (const [name,v] of Object.entries(snapshot)) {
      const [head,...pieces] = name.split('.');
      if (head !== key || !pieces.length) continue;
      let obj = result;
      for (const piece of pieces.slice(0,-1)) obj = obj[piece] ??= {};
      obj[pieces.at(-1)] = v;
    }
    return Object.keys(result).length ? result : fallback;
  }
  async function flush() {
    clearTimeout(timer); timer = 0;
    if (busy || !Object.keys(pending).length) return;
    busy = true; const data = pending; pending = {};
    let failed = false;
    try {
      const result = await fetch('/api/workspace-appearance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true});
      if (!result.ok) throw new Error(String(result.status));
      recordPending(data,true);
    } catch { failed = true; pending = {...data,...pending}; }
    finally {
      busy = false;
      if (Object.keys(pending).length) timer = setTimeout(flush, failed ? 3000 : 0);
    }
  }
  function set(key, value) {
    if (shared(key)) {
      const parts = {}; flatten(parts,key,value);
      const changes = {};
      for (const [k,v] of Object.entries(parts)) if (snapshot[k] !== v) { snapshot[k] = v; pending[k] = changes[k] = v; }
      if (Object.keys(changes).length) recordPending(changes);
      if (!timer && !busy && Object.keys(pending).length) timer = setTimeout(flush, 80);
    }
    try { localStorage.setItem('studio.'+key,JSON.stringify(value)); } catch { /* private window */ }
  }
  window.addEventListener('pagehide', flush);
  if (Object.keys(pending).length) timer = setTimeout(flush,0);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  return {get,set};
})();
