const $ = id => document.getElementById(id);
const map = L.map('map', {zoomControl: false}).setView([48.137, 11.575], 13);
L.control.zoom({position: 'topright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
for (const [name, z] of [['stations', 410], ['route', 440], ['waypoints', 460]]) {
  map.createPane(name).style.zIndex = z;
}
const stationsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const waypointsLayer = L.layerGroup().addTo(map);
const areaLayer = L.layerGroup().addTo(map);
const savedPlacesLayer = L.layerGroup().addTo(map);
const points = {}, pointMarkers = {}, searches = {};
let picking = 'origin', stationData = null, loadingStations = false, tripRevision = 0;
let selectedRoute = null, selectedCard = null, legLines = [], routeStationIds = new Set();
let saveField = null, savedPlaces = {};
let stationFocusId = null, stationPopupMarker = null, popupSignature = '', loadingRoute = false;
let renderingStations = false;
const stationMarkerItems = [];
const isMobile = () => matchMedia('(max-width:820px)').matches;
try { savedPlaces = JSON.parse(localStorage.getItem('mvgogo.places') || '{}') || {}; } catch {}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const minutes = seconds => Math.ceil(seconds / 60);
const durationText = seconds => {
  const total = Math.max(0, Math.round(seconds)), m = Math.floor(total / 60), s = total % 60;
  return m ? `${m} min${s ? ` ${s} sec` : ''}` : `${s} sec`;
};
const time = timestamp => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
}).format(timestamp);
const placeName = name => name === 'Origin' ? 'A' : name === 'Destination' ? 'B' : name;
const names = {WALK:'Walk', BICYCLE:'Bike', BUS:'Bus', SUBWAY:'U-Bahn', RAIL:'Train', TRAM:'Tram'};
const modeName = leg => leg.rentedBike ? 'MyRadl' : `${names[leg.mode] || leg.mode}${leg.route?.shortName ? ` ${leg.route.shortName}` : ''}`;
const deviceNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};
$('departure').value = deviceNow();

function setMobileView(view) {
  document.body.dataset.mobileView = view;
  $('view-planner').setAttribute('aria-pressed', String(view === 'planner'));
  $('view-map').setAttribute('aria-pressed', String(view === 'map'));
  document.querySelector('.panel').inert = isMobile() && view !== 'planner';
  document.querySelector('.map-panel').inert = isMobile() && view !== 'map';
  if (stationFocusId && stationData) {
    const feature = stationData.features.find(f => f.properties.id === stationFocusId);
    if (feature) showMobileStation(feature);
  }
  requestAnimationFrame(() => map.invalidateSize({pan:false}));
}
$('view-planner').onclick = () => setMobileView('planner');
$('view-map').onclick = () => setMobileView('map');
matchMedia('(max-width:820px)').addEventListener('change', () => setMobileView(document.body.dataset.mobileView));
setMobileView('planner');


