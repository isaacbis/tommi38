import { verify, createPublicKey } from 'node:crypto';

// Verify the original, unmodified query bytes, never a reconstructed query.
export async function verifyAdMobQuery(query, keyForId, now = Date.now()) {
  if (typeof query !== 'string' || query.length > 8192) throw Error('INVALID_CALLBACK');
  const match = /^(.*)&signature=([A-Za-z0-9_%=-]+)&key_id=(\d+)$/.exec(query);
  if (!match) throw Error('INVALID_CALLBACK');
  const params = new URLSearchParams(query);
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw Error('DUPLICATE_PARAMETER');
  const key = await keyForId(match[3]);
  if (!verify('sha256', Buffer.from(match[1]), createPublicKey(key), Buffer.from(decodeURIComponent(match[2]), 'base64url'))) throw Error('INVALID_SIGNATURE');
  const event = Object.fromEntries(params);
  const timestamp = Number(event.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp > now + 60000 || timestamp < now - 86400000) throw Error('EXPIRED_CALLBACK');
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(event.transaction_id || '')) throw Error('INVALID_TRANSACTION');
  return event;
}

let cache = { until: 0, keys: new Map() };
let loading;
export async function googleKey(id) {
  if (cache.until < Date.now()) {
    loading ||= (async () => {
      const response = await fetch('https://www.gstatic.com/admob/reward/verifier-keys.json', {signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw Error('KEY_SERVICE_UNAVAILABLE');
      const data = await response.json();
      cache = {until: Date.now() + 3600000, keys: new Map(data.keys.map(key => [String(key.keyId), key.pem]))};
    })().finally(() => { loading = null; });
    await loading;
  }
  if (!cache.keys.has(id)) throw Error('UNKNOWN_KEY');
  return cache.keys.get(id);
}
