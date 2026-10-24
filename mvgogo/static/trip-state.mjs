// Browser storage and history are deliberately independent of the map renderer.
export const SESSION_KEY = 'mvgogo.trip.v1';
const MAX_SESSION_LENGTH = 3_000_000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validTime = value => finite(value) && Math.abs(value) <= 8_640_000_000_000_000;
const validForm = form => form && ['origin', 'destination', 'departure', 'maxWalk', 'maxBike']
  .every(key => typeof form[key] === 'string' && form[key].length <= 300);
export const validPoint = point => !!point && finite(point.lat) && finite(point.lon)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;

export function googleMapsURL(point, navigate = false) {
  if (!validPoint(point)) return null;
  const coordinates = `${point.lat},${point.lon}`;
  const parameters = new URLSearchParams({api: '1'});
  if (navigate) {
    parameters.set('destination', coordinates);
    parameters.set('travelmode', 'walking');
    parameters.set('dir_action', 'navigate');
  } else parameters.set('query', coordinates);
  return `https://www.google.com/maps/${navigate ? 'dir/' : 'search/'}?${parameters}`;
}

function validPlace(place) {
  return validPoint(place) && typeof place.name === 'string'
    && (!place.vehicleRentalStation || typeof place.vehicleRentalStation.stationId === 'string');
}
function validRoute(route) {
  return route && ['transit', 'mixed', 'bike'].includes(route.kind)
    && ['start_time', 'end_time', 'total_seconds', 'walk_seconds', 'bike_seconds', 'transfers']
      .every(key => finite(route[key]) && route[key] >= 0)
    && Array.isArray(route.legs) && route.legs.length > 0 && route.legs.length <= 64
    && route.legs.every(leg => leg && validPlace(leg.from) && validPlace(leg.to)
      && typeof leg.mode === 'string' && finite(leg.duration) && leg.duration >= 0
      && validTime(leg.startTime) && validTime(leg.endTime)
      && (!leg.legGeometry || typeof leg.legGeometry.points === 'string'
        && leg.legGeometry.points.length <= 200_000))
    && Array.isArray(route.warnings) && route.warnings.every(w => typeof w === 'string')
    && (!route.connections || Array.isArray(route.connections) && route.connections.every(connection => connection
      && ['before_leg_index', 'alight_time', 'board_time', 'walk_seconds', 'wait_seconds'].every(key => finite(connection[key]))));
}
export function decodeSession(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > MAX_SESSION_LENGTH) return null;
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !finite(value.savedAt) || !value.form || !value.points) return null;
    if (!validForm(value.form)) return null;
    if (['origin', 'destination'].some(key => value.points[key] && !validPoint(value.points[key]))) return null;
    if (value.results && (!Array.isArray(value.results.routes) || value.results.routes.length > 30
      || !value.results.routes.length || !value.results.routes.every(validRoute)
      || !Array.isArray(value.results.warnings) || !value.results.warnings.every(w => typeof w === 'string'))) return null;
    if (value.results && (!validPoint(value.plannedPoints?.origin) || !validPoint(value.plannedPoints?.destination))) return null;
    if (value.results && (!validForm(value.plannedForm) || !validTime(value.calculatedAt))) return null;
    if (value.results && !value.results.routes.every(route => validTime(route.start_time) && validTime(route.end_time))) return null;
    value.selectedIndex = Number.isInteger(value.selectedIndex) && value.selectedIndex >= 0
      && value.selectedIndex < (value.results?.routes.length || 0) ? value.selectedIndex : 0;
    value.legIndex = Number.isInteger(value.legIndex) && value.legIndex >= 0
      && value.legIndex < (value.results?.routes[value.selectedIndex]?.legs.length || 0) ? value.legIndex : null;
    value.screen = ['edit', 'trip', 'map'].includes(value.screen) ? value.screen : 'edit';
    if (value.map && (!validPoint(value.map) || !finite(value.map.zoom) || value.map.zoom < 1 || value.map.zoom > 19)) delete value.map;
    value.scrollTop = finite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0;
    return value;
  } catch { return null; }
}
export function readSession(storage) {
  try { return decodeSession(storage.getItem(SESSION_KEY)); } catch { return null; }
}
export function writeSession(storage, value) {
  try {
    const raw = JSON.stringify({...value, version: 1, savedAt: Date.now()});
    if (raw.length > MAX_SESSION_LENGTH) return false;
    storage.setItem(SESSION_KEY, raw);
    return true;
  } catch { return false; }
}
export function navigationState(value = {}) {
  return {
    app: 'mvgogo',
    screen: ['edit', 'trip', 'map'].includes(value.screen) ? value.screen : 'edit',
    detail: value.detail || null,
    picking: ['origin', 'destination'].includes(value.picking) ? value.picking : null,
  };
}
// An in-app arrow goes to its parent screen even in a newly reopened tab.
// The browser's own Back button continues to follow chronological history.
export function backDestination(screen, hasTrip) {
  if (screen === 'trip') return 'edit';
  return hasTrip ? 'trip' : 'edit';
}
export class AppHistory {
  constructor(history, apply) { this.history = history; this.apply = apply; }
  start(value, hasTrip) {
    const existing = this.history.state;
    if (existing?.app === 'mvgogo') {
      this.current = {...navigationState(value), depth: Math.max(0, existing.depth || 0)};
      this.history.replaceState(this.current, '');
    } else {
      this.current = {...navigationState({screen: hasTrip ? 'trip' : 'edit'}), depth: 0};
      this.history.replaceState(this.current, '');
      // Recreate the visible layers after a discarded tab or a new visit.
      if (value.screen === 'map' && (value.detail || value.picking)) this.navigate({screen:'map'});
      this.navigate(value);
    }
  }
  navigate(value, replace = false) {
    const next = navigationState(value);
    if (JSON.stringify(next) === JSON.stringify(navigationState(this.current))) return;
    const depth = this.current?.depth || 0;
    this.current = {...next, depth: replace ? depth : depth + 1};
    this.history[replace ? 'replaceState' : 'pushState'](this.current, '');
  }
  pop(value) {
    this.current = {...navigationState(value), depth: Math.max(0, value?.depth || 0)};
    this.apply(this.current);
  }
  back(fallback) {
    if (this.current?.depth > 0) this.history.back();
    else fallback();
  }
}