function invalidate() {
  tripRevision++;
  selectedRoute = null; selectedCard = null; legLines = []; routeStationIds.clear();
  routeLayer.clearLayers(); waypointsLayer.clearLayers();
  $('results').replaceChildren(); $('route-key').hidden = true;
  $('all-stations').checked = true;
  choosePoint(picking);
  renderStations();
}
function choosePoint(which) {
  picking = which;
  $('pick-origin').classList.toggle('active', which === 'origin');
  $('pick-destination').classList.toggle('active', which === 'destination');
  $('map-hint').textContent = `Tap the map to choose ${which === 'origin' ? 'your start, A' : 'your destination, B'}`;
}
function closeSearch(which) {
  searches[which]?.abort(); delete searches[which];
  $(`${which}-results`).hidden = true;
}
function setPoint(which, lat, lon, label) {
  closeSearch(which); invalidate();
  points[which] = {lat: +lat, lon: +lon, label: label || `${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}`};
  $(which).value = points[which].label;
  if (pointMarkers[which]) map.removeLayer(pointMarkers[which]);
  pointMarkers[which] = L.marker([lat, lon], {zIndexOffset: 1000, icon: L.divIcon({
    className: 'point-icon', html: which === 'origin' ? 'A' : 'B', iconSize: [30,30], iconAnchor: [15,15]
  })}).bindTooltip(() => el('span', points[which].label)).addTo(map);
  choosePoint(which === 'origin' ? 'destination' : 'origin');
}
function coordinates(value) {
  if (!/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return null;
  const pair = value.split(',').map(Number);
  return pair.every(Number.isFinite) ? pair : null;
}
map.on('click', event => setPoint(picking, event.latlng.lat, event.latlng.lng));
$('pick-origin').onclick = () => choosePoint('origin');
$('pick-destination').onclick = () => choosePoint('destination');

async function searchPlace(which) {
  const query = $(which).value.trim(), pair = coordinates(query);
  if (pair) { setPoint(which, ...pair); map.setView(pair, 16); return; }
  if (query.length < 2) { $('message').textContent = 'Enter at least two characters of an address or place name.'; return; }
  closeSearch(which);
  const controller = new AbortController(); searches[which] = controller;
  const results = $(`${which}-results`);
  results.replaceChildren(el('p', 'Finding your place…')); results.hidden = false;
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {signal: controller.signal});
    const data = await response.json();
    if (searches[which] !== controller) return;
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not find that place.');
    results.replaceChildren();
    if (!data.results.length) results.append(el('p', 'No matches around Munich. Try a more specific address or pick a point on the map.'));
    for (const place of data.results) {
      const button = el('button', place.label); button.type = 'button';
      button.onclick = () => { setPoint(which, place.lat, place.lon, place.label); map.setView([place.lat, place.lon], 16); };
      results.append(button);
    }
  } catch (error) {
    if (!controller.signal.aborted) results.replaceChildren(el('p', error.message || 'Search is unavailable. Pick a point on the map.'));
  } finally { if (searches[which] === controller) delete searches[which]; }
}
for (const id of ['origin', 'destination']) {
  $(id).addEventListener('focus', () => choosePoint(id));
  $(id).addEventListener('input', () => { closeSearch(id); delete points[id]; if (pointMarkers[id]) map.removeLayer(pointMarkers[id]); invalidate(); });
  $(id).addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); searchPlace(id); }
    if (event.key === 'Escape') closeSearch(id);
  });
  $(id).addEventListener('change', () => {
    const pair = coordinates($(id).value); if (pair) setPoint(id, ...pair);
  });
  $(`search-${id}`).onclick = () => searchPlace(id);
}
for (const id of ['departure','max-walk','max-bike']) $(id).onchange = invalidate;
$('swap').onclick = () => {
  if (!points.origin || !points.destination) return;
  const a = {...points.origin}, b = {...points.destination};
  setPoint('origin', b.lat, b.lon, b.label); setPoint('destination', a.lat, a.lon, a.label);
};
$('example').onclick = () => {
  setPoint('origin', 48.1618, 11.5869, 'Münchner Freiheit');
  setPoint('destination', 48.123, 11.521, 'Westpark');
  $('departure').value = deviceNow();
  map.fitBounds([[48.1618,11.5869],[48.123,11.521]], {padding:[55,55]});
  $('message').textContent = 'Example: Münchner Freiheit → Westpark. Tap Find a route.';
};
$('locate').onclick = () => {
  if (!navigator.geolocation) { $('message').textContent = 'Location is unavailable. Pick a point on the map.'; return; }
  navigator.geolocation.getCurrentPosition(position => {
    setPoint('origin', position.coords.latitude, position.coords.longitude, 'My location');
    map.setView([position.coords.latitude, position.coords.longitude], 15);
  }, () => { $('message').textContent = 'Could not get your location. Pick a point on the map.'; });
};

