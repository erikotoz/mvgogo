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
  return m ? `${m} мин${s ? ` ${s} с` : ''}` : `${s} с`;
};
const time = timestamp => new Intl.DateTimeFormat('ru', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
}).format(timestamp);
const placeName = name => name === 'Origin' ? 'A' : name === 'Destination' ? 'B' : name;
const names = {WALK:'Пешком', BICYCLE:'Велосипед', BUS:'Автобус', SUBWAY:'Метро', RAIL:'Поезд', TRAM:'Трамвай'};
const modeName = leg => leg.rentedBike ? 'MyRadl' : `${names[leg.mode] || leg.mode}${leg.route?.shortName ? ` ${leg.route.shortName}` : ''}`;
const deviceNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};
$('departure').value = deviceNow();

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
  $('map-hint').textContent = `Нажми на карту, чтобы выбрать ${which === 'origin' ? 'отправление A' : 'назначение B'}`;
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
  if (query.length < 2) { $('message').textContent = 'Введи хотя бы два символа адреса или названия.'; return; }
  closeSearch(which);
  const controller = new AbortController(); searches[which] = controller;
  const results = $(`${which}-results`);
  results.replaceChildren(el('p', 'Ищем место…')); results.hidden = false;
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {signal: controller.signal});
    const data = await response.json();
    if (searches[which] !== controller) return;
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось найти место.');
    results.replaceChildren();
    if (!data.results.length) results.append(el('p', 'Не найдено в районе Мюнхена. Уточни адрес или выбери точку на карте.'));
    for (const place of data.results) {
      const button = el('button', place.label); button.type = 'button';
      button.onclick = () => { setPoint(which, place.lat, place.lon, place.label); map.setView([place.lat, place.lon], 16); };
      results.append(button);
    }
  } catch (error) {
    if (!controller.signal.aborted) results.replaceChildren(el('p', error.message || 'Поиск недоступен. Выбери точку на карте.'));
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
  $('message').textContent = 'Пример: Münchner Freiheit → Westpark. Нажми «Найти маршрут».';
};
$('locate').onclick = () => {
  if (!navigator.geolocation) { $('message').textContent = 'Геолокация недоступна. Выбери точку на карте.'; return; }
  navigator.geolocation.getCurrentPosition(position => {
    setPoint('origin', position.coords.latitude, position.coords.longitude, 'Моё положение');
    map.setView([position.coords.latitude, position.coords.longitude], 15);
  }, () => { $('message').textContent = 'Не удалось определить положение. Выбери точку на карте.'; });
};

function updateSavedButtons() {
  savedPlacesLayer.clearLayers();
  for (const [kind, place] of Object.entries(savedPlaces)) {
    if (!['home','work'].includes(kind) || !Number.isFinite(place?.lat) || !Number.isFinite(place?.lon)) continue;
    L.marker([place.lat,place.lon], {icon:L.divIcon({className:'savedplace-icon', html:kind === 'home' ? '⌂' : '▣', iconSize:[24,24]}),
      title:`${kind === 'home' ? 'Дом' : 'Работа'} · ${place.label}`})
      .bindTooltip(() => el('span', `${kind === 'home' ? 'Дом' : 'Работа'} · ${place.label}`))
      .on('click', () => setPoint(picking,place.lat,place.lon,place.label)).addTo(savedPlacesLayer);
  }
  document.querySelectorAll('[data-use]').forEach(button => {
    const p = savedPlaces[button.dataset.use];
    button.title = p?.label || 'Метка ещё не сохранена';
    button.classList.toggle('is-saved', !!p);
  });
}
document.querySelectorAll('[data-save]').forEach(button => button.onclick = () => {
  saveField = button.dataset.save;
  if (!points[saveField]) { $('message').textContent = 'Сначала выбери место из поиска или на карте, затем сохрани его.'; return; }
  $('save-label').textContent = points[saveField].label; $('save-error').textContent = '';
  $('save-dialog').showModal();
});
document.querySelectorAll('[data-use]').forEach(button => button.onclick = () => {
  const saved = savedPlaces[button.dataset.use];
  if (!saved || !Number.isFinite(saved.lat) || !Number.isFinite(saved.lon)) {
    $('message').textContent = 'Сначала выбери место и нажми «Сохранить точку…» под нужным полем.'; return;
  }
  setPoint(button.dataset.field, saved.lat, saved.lon, saved.label);
  map.setView([saved.lat, saved.lon], 15);
});
function storePlaces(next) {
  try { localStorage.setItem('mvgogo.places', JSON.stringify(next)); savedPlaces = next; updateSavedButtons(); return true; }
  catch { $('save-error').textContent = 'Браузер не разрешил сохранить метки.'; return false; }
}
$('save-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  if (storePlaces({...savedPlaces, [$('save-kind').value]: {...points[saveField]}})) {
    $('save-dialog').close(); $('message').textContent = 'Место сохранено в этом браузере.';
  }
});
$('delete-place').onclick = () => {
  const next = {...savedPlaces}; delete next[$('save-kind').value];
  if (storePlaces(next)) { $('save-dialog').close(); $('message').textContent = 'Метка удалена.'; }
};
updateSavedButtons();

