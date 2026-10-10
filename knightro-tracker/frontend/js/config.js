// Shared settings. Plain scripts (no modules) so index.html also works when opened as a local file.
window.KT = window.KT || {};

window.KT.CONFIG = {
  // Live AWS API (API Gateway + Lambda). See docs/api-contract.md.
  API_BASE: 'https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com',

  POLL_MS: 12000, // the contract recommends polling every 10-15 s
  ACTIVE_WINDOW_SEC: 20 * 60, // GET /sightings only returns the last 20 minutes
  FRESH_SEC: 5 * 60, // pins younger than this pulse
  CAPTION_MAX: 200,

  CAMPUS_CENTER: { lat: 28.6024, lng: -81.2001 },
  // Sightings outside this box are not submitted.
  CAMPUS_BOUNDS: { minLat: 28.59, maxLat: 28.613, minLng: -81.212, maxLng: -81.188 },

  // Building names + coordinates shared with the scraper/events work.
  BUILDINGS_URL: '../data/buildings.json',

  // Stock Knightro photos shown on sightings (the backend doesn't store images yet).
  // Add files to frontend/assets/photos/ and list them here, e.g. 'assets/photos/knightro-1.jpg'.
  // While this is empty, a pixel-art illustration is shown instead.
  STOCK_PHOTOS: [],
};