function updateSavedButtons() {
  savedPlacesLayer.clearLayers();
  for (const [kind, place] of Object.entries(savedPlaces)) {
    if (!['home','work'].includes(kind) || !Number.isFinite(place?.lat) || !Number.isFinite(place?.lon)) continue;
    L.marker([place.lat,place.lon], {icon:L.divIcon({className:'savedplace-icon', html:kind === 'home' ? '⌂' : '▣', iconSize:[24,24]}),
      title:`${kind === 'home' ? 'Home' : 'Work'} · ${place.label}`})
      .bindTooltip(() => el('span', `${kind === 'home' ? 'Home' : 'Work'} · ${place.label}`))
      .on('click', () => setPoint(picking,place.lat,place.lon,place.label)).addTo(savedPlacesLayer);
  }
  document.querySelectorAll('[data-use]').forEach(button => {
    const p = savedPlaces[button.dataset.use];
    button.title = p?.label || 'No saved place yet';
    button.classList.toggle('is-saved', !!p);
  });
}
document.querySelectorAll('[data-save]').forEach(button => button.onclick = () => {
  saveField = button.dataset.save;
  if (!points[saveField]) { $('message').textContent = 'Choose a search result or a point on the map before saving it.'; return; }
  $('save-label').textContent = points[saveField].label; $('save-error').textContent = '';
  $('save-dialog').showModal();
});
document.querySelectorAll('[data-use]').forEach(button => button.onclick = () => {
  const saved = savedPlaces[button.dataset.use];
  if (!saved || !Number.isFinite(saved.lat) || !Number.isFinite(saved.lon)) {
    $('message').textContent = 'Choose a place, then tap Save place… below the relevant field.'; return;
  }
  setPoint(button.dataset.field, saved.lat, saved.lon, saved.label);
  map.setView([saved.lat, saved.lon], 15);
});
function storePlaces(next) {
  try { localStorage.setItem('mvgogo.places', JSON.stringify(next)); savedPlaces = next; updateSavedButtons(); return true; }
  catch { $('save-error').textContent = 'Your browser could not save this place.'; return false; }
}
$('save-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  if (storePlaces({...savedPlaces, [$('save-kind').value]: {...points[saveField]}})) {
    $('save-dialog').close(); $('message').textContent = 'Place saved in this browser.';
  }
});
$('delete-place').onclick = () => {
  const next = {...savedPlaces}; delete next[$('save-kind').value];
  if (storePlaces(next)) { $('save-dialog').close(); $('message').textContent = 'Saved place removed.'; }
};
updateSavedButtons();