function isFresh(properties) {
  const now = Date.now() / 1000;
  return properties.fresh && [properties.reported_at, stationData.meta.status_updated_at]
    .every(t => Number.isFinite(t) && now - t <= stationData.meta.max_age_seconds && now - t >= -60);
}
function stationPopup(feature) {
  const p = feature.properties, [lon,lat] = feature.geometry.coordinates;
  const fresh = isFresh(p), content = el('div');
  content.append(el('strong', p.name));
  content.append(el('p', fresh ? `${p.bikes ?? '?'} велосипедов · ${p.renting && p.installed ? 'аренда открыта' : 'аренда закрыта'}` : 'Наличие неизвестно — проверь в приложении.'));
  if (fresh) {
    for (const type of p.by_type) content.append(el('p', `${type.name}: ${type.count}`));
    content.append(el('p', p.returning && p.installed ? 'Возврат разрешён по данным оператора.' : 'Возврат сейчас закрыт.'));
    content.append(el('p', `Обновлено ${time(p.reported_at * 1000)} · наличие при прибытии не гарантируется.`));
  }
  const url = p.rental_url;
  if (url && /^https:\/\/(nxtb\.it|app\.nextbike\.net)(\/|$)/.test(url)) {
    const link = el('a', 'Открыть у оператора ↗');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link);
  }
  content.append(el('br'));
  for (const [which, text] of [['origin','Отсюда'],['destination','Сюда']]) {
    const button = el('button', text); button.type = 'button';
    button.onclick = () => { setPoint(which, lat, lon, p.name); map.closePopup(); }; content.append(button);
  }
  return content;
}
function addStation(feature) {
  const p = feature.properties, fresh = isFresh(p), point = [...feature.geometry.coordinates].reverse();
  const available = fresh && p.bikes > 0 && p.renting && p.installed;
  const used = routeStationIds.has(p.id), detailed = used || map.getZoom() >= 16;
  const state = fresh ? available ? '' : 'empty' : 'unknown';
  const marker = detailed ? L.marker(point, {
    pane:'stations', icon:L.divIcon({className:`station-icon quiet ${state} ${used ? 'used' : ''}`,
      html:fresh ? `${p.bikes ?? '?'}` : '?', iconSize:[used ? 24 : 19,used ? 24 : 19]}),
    title:`${p.name}: ${fresh ? p.bikes : 'наличие неизвестно'}`
  }) : L.circleMarker(point, {pane:'stations', radius:4, weight:1, color:'#fff',
    fillColor:!fresh ? '#b89d72' : available ? '#87977d' : '#b6bdb3', fillOpacity:.65, bubblingMouseEvents:false});
  marker.bindPopup(() => stationPopup(feature));
  marker.on('popupopen', () => {
    areaLayer.clearLayers();
    if (p.area) L.geoJSON(p.area, {style:{color:'#758d5f', weight:1, fillOpacity:.13}}).addTo(areaLayer);
  });
  marker.on('popupclose', () => areaLayer.clearLayers());
  marker.addTo(stationsLayer);
}
function renderStations() {
  stationsLayer.clearLayers();
  if (!stationData) return;
  const freshCount = stationData.features.filter(f => isFresh(f.properties)).length;
  const visible = stationData.features.filter(f => {
    const used = routeStationIds.has(f.properties.id);
    return (used || $('all-stations').checked) && map.getBounds().pad(.08).contains([...f.geometry.coordinates].reverse());
  });
  if (map.getZoom() >= 15) visible.forEach(addStation);
  else {
    const groups = new Map(), zoom = map.getZoom();
    for (const feature of visible) {
      if (routeStationIds.has(feature.properties.id)) { addStation(feature); continue; }
      const pixel = map.project([...feature.geometry.coordinates].reverse(), zoom);
      const key = `${Math.floor(pixel.x / 58)},${Math.floor(pixel.y / 58)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(feature);
    }
    for (const group of groups.values()) {
      if (group.length === 1) { addStation(group[0]); continue; }
      const lat = group.reduce((sum,f) => sum + f.geometry.coordinates[1], 0) / group.length;
      const lon = group.reduce((sum,f) => sum + f.geometry.coordinates[0], 0) / group.length;
      L.marker([lat,lon], {pane:'stations', icon:L.divIcon({className:'station-cluster', html:String(group.length), iconSize:[26,26]}), title:`${group.length} станций — приблизить`})
        .on('click', () => map.setView([lat,lon], Math.min(16, zoom + 2))).addTo(stationsLayer);
    }
  }
  $('feed-status').textContent = `${stationData.features.length} станций · ${freshCount ? 'наличие обновляется' : 'наличие неизвестно'}${selectedRoute && !$('all-stations').checked ? ' · только на маршруте' : ''}`;
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
    else $('feed-status').textContent = 'Не удалось загрузить станции. Попробуй обновить.';
  } finally { loadingStations = false; }
}
$('refresh').onclick = loadStations;
setInterval(loadStations, 60000); setInterval(renderStations, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderStations(); loadStations(); } });
loadStations();
fetch('/api/sources').then(response => response.json()).then(data => {
  if (data.mvv_retrieved_at) $('mvv-date').textContent = `Загружено ${new Date(data.mvv_retrieved_at).toLocaleDateString('ru', {timeZone:'Europe/Berlin'})}.`;
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
    if (leg.rentedBike) return '#b87922';
    if (!leg.transitLeg) return '#7a8581';
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
  if (scrollToMap && matchMedia('(max-width:800px)').matches) $('map').scrollIntoView({behavior:'smooth', block:'start'});
}
function waypoint(place, number, title, timestamp, index, color) {
  const content = el('div'); content.append(el('strong', title), el('p', `${time(timestamp)} · ${placeName(place.name) || ''}`));
  const sid = place.vehicleRentalStation?.stationId?.split(':').pop();
  const station = sid && stationData?.features.find(f => f.properties.id === sid);
  if (station) content.append(stationPopup(station));
  const marker = L.marker([place.lat,place.lon], {pane:'waypoints', icon:L.divIcon({className:'waypoint-icon', html:String(number), iconSize:[22,22], iconAnchor:[11,11]})});
  marker.bindPopup(content).on('click', () => focusLeg(index, false)).addTo(waypointsLayer);
}
function showRoute(route, card) {
  const firstSelection = !selectedRoute;
  selectedRoute = route; selectedCard = card;
  routeLayer.clearLayers(); waypointsLayer.clearLayers(); legLines = [];
  if (firstSelection) $('all-stations').checked = false;
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
    const title = leg.transitLeg ? `Посадка · ${modeName(leg)}` : leg.rentedBike ? 'Взять велосипед' : index && route.legs[index-1].rentedBike ? 'Вернуть велосипед и идти пешком' : index && route.legs[index-1].transitLeg ? 'Выход и переход пешком' : 'Пеший участок';
    waypoint(leg.from, index+1, title, leg.startTime, index, colors[index]);
    if (index === route.legs.length-1) waypoint(leg.to, 'B', 'Прибытие', leg.endTime, index, colors[index]);
  });
  if (bounds.length) map.fitBounds(bounds, {padding:[50,85]});
  $('map-hint').textContent = 'Номера на карте соответствуют шагам. Нажми на шаг, чтобы выделить участок.';
  renderStations();
}
function renderRoutes(data) {
  $('results').replaceChildren();
  $('results').append(el('p', 'По расписанию MVV · ожидание и переходы учтены · текущие задержки не учтены.', 'route-note'));
  for (const warning of data.warnings.filter(w => w.includes('Часть'))) $('results').append(el('p', warning, 'route-note'));
  if (!data.routes.length) { $('message').textContent = 'Маршрутов с такими ограничениями не найдено. Попробуй увеличить время ходьбы или изменить точки.'; return; }
  const n = data.routes.length, word = n % 10 === 1 && n % 100 !== 11 ? 'вариант' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'варианта' : 'вариантов';
  $('message').textContent = `${n} ${word} · время до прибытия с учётом ожидания`;
  let firstCard;
  for (const route of data.routes) {
    const card = el('article', undefined, 'route-card'), select = el('button', undefined, 'route-select'); select.type = 'button';
    const top = el('div', undefined, 'route-top'); top.append(el('strong', `${minutes(route.total_seconds)} мин`));
    if (route.kind !== 'transit' && route.saved_seconds >= 60) top.append(el('span', `−${Math.floor(route.saved_seconds / 60)} мин`, 'badge'));
    select.append(top, el('div', {mixed:'Транспорт + MyRadl', bike:'MyRadl', transit:'Общественный транспорт / пешком'}[route.kind], 'route-kind'));
    select.append(el('div', `${time(route.start_time)} → ${time(route.end_time)} · Мюнхен${route.initial_wait_seconds >= 60 ? ` · до выхода ${minutes(route.initial_wait_seconds)} мин` : ''}`, 'route-times'));
    const badges = el('div', undefined, 'route-modes'), colors = legColors(route);
    route.legs.forEach((leg,i) => { const badge = el('span', `${i+1} ${modeName(leg)}`); badge.style.setProperty('--leg-color', colors[i]); badges.append(badge); });
    select.append(badges);
    select.append(el('div', `Пешком ${minutes(route.walk_seconds)} мин · велосипед ${minutes(route.bike_seconds)} мин · ожидание ${minutes(route.waiting_seconds || 0)} мин · пересадок ${route.transfers}`, 'metric'));
    card.append(select);
    const details = el('div', undefined, 'route-details'); details.hidden = true;
    const timeline = el('ol', undefined, 'timeline');
    route.legs.forEach((leg,index) => {
      const row = el('li'), connection = route.connections?.find(c => c.before_leg_index === index);
      if (connection) row.append(el('div', `Пересадка: ${time(connection.alight_time)} → ${time(connection.board_time)} · переход ${durationText(connection.walk_seconds)} + ожидание ${durationText(connection.wait_seconds)}`, 'connection-note'));
      if (leg.wait_before_seconds > 0) row.append(el('div', `${time(leg.startTime-leg.wait_before_seconds*1000)}–${time(leg.startTime)} · ожидание ${durationText(leg.wait_before_seconds)}${leg.transitLeg ? ` · ${modeName(leg)}` : ''}`, 'wait-row'));
      const step = el('button', undefined, 'step-button'); step.type = 'button'; step.style.setProperty('--leg-color', colors[index]);
      const number = el('span', String(index+1), 'step-number'), body = el('span', undefined, 'step-body');
      body.append(el('strong', `${modeName(leg)} · ${leg.duration < 60 ? durationText(leg.duration) : `${minutes(leg.duration)} мин`}`));
      body.append(el('span', `${time(leg.startTime)} ${placeName(leg.from.name) || 'A'} → ${time(leg.endTime)} ${placeName(leg.to.name) || 'B'}`, 'step-places'));
      if (leg.transitLeg && leg.headsign) body.append(el('span', `В сторону ${leg.headsign}`, 'step-direction'));
      if (leg.rentedBike) body.append(el('span', 'Взять велосипед → вернуть на станции', 'step-direction'));
      body.append(el('span', 'Выделить на карте ↗', 'step-map-link')); step.append(number,body);
      step.onclick = () => { if (selectedRoute !== route) showRoute(route,card); focusLeg(index); };
      row.append(step); timeline.append(row);
    });
    details.append(timeline);
    for (const warning of route.warnings) details.append(el('p', warning, 'warning'));
    details.append(el('p', 'Прокат учитывается до или после транспорта. Велосипед между двумя поездками на транспорте пока не рассчитывается.', 'route-note'));
    card.append(details); select.onclick = () => showRoute(route,card);
    $('results').append(card); firstCard ||= card;
  }
  showRoute(data.routes[0], firstCard);
}
$('trip-form').onsubmit = async event => {
  event.preventDefault();
  if (!points.origin || !points.destination) { $('message').textContent = 'Выбери результат поиска для обеих точек или отметь их на карте.'; return; }
  invalidate(); const revision = tripRevision;
  $('submit').disabled = true; $('message').textContent = 'Сравниваем маршруты…';
  try {
    const response = await fetch('/api/routes', {method:'POST', headers:{'Content-Type':'application/json'},
      signal:AbortSignal.timeout(55000), body:JSON.stringify({origin:{lat:points.origin.lat,lon:points.origin.lon}, destination:{lat:points.destination.lat,lon:points.destination.lon},
        departure:new Date($('departure').value).toISOString(), max_walk_minutes:+$('max-walk').value, max_bike_minutes:+$('max-bike').value})});
    const data = await response.json();
    if (revision !== tripRevision) return;
    if (!response.ok) { $('message').textContent = typeof data.detail === 'string' ? data.detail : 'Проверь координаты в районе Мюнхена, дату и ограничения.'; return; }
    renderRoutes(data);
  } catch { if (revision === tripRevision) $('message').textContent = 'Расчёт недоступен или занял слишком много времени. Попробуй ещё раз.'; }
  finally { $('submit').disabled = false; }
};
