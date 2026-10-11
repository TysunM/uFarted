// Fetch wrapper + offline queue for logs (so a gassy moment in a dead zone still counts).
const QUEUE_KEY = 'tt_offline_queue';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (raw) { init.body = raw; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, init);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage unavailable */ } };
export const queuedCount = () => readQueue().length;

/** Creates a log; if the network is down, queues it locally and reports `offline: true`. */
export async function createLog(data) {
  try {
    return await api('/logs', { method: 'POST', body: data });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    writeQueue([...readQueue(), data]);
    return { offline: true };
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    let queue = readQueue();
    while (queue.length) {
      try {
        await api('/logs', { method: 'POST', body: queue[0] });
        sent++;
      } catch (err) {
        if (!(err instanceof ApiError)) break; // still offline: keep the rest
        if (err.status === 401) break; // no session yet
      }
      queue = queue.slice(1);
      writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
  return sent;
}
