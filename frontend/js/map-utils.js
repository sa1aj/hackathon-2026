(function () {
  'use strict';
  const util = {
    contains: (campus, p) => p && p.lat >= campus.bounds.minLat && p.lat <= campus.bounds.maxLat && p.lng >= campus.bounds.minLng && p.lng <= campus.bounds.maxLng,
    opacity: (timestamp, now, windowSec) => Math.max(0, Math.min(1, 1 - (now - timestamp) / windowSec)),
    cluster(items, project, radius = 48) {
      const groups = [];
      for (const item of items) {
        const p = project(item);
        const group = groups.find((g) => Math.hypot(g.point.x - p.x, g.point.y - p.y) <= radius);
        if (group) group.items.push(item);
        else groups.push({ point: p, items: [item] });
      }
      return groups;
    },
  };
  if (typeof module !== 'undefined') module.exports = util;
  else window.KT.mapUtils = util;
})();