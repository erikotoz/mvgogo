const $ = id => document.getElementById(id);
const map = L.map('map', {zoomControl: false}).setView([48.137, 11.575], 13);
L.control.zoom({position: 'topright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
const stationsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const areaLayer = L.layerGroup().addTo(map);
const points = {}, pointMarkers = {};
let picking = 'origin', stationData = null, loadingStations = false, tripRevision = 0;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const minutes = seconds => Math.ceil(seconds / 60);
const time = timestamp => new Intl.DateTimeFormat('ru', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
}).format(timestamp);
const deviceNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};
$('departure').value = deviceNow();

function invalidate() {
  tripRevision++;
  routeLayer.clearLayers();
  $('results').replaceChildren();
}
function choosePoint(which) {
  picking = which;
  $('pick-origin').classList.toggle('active', which === 'origin');
  $('pick-destination').classList.toggle('active', which === 'destination');
  $('map-hint').textContent = which === 'origin' ? 'Нажми на карту, чтобы выбрать отправление A' : 'Нажми на карту, чтобы выбрать назначение B';
}
function setPoint(which, lat, lon) {
  invalidate();
  points[which] = {lat: +lat, lon: +lon};
  $(which).value = `${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}`;
  if (pointMarkers[which]) map.removeLayer(pointMarkers[which]);
  pointMarkers[which] = L.marker([lat, lon], {zIndexOffset: 1000, icon: L.divIcon({
    className: 'point-icon', html: which === 'origin' ? 'A' : 'B', iconSize: [34,34], iconAnchor: [17,17]
  })}).addTo(map);
  choosePoint(which === 'origin' ? 'destination' : 'origin');
}
map.on('click', event => setPoint(picking, event.latlng.lat, event.latlng.lng));
$('pick-origin').onclick = () => choosePoint('origin');
$('pick-destination').onclick = () => choosePoint('destination');
for (const id of ['origin', 'destination']) {
  $(id).addEventListener('focus', () => choosePoint(id));
  $(id).addEventListener('input', () => { delete points[id]; invalidate(); });
  $(id).addEventListener('change', () => {
    const pair = $(id).value.split(',').map(Number);
    if (pair.length === 2 && pair.every(Number.isFinite)) setPoint(id, ...pair);
  });
}
for (const id of ['departure','max-walk','max-bike']) $(id).onchange = invalidate;
$('swap').onclick = () => {
  if (!points.origin || !points.destination) return;
  const a = {...points.origin}, b = {...points.destination};
  setPoint('origin', b.lat, b.lon); setPoint('destination', a.lat, a.lon);
};
$('example').onclick = () => {
  setPoint('origin', 48.1618, 11.5869);
  setPoint('destination', 48.123, 11.521);
  $('departure').value = deviceNow();
  map.fitBounds([[48.1618,11.5869],[48.123,11.521]], {padding:[55,55]});
  $('message').textContent = 'Пример: Münchner Freiheit → Westpark. Нажми «Найти маршрут».';
};
$('locate').onclick = () => {
  if (!navigator.geolocation) { $('message').textContent = 'Геолокация недоступна. Выбери точку на карте.'; return; }
  navigator.geolocation.getCurrentPosition(position => {
    setPoint('origin', position.coords.latitude, position.coords.longitude);
    map.setView([position.coords.latitude, position.coords.longitude], 15);
  }, () => { $('message').textContent = 'Не удалось определить положение. Выбери точку на карте.'; });
};

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
    button.onclick = () => { setPoint(which, lat, lon); map.closePopup(); }; content.append(button);
  }
  return content;
}
function renderStations() {
  stationsLayer.clearLayers();
  if (!stationData) return;
  let freshCount = 0;
  for (const feature of stationData.features) {
    const p = feature.properties, fresh = isFresh(p);
    if (fresh) freshCount++;
    const available = fresh && p.bikes > 0 && p.renting && p.installed;
    const marker = L.marker([...feature.geometry.coordinates].reverse(), {
      icon: L.divIcon({className: `station-icon ${fresh ? available ? '' : 'empty' : 'unknown'}`,
        html: fresh ? `${p.bikes ?? '?'}` : '?', iconSize:[25,25], iconAnchor:[12,12]}),
      keyboard: true, title: `${p.name}: ${fresh ? p.bikes : 'наличие неизвестно'}`
    });
    marker.bindPopup(() => stationPopup(feature));
    marker.on('popupopen', () => {
      areaLayer.clearLayers();
      if (p.area) L.geoJSON(p.area, {style:{color:'#54732c', weight:2, fillOpacity:.18}}).addTo(areaLayer);
    });
    marker.on('popupclose', () => areaLayer.clearLayers());
    marker.addTo(stationsLayer);
  }
  $('feed-status').textContent = `${stationData.features.length} станций · ${freshCount ? `${freshCount} с актуальным наличием` : 'наличие проверяется вручную'}`;
}
async function loadStations() {
  if (loadingStations) return;
  loadingStations = true;
  try {
    const response = await fetch('/api/stations', {signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw new Error();
    stationData = await response.json();
    renderStations();
  } catch {
    if (stationData) {
      for (const feature of stationData.features) feature.properties.fresh = false;
      renderStations();
    } else $('feed-status').textContent = 'Не удалось загрузить станции. Попробуй обновить.';
  } finally { loadingStations = false; }
}
$('refresh').onclick = loadStations;
setInterval(loadStations, 60000);
setInterval(renderStations, 15000);
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
const names = {WALK:'Пешком', BICYCLE:'Велосипед', BUS:'Автобус', SUBWAY:'Метро', RAIL:'Поезд', TRAM:'Трамвай'};
const placeName = name => name === 'Origin' ? 'A' : name === 'Destination' ? 'B' : name;
function showRoute(route, card) {
  routeLayer.clearLayers();
  document.querySelectorAll('.route-card').forEach(n => n.classList.remove('selected'));
  card.classList.add('selected');
  const bounds = [];
  for (const leg of route.legs) {
    const line = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [];
    if (!line.length) continue;
    bounds.push(...line);
    L.polyline(line, {color:leg.rentedBike ? '#729a29' : leg.mode === 'WALK' ? '#7e897a' : '#254f68',
      weight:leg.mode === 'WALK' ? 4 : 6, dashArray:leg.mode === 'WALK' ? '4 7' : null, opacity:.9}).addTo(routeLayer);
  }
  if (bounds.length) map.fitBounds(bounds, {padding:[60,80]});
}
function renderRoutes(data) {
  $('results').replaceChildren();
  const note = el('p', data.warnings.join(' '), 'route-note');
  $('results').append(note);
  if (!data.routes.length) { $('message').textContent = 'Маршрутов с такими ограничениями не найдено. Попробуй увеличить время ходьбы или изменить точки.'; return; }
  const n = data.routes.length, word = n % 10 === 1 && n % 100 !== 11 ? 'вариант' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'варианта' : 'вариантов';
  $('message').textContent = `${n} ${word} · время до прибытия с учётом ожидания`;
  let firstCard;
  for (const route of data.routes) {
    const card = el('button', undefined, 'route-card'); card.type = 'button';
    const top = el('div', undefined, 'route-top');
    top.append(el('strong', `${minutes(route.total_seconds)} мин`));
    if (route.kind !== 'transit' && route.saved_seconds > 0) top.append(el('span', `−${Math.floor(route.saved_seconds / 60)} мин`, 'badge'));
    card.append(top, el('div', {mixed:'Транспорт + MyRadl', bike:'MyRadl', transit:'Общественный транспорт / пешком'}[route.kind], 'route-kind'));
    card.append(el('div', `${time(route.start_time)} → ${time(route.end_time)} · Мюнхен${route.initial_wait_seconds > 60 ? ` · до выхода ${minutes(route.initial_wait_seconds)} мин` : ''}`, 'route-times'));
    card.append(el('div', `Пешком ${minutes(route.walk_seconds)} мин · велосипед ${minutes(route.bike_seconds)} мин · пересадок ${route.transfers}`, 'metric'));
    const steps = el('ol');
    for (const leg of route.legs) {
      const mode = leg.rentedBike ? 'MyRadl' : names[leg.mode] || leg.mode;
      const line = leg.route?.shortName ? ` ${leg.route.shortName}` : '';
      steps.append(el('li', `${mode}${line} · ${minutes(leg.duration)} мин · ${placeName(leg.from.name) || 'A'} → ${placeName(leg.to.name) || 'B'}`));
    }
    card.append(steps);
    for (const warning of route.warnings) card.append(el('p', warning, 'warning'));
    card.onclick = () => showRoute(route, card);
    $('results').append(card); firstCard ||= card;
  }
  showRoute(data.routes[0], firstCard);
}
$('trip-form').onsubmit = async event => {
  event.preventDefault();
  if (!points.origin || !points.destination) { $('message').textContent = 'Выбери обе точки на карте или введи координаты через запятую.'; return; }
  invalidate(); const revision = tripRevision;
  $('submit').disabled = true; $('message').textContent = 'Сравниваем маршруты…';
  try {
    const response = await fetch('/api/routes', {method:'POST', headers:{'Content-Type':'application/json'},
      signal:AbortSignal.timeout(55000), body:JSON.stringify({origin:points.origin, destination:points.destination,
        departure:new Date($('departure').value).toISOString(), max_walk_minutes:+$('max-walk').value, max_bike_minutes:+$('max-bike').value})});
    const data = await response.json();
    if (revision !== tripRevision) return;
    if (!response.ok) {
      $('message').textContent = typeof data.detail === 'string' ? data.detail : 'Проверь координаты в районе Мюнхена, дату и ограничения.';
      return;
    }
    renderRoutes(data);
  } catch { if (revision === tripRevision) $('message').textContent = 'Расчёт недоступен или занял слишком много времени. Попробуй ещё раз.'; }
  finally { $('submit').disabled = false; }
};
