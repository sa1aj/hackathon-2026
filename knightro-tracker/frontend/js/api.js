// Calls to the Knightro Tracker API. Contract: docs/api-contract.md
(function () {
  'use strict';
  const { CONFIG } = window.KT;

  async function request(path, options) {
    let res;
    try {
      res = await fetch(CONFIG.API_BASE + path, options);
    } catch {
      throw new Error("Can't reach the Knightro Tracker server. Check your connection.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  window.KT.api = {
    /** Active sightings from the last 20 minutes: [{ sightingId, lat, long, timestamp (seconds), caption? }] */
    async getSightings() {
      const data = await request('/sightings');
      return (data.sightings || [])
        .filter((s) => typeof s.lat === 'number' && typeof s.long === 'number' && typeof s.timestamp === 'number')
        .map((s) => ({ ...s, caption: s.caption || '' }))
        .sort((a, b) => b.timestamp - a.timestamp);
    },

    /** Returns { sightingId, timestamp } on 201. Throws with the server's error message otherwise. */
    postSighting({ lat, long, caption }) {
      const body = { lat: Number(lat), long: Number(long) };
      const text = (caption || '').trim().slice(0, CONFIG.CAPTION_MAX);
      if (text) body.caption = text;
      return request('/sightings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
})();
