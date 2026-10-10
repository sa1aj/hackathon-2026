window.KT = window.KT || {};
window.KT.CONFIG = {
  // Run backend/server.py so API and frontend share an origin for cookies.
  API_BASE: '/api', POLL_MS: 12000, ACTIVE_WINDOW_SEC: 1200, FRESH_SEC: 300,
  COOLDOWN_SEC: 120, CAPTION_MAX: 200,
  CAMPUSES_URL: 'data/campuses.json', BUILDINGS_URL: 'data/buildings.json', STOCK_PHOTOS: [],
  PIN_IMAGE: 'assets/photos/images/knightropin-01.svg',
  PIN_HOVER_IMAGE: 'assets/photos/images/knightropinhovered-02.svg',
  EVENT_FRAMES: ['assets/photos/images/eventframe1-03.svg', 'assets/photos/images/eventframe2-05.svg', 'assets/photos/images/eventframe3-04.svg'],
};