function isFresh(properties) {
  const now = Date.now() / 1000;
  return properties.fresh && [properties.reported_at, stationData.meta.status_updated_at]
    .every(t => Number.isFinite(t) && now - t <= stationData.meta.max_age_seconds && now - t >= -60);
}
function stationPopup(feature) {
  const p = feature.properties, [lon,lat] = feature.geometry.coordinates;
  const fresh = isFresh(p), available = fresh && p.bikes > 0 && p.renting && p.installed;
  const content = el('div', undefined, 'station-card');
  content.append(el('div', 'MYRADL · STATION', 'station-eyebrow'), el('h2', p.name));
  const status = el('div', undefined, `station-availability ${fresh ? available ? '' : 'closed' : 'unknown'}`);
  status.append(el('span', fresh ? String(p.bikes ?? '?') : '?', 'station-count'));
  const label = el('div');
  label.append(el('strong', fresh ? 'bikes available' : 'Availability unknown'));
  label.append(el('small', fresh ? available ? 'Ready when you are' : p.renting && p.installed ? 'No bikes here right now' : 'Rentals are closed' : 'Check in the operator app'));
  status.append(label); content.append(status);
  if (fresh) {
    const types = el('div', undefined, 'station-types');
    for (const type of p.by_type) types.append(el('span', `${type.name}: ${type.count}`));
    content.append(types, el('p', p.returning && p.installed ? 'You can return a bike at this station.' : 'Returns are currently closed.'));
    content.append(el('p', `Updated at ${time(p.reported_at * 1000)}. A bike may be taken before you arrive.`, 'station-updated'));
  }
  const url = p.rental_url;
  if (url && /^https:\/\/(nxtb\.it|app\.nextbike\.net)(\/|$)/.test(url)) {
    const link = el('a', 'Open in operator app ↗', 'station-operator');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link);
  }
  const actions = el('div', undefined, 'station-actions');
  for (const [which, text] of [['origin','Start here →'],['destination','→ End here']]) {
    const button = el('button', text); button.type = 'button';
    button.onclick = () => { setPoint(which, lat, lon, p.name); map.closePopup(); setMobileView('planner'); $(which).focus({preventScroll:true}); };
    actions.append(button);
  }
  content.append(actions); return content;
}
function applyStationEmphasis() {
  const dim = !!selectedRoute || !!stationFocusId || loadingRoute;
  for (const {marker, id} of stationMarkerItems) {
    const relevant = !!id && (id === stationFocusId || routeStationIds.has(id));
    const opacity = dim && !relevant ? .23 : 1;
    if (marker.setOpacity) marker.setOpacity(opacity);
    else marker.setStyle({opacity, fillOpacity:.94*opacity});
    marker.getElement()?.classList.toggle('selected', !!id && id === stationFocusId);
  }
  document.body.classList.toggle('station-focus', !!stationFocusId);
}
function showMobileStation(feature) {
  $('station-sheet').hidden = !isMobile();
  if (isMobile()) $('station-sheet-content').replaceChildren(stationPopup(feature));
}
$('close-station').onclick = () => map.closePopup();
function addStation(feature) {
  const p = feature.properties, fresh = isFresh(p), point = [...feature.geometry.coordinates].reverse();
  const available = fresh && p.bikes > 0 && p.renting && p.installed;
  const used = routeStationIds.has(p.id);
  const state = fresh ? available ? '' : 'empty' : 'unknown';
  const marker = L.marker(point, {
    pane:'stations', icon:L.divIcon({className:`station-icon ${state} ${used ? 'used' : ''}`,
      html:`<span>${fresh ? p.bikes ?? '?' : '?'}</span>`, iconSize:[44,44], iconAnchor:[22,22]}),
    title:`${p.name}: ${fresh ? p.bikes : 'availability unknown'}`
  });
  marker.bindPopup(() => stationPopup(feature), {className:'station-source', maxWidth:360, minWidth:280, autoPan:!isMobile(), autoPanPadding:[20,30]});
  marker.on('popupopen', () => {
    stationFocusId = p.id; stationPopupMarker = marker; popupSignature = '';
    showMobileStation(feature);
    applyStationEmphasis(); areaLayer.clearLayers();
    if (p.area) L.geoJSON(p.area, {style:{color:'#26814f', weight:2, fillOpacity:.16}, interactive:false}).addTo(areaLayer);
  });
  marker.on('popupclose', () => {
    if (stationPopupMarker !== marker) return;
    stationFocusId = null; stationPopupMarker = null; areaLayer.clearLayers(); applyStationEmphasis();
    $('station-sheet').hidden = true;
    if (!renderingStations) renderStations();
  });
  stationMarkerItems.push({marker,id:p.id}); marker.addTo(stationsLayer);
}
function renderStations() {
  if (!stationData) return;
  // Keep the station card open while background data or map position changes.
  if (stationPopupMarker?.isPopupOpen()) {
    const current = stationData.features.find(f => f.properties.id === stationFocusId);
    if (current) {
      const signature = JSON.stringify([current.properties, isFresh(current.properties)]);
      if (signature !== popupSignature) { stationPopupMarker.setPopupContent(stationPopup(current)); showMobileStation(current); popupSignature = signature; }
    }
    applyStationEmphasis(); return;
  }
  renderingStations = true;
  stationsLayer.clearLayers(); stationMarkerItems.length = 0;

  const freshCount = stationData.features.filter(f => isFresh(f.properties)).length;
  const visible = stationData.features.filter(f => {
    const used = routeStationIds.has(f.properties.id);
    return (used || f.properties.id === stationFocusId || $('all-stations').checked) && map.getBounds().pad(.08).contains([...f.geometry.coordinates].reverse());
  });
  if (map.getZoom() >= 15) visible.forEach(addStation);
  else {
    const groups = new Map(), zoom = map.getZoom();
    for (const feature of visible) {
      if (routeStationIds.has(feature.properties.id) || feature.properties.id === stationFocusId) { addStation(feature); continue; }
      const pixel = map.project([...feature.geometry.coordinates].reverse(), zoom);
      const key = `${Math.floor(pixel.x / 70)},${Math.floor(pixel.y / 70)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(feature);
    }
    for (const group of groups.values()) {
      if (group.length === 1) { addStation(group[0]); continue; }
      const lat = group.reduce((sum,f) => sum + f.geometry.coordinates[1], 0) / group.length;
      const lon = group.reduce((sum,f) => sum + f.geometry.coordinates[0], 0) / group.length;
      const cluster = L.marker([lat,lon], {pane:'stations', icon:L.divIcon({className:'station-cluster', html:`<span>${group.length}</span>`, iconSize:[44,44], iconAnchor:[22,22]}), title:`${group.length} stations — zoom in`})
        .on('click', () => map.setView([lat,lon], Math.min(16, zoom + 2))).addTo(stationsLayer);
      stationMarkerItems.push({marker:cluster,id:null});
    }
  }
  $('feed-status').textContent = `${stationData.features.length} stations · ${selectedRoute ? 'route in focus' : freshCount ? 'live availability' : 'availability unknown'}`;
  renderingStations = false; applyStationEmphasis();
}
map.on('zoomend moveend', renderStations);
$('all-stations').onchange = renderStations;
async function loadStations() {
  if (loadingStations) return;
  loadingStations = true;
  try {
    const response = await fetch('/api/stations', {signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw new Error();
    stationData = await response.json(); renderStations();
  } catch {
    if (stationData) { for (const f of stationData.features) f.properties.fresh = false; renderStations(); }
    else $('feed-status').textContent = 'Could not load stations. Try refreshing.';
  } finally { loadingStations = false; }
}
$('refresh').onclick = loadStations;
setInterval(loadStations, 60000); setInterval(renderStations, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderStations(); loadStations(); } });
loadStations();
fetch('/api/sources').then(response => response.json()).then(data => {
  if (data.mvv_retrieved_at) $('mvv-date').textContent = `Retrieved ${new Date(data.mvv_retrieved_at).toLocaleDateString('en-GB', {timeZone:'Europe/Berlin'})}.`;
}).catch(() => {});

function decodePolyline(encoded) {
  let i = 0, lat = 0, lon = 0; const coordinates = [];
  while (i < encoded.length) {
    const read = () => {
      let value = 0, shift = 0, b;
      do { b = encoded.charCodeAt(i++) - 63; value |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < encoded.length);
      return value & 1 ? ~(value >> 1) : value >> 1;
    };
    lat += read(); lon += read(); coordinates.push([lat / 1e5, lon / 1e5]);
  }
  return coordinates;
}
function legColors(route) {
  const lines = new Map(), palette = ['#2567a3','#8853a1','#237c80','#a34f70'];
  return route.legs.map(leg => {
    if (leg.rentedBike) return '#946017';
    if (!leg.transitLeg) return '#52675a';
    const key = leg.route?.gtfsId || leg.route?.shortName || leg.mode;
    if (!lines.has(key)) lines.set(key, palette[lines.size % palette.length]);
    return lines.get(key);
  });
}
function focusLeg(index, scrollToMap = true) {
  if (!selectedRoute) return;
  selectedRoute.legs.forEach((leg,i) => legLines[i]?.setStyle({opacity:i === index ? 1 : .28, weight:i === index ? 8 : 4}));
  selectedCard.querySelectorAll('.step-button').forEach((node,i) => node.classList.toggle('active', i === index));
  const leg = selectedRoute.legs[index];
  const line = legLines[index];
  map.fitBounds(line ? line.getBounds() : [[leg.from.lat,leg.from.lon],[leg.to.lat,leg.to.lon]], {padding:[50,85], maxZoom:16});
  if (scrollToMap && isMobile()) setMobileView('map');
}
function waypoint(place, number, title, timestamp, index, color) {
  const content = el('div', undefined, 'waypoint-popup'); content.append(el('strong', title), el('p', `${time(timestamp)} · ${placeName(place.name) || ''}`));
  const sid = place.vehicleRentalStation?.stationId?.split(':').pop();
  const station = sid && stationData?.features.find(f => f.properties.id === sid);
  if (station) content.append(stationPopup(station));
  const marker = L.marker([place.lat,place.lon], {pane:'waypoints', icon:L.divIcon({className:'waypoint-icon', html:String(number), iconSize:[28,28], iconAnchor:[14,14]})});
  marker.bindPopup(content).on('click', () => focusLeg(index, false)).addTo(waypointsLayer);
}
function showRoute(route, card) {
  map.closePopup();
  selectedRoute = route; selectedCard = card;
  routeLayer.clearLayers(); waypointsLayer.clearLayers(); legLines = [];
  routeStationIds = new Set(route.legs.flatMap(leg => [leg.from,leg.to]).map(p => p.vehicleRentalStation?.stationId?.split(':').pop()).filter(Boolean));
  document.querySelectorAll('.route-card').forEach(n => {
    n.classList.toggle('selected', n === card);
    n.querySelector('.route-details').hidden = n !== card;
    n.querySelector('.route-select').setAttribute('aria-expanded', String(n === card));
  });
  const colors = legColors(route), bounds = [], key = $('route-key');
  key.replaceChildren(); key.hidden = false;
  route.legs.forEach((leg,index) => {
    const line = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [];
    if (line.length) {
      bounds.push(...line);
      // A white underlay keeps adjacent modes distinct on busy map backgrounds.
      L.polyline(line, {pane:'route', color:'#fff', weight:9, opacity:.9, interactive:false}).addTo(routeLayer);
      legLines[index] = L.polyline(line, {pane:'route', color:colors[index], weight:leg.mode === 'WALK' ? 4 : 6,
        dashArray:leg.mode === 'WALK' ? '3 8' : null, opacity:.95, bubblingMouseEvents:false})
        .on('click', () => focusLeg(index, false)).addTo(routeLayer);
    }
    const chip = el('button', `${index+1} ${modeName(leg)}`); chip.type = 'button'; chip.style.setProperty('--leg-color', colors[index]);
    chip.onclick = () => focusLeg(index); key.append(chip);
    const title = leg.transitLeg ? `Board · ${modeName(leg)}` : leg.rentedBike ? 'Pick up a bike' : index && route.legs[index-1].rentedBike ? 'Return the bike and walk' : index && route.legs[index-1].transitLeg ? 'Get off and walk' : 'Walking leg';
    waypoint(leg.from, index+1, title, leg.startTime, index, colors[index]);
    if (index === route.legs.length-1) waypoint(leg.to, 'B', 'Arrival', leg.endTime, index, colors[index]);
  });
  if (bounds.length) map.fitBounds(bounds, {padding:[50,85]});
  $('map-hint').textContent = 'Map numbers match the steps. Tap a step to highlight its route.';
  renderStations();
}
function renderRoutes(data) {
  $('results').replaceChildren();
  $('results').append(el('p', 'MVV schedules · includes waits and transfers · live delays are not included.', 'route-note'));
  for (const warning of data.warnings.filter(w => w.includes('Some route options'))) $('results').append(el('p', warning, 'route-note'));
  if (!data.routes.length) { $('message').textContent = 'No routes found with these limits. Allow more walking or try different points.'; return; }
  const n = data.routes.length, word = n === 1 ? 'option' : 'options';
  $('message').textContent = `${n} ${word} · arrival times include waiting`;
  let firstCard;
  for (const route of data.routes) {
    const card = el('article', undefined, 'route-card'), select = el('button', undefined, 'route-select'); select.type = 'button';
    const top = el('div', undefined, 'route-top'); top.append(el('strong', `${minutes(route.total_seconds)} min`));
    if (route.kind !== 'transit' && route.saved_seconds >= 60) top.append(el('span', `−${Math.floor(route.saved_seconds / 60)} min`, 'badge'));
    select.append(top, el('div', {mixed:'Transit + MyRadl', bike:'MyRadl', transit:'Transit / walking'}[route.kind], 'route-kind'));
    select.append(el('div', `${time(route.start_time)} → ${time(route.end_time)} · Munich${route.initial_wait_seconds >= 60 ? ` · leave in ${minutes(route.initial_wait_seconds)} min` : ''}`, 'route-times'));
    const badges = el('div', undefined, 'route-modes'), colors = legColors(route);
    route.legs.forEach((leg,i) => { const badge = el('span', `${i+1} ${modeName(leg)}`); badge.style.setProperty('--leg-color', colors[i]); badges.append(badge); });
    select.append(badges);
    select.append(el('div', `Walk ${minutes(route.walk_seconds)} min · bike ${minutes(route.bike_seconds)} min · wait ${minutes(route.waiting_seconds || 0)} min · transfers ${route.transfers}`, 'metric'));
    card.append(select);
    const details = el('div', undefined, 'route-details'); details.hidden = true;
    const overview = el('button', 'View full route on map ↗', 'route-show-map'); overview.type = 'button';
    overview.onclick = () => { showRoute(route, card); setMobileView('map'); };
    details.append(overview);
    const timeline = el('ol', undefined, 'timeline');
    route.legs.forEach((leg,index) => {
      const row = el('li'), connection = route.connections?.find(c => c.before_leg_index === index);
      if (connection) row.append(el('div', `Transfer: ${time(connection.alight_time)} → ${time(connection.board_time)} · walk ${durationText(connection.walk_seconds)} + wait ${durationText(connection.wait_seconds)}`, 'connection-note'));
      if (leg.wait_before_seconds > 0) row.append(el('div', `${time(leg.startTime-leg.wait_before_seconds*1000)}–${time(leg.startTime)} · wait ${durationText(leg.wait_before_seconds)}${leg.transitLeg ? ` · ${modeName(leg)}` : ''}`, 'wait-row'));
      const step = el('button', undefined, 'step-button'); step.type = 'button'; step.style.setProperty('--leg-color', colors[index]);
      const number = el('span', String(index+1), 'step-number'), body = el('span', undefined, 'step-body');
      body.append(el('strong', `${modeName(leg)} · ${leg.duration < 60 ? durationText(leg.duration) : `${minutes(leg.duration)} min`}`));
      body.append(el('span', `${time(leg.startTime)} ${placeName(leg.from.name) || 'A'} → ${time(leg.endTime)} ${placeName(leg.to.name) || 'B'}`, 'step-places'));
      if (leg.transitLeg && leg.headsign) body.append(el('span', `Towards ${leg.headsign}`, 'step-direction'));
      if (leg.rentedBike) body.append(el('span', 'Pick up a bike → return at a station', 'step-direction'));
      body.append(el('span', 'Highlight on map ↗', 'step-map-link')); step.append(number,body);
      step.onclick = () => { if (selectedRoute !== route) showRoute(route,card); focusLeg(index); };
      row.append(step); timeline.append(row);
    });
    details.append(timeline);
    for (const warning of route.warnings) details.append(el('p', warning, 'warning'));
    details.append(el('p', 'Bike rental is planned before or after transit. A bike ride between two transit journeys is not supported yet.', 'route-note'));
    card.append(details); select.onclick = () => showRoute(route,card);
    $('results').append(card); firstCard ||= card;
  }
  showRoute(data.routes[0], firstCard);
  if (isMobile()) { setMobileView('planner'); requestAnimationFrame(() => $('results').scrollIntoView({behavior:'smooth', block:'start'})); }
}
$('trip-form').onsubmit = async event => {
  event.preventDefault();
  if (!points.origin || !points.destination) { $('message').textContent = 'Choose a search result for both points or pick them on the map.'; return; }
  map.closePopup(); invalidate(); const revision = tripRevision;
  loadingRoute = true; applyStationEmphasis();
  $('submit').disabled = true; $('message').textContent = 'Comparing your routes…';
  try {
    const response = await fetch('/api/routes', {method:'POST', headers:{'Content-Type':'application/json'},
      signal:AbortSignal.timeout(55000), body:JSON.stringify({origin:{lat:points.origin.lat,lon:points.origin.lon}, destination:{lat:points.destination.lat,lon:points.destination.lon},
        departure:new Date($('departure').value).toISOString(), max_walk_minutes:+$('max-walk').value, max_bike_minutes:+$('max-bike').value})});
    const data = await response.json();
    if (revision !== tripRevision) return;
    if (!response.ok) { $('message').textContent = typeof data.detail === 'string' ? data.detail : 'Check that your points are near Munich, and review the date and limits.'; return; }
    renderRoutes(data);
  } catch { if (revision === tripRevision) $('message').textContent = 'Routing is unavailable or took too long. Please try again.'; }
  finally { $('submit').disabled = false; loadingRoute = false; applyStationEmphasis(); }
};
