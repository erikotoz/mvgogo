import {AppHistory, backDestination, googleMapsURL, readSession, validPoint, writeSession} from './trip-state.mjs?v=20261024-1';

const $ = id => document.getElementById(id);
const panel = document.querySelector('.panel');
const isMobile = () => matchMedia('(max-width:820px)').matches;
const map = L.map('map', {zoomControl:false}).setView([48.137,11.575],13);
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:19, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
for (const [name,z] of [['stations',410],['route',440],['waypoints',460]]) map.createPane(name).style.zIndex=z;
const stationsLayer=L.layerGroup().addTo(map), routeLayer=L.layerGroup().addTo(map);
const waypointsLayer=L.layerGroup().addTo(map), areaLayer=L.layerGroup().addTo(map), savedPlacesLayer=L.layerGroup().addTo(map);
const points={}, pointMarkers={}, searches={};
let picking=null, screen='edit', stationData=null, loadingStations=false, tripRevision=0;
let selectedRoute=null, selectedIndex=0, focusedLeg=null, resultsData=null, calculatedAt=null;
let plannedPoints=null, plannedForm=null, legLines=[], routeBounds=[], routeStationIds=new Set();
let saveField=null, savedPlaces={}, currentDetail=null, detailSignature='', loadingRoute=false;
let routingNotice=false;
let restoring=true, applyingHistory=false, saveTimer=null, scrollToRestore=0, routeController=null;
const stationMarkerItems=[];
const clone=value=>JSON.parse(JSON.stringify(value));
function el(tag,text,className) {
  const node=document.createElement(tag);
  if (text !== undefined) node.textContent=text;
  if (className) node.className=className;
  return node;
}
const minutes=seconds=>Math.ceil((seconds || 0)/60);
const durationText=seconds=>{
  const total=Math.max(0,Math.round(seconds)), m=Math.floor(total/60), s=total%60;
  return m ? `${m} min${s ? ` ${s} sec` : ''}` : `${s} sec`;
};
const time=timestamp=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(timestamp);
const placeName=name=>name === 'Origin' ? 'Start' : name === 'Destination' ? 'Destination' : name;
const names={WALK:'Walk',BICYCLE:'Bike',BUS:'Bus',SUBWAY:'U-Bahn',RAIL:'Train',TRAM:'Tram'};
const modeName=leg=>leg.rentedBike ? 'MyRadl' : `${names[leg.mode] || leg.mode}${leg.route?.shortName ? ` ${leg.route.shortName}` : ''}`;
const kindName=route=>({mixed:'Transit + MyRadl',bike:'MyRadl',transit:'Transit / walking'}[route.kind]);
const deviceNow=()=>{
  const now=new Date();
  return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
};
$('departure').value=deviceNow();
try { savedPlaces=JSON.parse(localStorage.getItem('mvgogo.places') || '{}') || {}; } catch {}
let storage;
try { storage=localStorage; } catch { storage=null; }
const saved=readSession(storage);
const navigation=new AppHistory(history,applyNavigation);

function formValues() {
  return {origin:$('origin').value,destination:$('destination').value,departure:$('departure').value,maxWalk:$('max-walk').value,maxBike:$('max-bike').value};
}
function syncClearButtons() {
  for (const id of ['origin','destination']) $(`clear-${id}`).hidden=!$(id).value.length;
}
function fillForm(value) {
  if (!value) return;
  for (const [key,id] of [['origin','origin'],['destination','destination'],['departure','departure'],['maxWalk','max-walk'],['maxBike','max-bike']]) {
    if (typeof value[key] === 'string') $(id).value=value[key];
  }
  syncClearButtons();
}
function saveTrip() {
  if (restoring) return;
  clearTimeout(saveTimer);
  const center=map.getCenter();
  const ok=writeSession(storage,{
    form:formValues(), points, plannedPoints, plannedForm, results:resultsData,
    calculatedAt, selectedIndex, legIndex:focusedLeg, screen,
    detail:currentDetail, map:{lat:center.lat,lon:center.lng,zoom:map.getZoom()},
    scrollTop:panel.scrollTop, allStations:$('all-stations').checked,
  });
  $('save-status').textContent=ok ? 'Saved on this device' : 'Saving is unavailable in this browser';
  $('save-status').classList.toggle('storage-error',!ok);
}
function queueSave() { if (!restoring) { clearTimeout(saveTimer); saveTimer=setTimeout(saveTrip,180); } }
function navState() { return {screen,detail:currentDetail,picking}; }
function recordNavigation(replace=false) {
  if (!restoring && !applyingHistory) navigation.navigate(navState(),replace);
  saveTrip();
}
function syncLayout() {
  syncClearButtons();
  const mapVisible=screen === 'map';
  document.body.dataset.mobileView=mapVisible ? 'map' : 'planner';
  document.body.dataset.screen=screen;
  document.body.classList.toggle('has-trip',!!resultsData);
  document.body.classList.toggle('place-open',!!currentDetail);
  document.body.classList.toggle('picking-point',!!picking);
  $('trip-editor').hidden=screen !== 'edit' && !!resultsData;
  $('journey').hidden=screen === 'edit' || !resultsData;
  $('message').hidden=screen !== 'edit' && !loadingRoute && !routingNotice;
  $('cancel-edit').hidden=!resultsData;
  $('edit-trip').hidden=!resultsData || screen === 'edit';
  $('app-back').hidden=!resultsData && screen === 'edit';
  $('app-back').setAttribute('aria-label',screen === 'trip' ? 'Back to trip planner' : resultsData ? 'Return to saved trip' : 'Back to trip planner');
  $('view-planner').lastChild.textContent=resultsData ? 'Trip' : 'Plan';
  $('view-planner').setAttribute('aria-pressed',String(!mapVisible));
  $('view-map').setAttribute('aria-pressed',String(mapVisible));
  panel.inert=isMobile() && mapVisible;
  document.querySelector('.map-panel').inert=isMobile() && !mapVisible;
  $('map-trip-toolbar').hidden=!selectedRoute;
  $('browse-heading').hidden=!!selectedRoute;
  $('map-start-actions').hidden=!!selectedRoute || !!picking;
  $('map-hint').hidden=!picking;
  $('map-hint-text').textContent=picking ? `Tap the map to set ${picking === 'origin' ? 'your start, A' : 'your destination, B'}` : '';
  $('pick-origin').classList.toggle('active',picking === 'origin');
  $('pick-destination').classList.toggle('active',picking === 'destination');
  $('station-sheet').hidden=!currentDetail;
  requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}
function showScreen(value,{record=true,replace=false}={}) {
  screen=value === 'trip' && !resultsData ? 'edit' : value;
  if (screen !== 'map') {
    currentDetail=null; picking=null; stationFocusChanged();
    $('station-legend').hidden=true; $('map-layers').setAttribute('aria-expanded','false');
  }
  syncLayout(); renderPointMarkers();
  if (record) recordNavigation(replace);
}
function applyNavigation(value) {
  applyingHistory=true;
  currentDetail=null; picking=null;
  showScreen(value.screen,{record:false});
  picking=value.picking;
  if (value.detail) openDetail(value.detail,false);
  stationFocusChanged(); syncLayout(); saveTrip();
  applyingHistory=false;
}
function goBack() {
  if ($('save-dialog').open) { $('save-dialog').close(); return; }
  if (!$('station-legend').hidden) { toggleLayers(false); return; }
  if (currentDetail) { closeDetail(); return; }
  if (picking) { cancelPick(); return; }
  showScreen(backDestination(screen,!!resultsData));
  panel.scrollTop=0;
}
window.addEventListener('popstate',event=>navigation.pop(event.state));
$('app-back').onclick=goBack;
$('map-back').onclick=goBack;
$('brand-home').onclick=event=>{ event.preventDefault(); showScreen(resultsData ? 'trip' : 'edit'); panel.scrollTop=0; };
$('view-planner').onclick=()=>showScreen(resultsData ? 'trip' : 'edit');
$('view-map').onclick=()=>showScreen('map');
$('edit-trip').onclick=()=>{ showScreen('edit'); panel.scrollTop=0; };
$('cancel-edit').onclick=()=>{
  if (plannedPoints) { Object.assign(points,clone(plannedPoints)); fillForm(plannedForm); }
  routingNotice=false;
  showScreen('trip'); panel.scrollTop=0;
  if (focusedLeg !== null) focusLeg(focusedLeg,false); else fitRoute();
};
matchMedia('(max-width:820px)').addEventListener('change',()=>syncLayout());

function cancelPending() { tripRevision++; routeController?.abort(); }
function closeSearch(which) {
  searches[which]?.abort(); delete searches[which]; $(`${which}-results`).hidden=true;
}
function renderPointMarkers() {
  for (const marker of Object.values(pointMarkers)) map.removeLayer(marker);
  for (const key of Object.keys(pointMarkers)) delete pointMarkers[key];
  const visible=resultsData && screen !== 'edit' && !picking ? plannedPoints : points;
  for (const which of ['origin','destination']) {
    const point=visible?.[which]; if (!validPoint(point)) continue;
    pointMarkers[which]=L.marker([point.lat,point.lon],{zIndexOffset:1000,icon:L.divIcon({
      className:'point-icon',html:which === 'origin' ? 'A' : 'B',iconSize:[30,30],iconAnchor:[15,15]
    })}).bindTooltip(()=>el('span',point.label || '')).addTo(map);
  }
}
function setPoint(which,lat,lon,label) {
  closeSearch(which); cancelPending();
  points[which]={lat:+lat,lon:+lon,label:label || `${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}`};
  $(which).value=points[which].label;
  picking=null; renderPointMarkers(); syncLayout(); saveTrip();
}
function pickPoint(which) {
  currentDetail=null; picking=which; showScreen('map',{record:false}); syncLayout(); recordNavigation();
}
function cancelPick() { picking=null; showScreen('edit',{replace:true}); }
$('pick-origin').onclick=()=>pickPoint('origin');
$('pick-destination').onclick=()=>pickPoint('destination');
document.querySelectorAll('[data-pick]').forEach(button=>button.onclick=()=>pickPoint(button.dataset.pick));
$('cancel-pick').onclick=cancelPick;
map.on('click',event=>{
  // Browsing, panning and inspecting a route can never change its endpoints.
  if (!picking) { if (currentDetail) closeDetail(); return; }
  const which=picking; setPoint(which,event.latlng.lat,event.latlng.lng);
  showScreen('edit',{replace:true}); $(which).focus({preventScroll:true});
});
function coordinates(value) {
  if (!/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return null;
  const pair=value.split(',').map(Number);
  return validPoint({lat:pair[0],lon:pair[1]}) ? pair : null;
}
async function searchPlace(which) {
  const query=$(which).value.trim(), pair=coordinates(query);
  if (pair) { setPoint(which,...pair); map.setView(pair,16); return; }
  if (query.length < 2) { $('message').textContent='Enter at least two characters of an address or place name.'; return; }
  closeSearch(which);
  const controller=new AbortController(); searches[which]=controller;
  const results=$(`${which}-results`); results.replaceChildren(el('p','Finding your place…')); results.hidden=false;
  try {
    const response=await fetch(`/api/places?q=${encodeURIComponent(query)}`,{signal:controller.signal});
    const data=await response.json();
    if (searches[which] !== controller) return;
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not find that place.');
    results.replaceChildren();
    if (!data.results.length) results.append(el('p','No matches near Munich. Try another address or pick a point on the map.'));
    for (const place of data.results) {
      const button=el('button',place.label); button.type='button';
      button.onclick=()=>{ setPoint(which,place.lat,place.lon,place.label); map.setView([place.lat,place.lon],16); };
      results.append(button);
    }
  } catch (error) { if (!controller.signal.aborted) results.replaceChildren(el('p',error.message || 'Search unavailable. Pick a point on the map.')); }
  finally { if (searches[which] === controller) delete searches[which]; }
}
for (const id of ['origin','destination']) {
  const edited=()=>{ closeSearch(id); delete points[id]; cancelPending(); renderPointMarkers(); syncClearButtons(); queueSave(); };
  $(id).addEventListener('input',edited);
  $(`clear-${id}`).onclick=()=>{ $(id).value=''; edited(); saveTrip(); $(id).focus({preventScroll:true}); };
  $(id).addEventListener('keydown',event=>{
    if (event.key === 'Enter') { event.preventDefault(); searchPlace(id); }
    if (event.key === 'Escape') closeSearch(id);
  });
  $(id).addEventListener('change',()=>{ const pair=coordinates($(id).value); if (pair) setPoint(id,...pair); saveTrip(); });
  $(`search-${id}`).onclick=()=>searchPlace(id);
}
for (const id of ['departure','max-walk','max-bike']) $(id).onchange=()=>{ cancelPending(); saveTrip(); };
$('swap').onclick=()=>{
  if (!points.origin || !points.destination) return;
  const a={...points.origin}, b={...points.destination}; setPoint('origin',b.lat,b.lon,b.label); setPoint('destination',a.lat,a.lon,a.label);
};
$('example').onclick=()=>{
  setPoint('origin',48.1618,11.5869,'Münchner Freiheit'); setPoint('destination',48.123,11.521,'Westpark');
  $('departure').value=deviceNow(); map.fitBounds([[48.1618,11.5869],[48.123,11.521]],{padding:[55,55]});
  $('message').textContent='Münchner Freiheit → Westpark. Ready to find a route.'; saveTrip();
};
$('locate').onclick=()=>{
  if (!navigator.geolocation) { $('message').textContent='Location unavailable. Pick a point on the map.'; return; }
  navigator.geolocation.getCurrentPosition(position=>{
    setPoint('origin',position.coords.latitude,position.coords.longitude,'My location'); map.setView([position.coords.latitude,position.coords.longitude],15);
  },()=>{ $('message').textContent='Could not get your location. Pick a point on the map.'; });
};

function updateSavedButtons() {
  savedPlacesLayer.clearLayers();
  for (const [kind,place] of Object.entries(savedPlaces)) {
    if (!['home','work'].includes(kind) || !validPoint(place)) continue;
    L.marker([place.lat,place.lon],{icon:L.divIcon({className:'savedplace-icon',html:kind === 'home' ? '⌂' : '▣',iconSize:[24,24]}),title:`${kind === 'home' ? 'Home' : 'Work'} · ${place.label}`})
      .bindTooltip(()=>el('span',place.label)).on('click',()=>openDetail({kind:'place',point:place,title:place.label})).addTo(savedPlacesLayer);
  }
  document.querySelectorAll('[data-use]').forEach(button=>{
    const place=savedPlaces[button.dataset.use]; button.title=place?.label || 'No saved place yet'; button.classList.toggle('is-saved',!!place);
  });
}
document.querySelectorAll('[data-save]').forEach(button=>button.onclick=()=>{
  saveField=button.dataset.save;
  if (!points[saveField]) { $('message').textContent='Choose a search result or a map point before saving it.'; return; }
  $('save-label').textContent=points[saveField].label; $('save-error').textContent=''; $('save-dialog').showModal();
});
document.querySelectorAll('[data-use]').forEach(button=>button.onclick=()=>{
  const place=savedPlaces[button.dataset.use];
  if (!validPoint(place)) { $('message').textContent='Choose a place and tap Save place… to set up this shortcut.'; return; }
  setPoint(button.dataset.field,place.lat,place.lon,place.label); map.setView([place.lat,place.lon],15);
});
function storePlaces(next) {
  try { storage.setItem('mvgogo.places',JSON.stringify(next)); savedPlaces=next; updateSavedButtons(); return true; }
  catch { $('save-error').textContent='Your browser could not save this place.'; return false; }
}
$('save-form').addEventListener('submit',event=>{
  if (event.submitter?.value !== 'save') return; event.preventDefault();
  if (storePlaces({...savedPlaces,[$('save-kind').value]:{...points[saveField]}})) { $('save-dialog').close(); $('message').textContent='Place saved in this browser.'; }
});
$('delete-place').onclick=()=>{ const next={...savedPlaces}; delete next[$('save-kind').value]; if (storePlaces(next)) $('save-dialog').close(); };
updateSavedButtons();

function mapsLink(point,text='Navigate in Google Maps ↗',navigate=true) {
  const link=el('a',text,'maps-link'); link.href=googleMapsURL(point,navigate); link.target='_blank'; link.rel='noopener noreferrer';
  link.onclick=saveTrip; return link;
}
function isFresh(properties) {
  const now=Date.now()/1000;
  return properties.fresh && [properties.reported_at,stationData?.meta.status_updated_at]
    .every(t=>Number.isFinite(t) && now-t <= stationData.meta.max_age_seconds && now-t >= -60);
}
function stationFocusId() { return currentDetail?.stationId || (currentDetail?.kind === 'station' ? currentDetail.id : null); }
function stationFocusChanged() {
  areaLayer.clearLayers();
  const feature=stationData?.features.find(f=>f.properties.id === stationFocusId());
  if (feature?.properties.area) L.geoJSON(feature.properties.area,{style:{color:'#26814f',weight:2,fillOpacity:.12},interactive:false}).addTo(areaLayer);
  applyStationEmphasis();
}
function detailContent(detail) {
  const feature=stationData?.features.find(f=>f.properties.id === stationFocusId());
  const p=feature?.properties, point=detail.point;
  const content=el('div',undefined,'station-card');
  content.append(el('div',p ? 'MYRADL · STATION' : detail.kind === 'waypoint' ? 'ROUTE STOP' : 'PLACE','station-eyebrow'));
  content.append(el('h2',p?.name || detail.title || point.name || point.label || 'Selected place'));
  if (detail.subtitle) content.append(el('p',detail.subtitle,'place-subtitle'));
  content.append(mapsLink(point));
  if (p || detail.kind === 'station') {
    const fresh=p && isFresh(p), available=fresh && p.bikes > 0 && p.renting && p.installed;
    const status=el('div',undefined,`station-availability ${fresh ? available ? '' : 'closed' : 'unknown'}`);
    status.append(el('span',fresh ? String(p.bikes ?? '?') : '?','station-count'));
    const label=el('div'); label.append(el('strong',fresh ? 'bikes available' : 'Availability unknown'));
    label.append(el('small',fresh ? available ? 'Ready when you are' : p.renting && p.installed ? 'No bikes here right now' : 'Rentals are closed' : 'Check the operator app'));
    status.append(label); content.append(status);
    if (fresh) {
      const types=el('div',undefined,'station-types'); for (const type of p.by_type) types.append(el('span',`${type.name}: ${type.count}`));
      content.append(types,el('p',p.returning && p.installed ? 'Returns allowed at this station.' : 'Returns are currently closed.'));
      content.append(el('p',`Updated ${time(p.reported_at*1000)} · availability may change before you arrive.`,'station-updated'));
    }
  }
  const coordinateRow=el('div',undefined,'coordinate-row');
  coordinateRow.append(el('span',`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`),mapsLink(point,'View pin ↗',false)); content.append(coordinateRow);
  if (p?.rental_url && /^https:\/\/(nxtb\.it|app\.nextbike\.net)(\/|$)/.test(p.rental_url)) {
    const link=el('a','Open operator app ↗','station-operator'); link.href=p.rental_url; link.target='_blank'; link.rel='noopener noreferrer'; link.onclick=saveTrip; content.append(link);
  }
  const actions=el('div',undefined,'station-actions');
  for (const [which,text] of [['origin','Use as start'],['destination','Use as destination']]) {
    const button=el('button',text); button.type='button'; button.onclick=()=>{ currentDetail=null; setPoint(which,point.lat,point.lon,p?.name || detail.title || point.name); showScreen('edit'); panel.scrollTop=0; }; actions.append(button);
  }
  content.append(actions); return content;
}
function refreshDetail() {
  if (!currentDetail) return;
  const feature=stationData?.features.find(f=>f.properties.id === stationFocusId());
  const signature=JSON.stringify([currentDetail,feature?.properties,feature ? isFresh(feature.properties) : false]);
  if (signature !== detailSignature) {
    const scroll=$('station-sheet').scrollTop; $('station-sheet-content').replaceChildren(detailContent(currentDetail));
    $('station-sheet').scrollTop=scroll; detailSignature=signature;
  }
}
function openDetail(detail,record=true) {
  if (!validPoint(detail.point)) return;
  const replace=!!currentDetail; currentDetail=detail; picking=null; screen='map'; detailSignature='';
  refreshDetail(); stationFocusChanged(); syncLayout();
  if (record) recordNavigation(replace);
}
function closeDetail() {
  if (!currentDetail) return;
  if (navigation.current?.detail) navigation.back(()=>{ currentDetail=null; stationFocusChanged(); syncLayout(); recordNavigation(true); });
  else { currentDetail=null; stationFocusChanged(); syncLayout(); saveTrip(); }
}
$('close-station').onclick=closeDetail;
function applyStationEmphasis() {
  const focus=stationFocusId(), dim=!!selectedRoute || !!focus || loadingRoute;
  for (const {marker,id} of stationMarkerItems) {
    const relevant=!!id && (id === focus || routeStationIds.has(id));
    marker.setOpacity(dim && !relevant ? .35 : 1);
    marker.getElement()?.classList.toggle('selected',!!id && id === focus);
  }
}
function addStation(feature) {
  const p=feature.properties, fresh=isFresh(p), point=[...feature.geometry.coordinates].reverse();
  const available=fresh && p.bikes > 0 && p.renting && p.installed;
  const state=fresh ? available ? '' : 'empty' : 'unknown';
  const marker=L.marker(point,{pane:'stations',icon:L.divIcon({className:`station-icon ${state} ${routeStationIds.has(p.id) ? 'used' : ''}`,
    html:`<span>${fresh ? p.bikes ?? '?' : '?'}</span>`,iconSize:[44,44],iconAnchor:[22,22]}),title:`${p.name}: ${fresh ? p.bikes : 'availability unknown'}`});
  marker.on('click',()=>openDetail({kind:'station',id:p.id,title:p.name,point:{lat:point[0],lon:point[1]}}));
  stationMarkerItems.push({marker,id:p.id}); marker.addTo(stationsLayer);
}
function renderStations() {
  if (!stationData) return;
  refreshDetail();
  stationsLayer.clearLayers(); stationMarkerItems.length=0;
  const focus=stationFocusId(), visible=stationData.features.filter(f=>(routeStationIds.has(f.properties.id) || f.properties.id === focus || $('all-stations').checked)
    && map.getBounds().pad(.08).contains([...f.geometry.coordinates].reverse()));
  if (map.getZoom() >= 15) visible.forEach(addStation);
  else {
    const groups=new Map(), zoom=map.getZoom();
    for (const feature of visible) {
      if (routeStationIds.has(feature.properties.id) || feature.properties.id === focus) { addStation(feature); continue; }
      const pixel=map.project([...feature.geometry.coordinates].reverse(),zoom), key=`${Math.floor(pixel.x/70)},${Math.floor(pixel.y/70)}`;
      if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(feature);
    }
    for (const group of groups.values()) {
      if (group.length === 1) { addStation(group[0]); continue; }
      const lat=group.reduce((sum,f)=>sum+f.geometry.coordinates[1],0)/group.length;
      const lon=group.reduce((sum,f)=>sum+f.geometry.coordinates[0],0)/group.length;
      const marker=L.marker([lat,lon],{pane:'stations',icon:L.divIcon({className:'station-cluster',html:`<span>${group.length}</span>`,iconSize:[44,44],iconAnchor:[22,22]}),title:`${group.length} stations — zoom in`})
        .on('click',()=>map.setView([lat,lon],Math.min(16,zoom+2))).addTo(stationsLayer);
      stationMarkerItems.push({marker,id:null});
    }
  }
  const fresh=stationData.features.some(f=>isFresh(f.properties));
  $('feed-status').textContent=`${stationData.features.length} stations · ${fresh ? 'live availability' : 'availability unknown'}`;
  applyStationEmphasis();
}
map.on('zoomend moveend',()=>{ renderStations(); queueSave(); });
$('all-stations').onchange=()=>{ renderStations(); saveTrip(); };
function toggleLayers(open=$('station-legend').hidden) { $('station-legend').hidden=!open; $('map-layers').setAttribute('aria-expanded',String(open)); }
$('map-layers').onclick=()=>toggleLayers();
async function loadStations() {
  if (loadingStations) return; loadingStations=true;
  try {
    const response=await fetch('/api/stations',{signal:AbortSignal.timeout(25000)});
    if (!response.ok) throw new Error(); stationData=await response.json(); renderStations(); stationFocusChanged();
  } catch {
    if (stationData) { stationData.features.forEach(f=>{ f.properties.fresh=false; }); renderStations(); }
    else $('feed-status').textContent='Could not load stations. Try refreshing.';
  } finally { loadingStations=false; }
}
$('refresh').onclick=loadStations;
setInterval(()=>{ if (!document.hidden) loadStations(); },60000);
setInterval(()=>{ if (!document.hidden) { renderStations(); updateTripAge(); } },15000);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden) saveTrip(); else { updateTripAge(); renderStations(); loadStations(); }
});
window.addEventListener('pagehide',saveTrip);
window.addEventListener('pageshow',()=>{ updateTripAge(); syncLayout(); });
panel.addEventListener('scroll',queueSave,{passive:true});

function decodePolyline(encoded) {
  let i=0,lat=0,lon=0; const coordinates=[];
  while (i < encoded.length) {
    const read=()=>{ let value=0,shift=0,b; do { b=encoded.charCodeAt(i++)-63; value|=(b&31)<<shift; shift+=5; } while (b>=32 && i<encoded.length); return value&1 ? ~(value>>1) : value>>1; };
    lat+=read(); lon+=read(); coordinates.push([lat/1e5,lon/1e5]);
  }
  return coordinates;
}
function legColors(route) {
  const lines=new Map(),palette=['#2567a3','#8853a1','#237c80','#a34f70'];
  return route.legs.map(leg=>{
    if (leg.rentedBike) return '#946017'; if (!leg.transitLeg) return '#52675a';
    const key=leg.route?.gtfsId || leg.route?.shortName || leg.mode;
    if (!lines.has(key)) lines.set(key,palette[lines.size%palette.length]); return lines.get(key);
  });
}
function fitVisible(bounds,maxZoom=16) {
  if (!bounds.length) return;
  requestAnimationFrame(()=>{
    map.invalidateSize({pan:false});
    const height=map.getSize().y;
    const bottom=currentDetail ? Math.min($('station-sheet').offsetHeight+30,height*.6) : selectedRoute ? 100 : 60;
    map.fitBounds(bounds,{paddingTopLeft:[32,isMobile() ? 100 : 115],paddingBottomRight:[32,bottom],maxZoom,animate:false});
  });
}
function fitRoute() {
  focusedLeg=null;
  legLines.forEach((line,index)=>line?.setStyle({opacity:.96,weight:selectedRoute.legs[index].mode === 'WALK' ? 4 : 6}));
  document.querySelectorAll('.step-button,.route-key button').forEach(node=>node.classList.remove('active'));
  fitVisible(routeBounds); saveTrip();
}
$('fit-route').onclick=fitRoute;
function focusLeg(index,openMap=true) {
  if (!selectedRoute?.legs[index]) return;
  focusedLeg=index;
  selectedRoute.legs.forEach((leg,i)=>legLines[i]?.setStyle({opacity:i === index ? 1 : .25,weight:i === index ? 7 : 4}));
  document.querySelectorAll('.step-button').forEach((node,i)=>node.classList.toggle('active',i === index));
  $('route-key').querySelectorAll('button').forEach((node,i)=>node.classList.toggle('active',i === index));
  requestAnimationFrame(()=>{
    const chip=$('route-key').querySelector('.active');
    if (chip) $('route-key').scrollLeft=chip.offsetLeft-7;
  });
  if (openMap) showScreen('map');
  const leg=selectedRoute.legs[index],line=legLines[index];
  fitVisible(line ? line.getLatLngs() : [[leg.from.lat,leg.from.lon],[leg.to.lat,leg.to.lon]]); saveTrip();
}
function openEndpoint(index,which) {
  const leg=selectedRoute.legs[index],place=leg[which];
  showScreen('map');
  openDetail({kind:'waypoint',stationId:place.vehicleRentalStation?.stationId?.split(':').pop(),
    point:{lat:place.lat,lon:place.lon},title:placeName(place.name),
    subtitle:`${which === 'from' ? 'Start' : 'End'} of step ${index+1} · ${time(which === 'from' ? leg.startTime : leg.endTime)} · ${modeName(leg)}`});
  fitVisible([[place.lat,place.lon]]);
}
function drawRoute() {
  routeLayer.clearLayers(); waypointsLayer.clearLayers(); legLines=[]; routeBounds=[];
  routeStationIds=new Set(selectedRoute.legs.flatMap(leg=>[leg.from,leg.to]).map(p=>p.vehicleRentalStation?.stationId?.split(':').pop()).filter(Boolean));
  const colors=legColors(selectedRoute),key=$('route-key'); key.replaceChildren(); key.hidden=false;
  selectedRoute.legs.forEach((leg,index)=>{
    const line=leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [[leg.from.lat,leg.from.lon],[leg.to.lat,leg.to.lon]];
    routeBounds.push(...line);
    L.polyline(line,{pane:'route',color:'#fff',weight:9,opacity:.95,interactive:false}).addTo(routeLayer);
    legLines[index]=L.polyline(line,{pane:'route',color:colors[index],weight:leg.mode === 'WALK' ? 4 : 6,
      dashArray:leg.mode === 'WALK' ? '3 8' : null,opacity:.96,bubblingMouseEvents:false}).on('click',()=>focusLeg(index,false)).addTo(routeLayer);
    const chip=el('button',`${index+1} ${modeName(leg)}`); chip.type='button'; chip.style.setProperty('--leg-color',colors[index]); chip.onclick=()=>focusLeg(index); key.append(chip);
    const marker=(place,label,which)=>L.marker([place.lat,place.lon],{pane:'waypoints',icon:L.divIcon({className:'waypoint-icon',html:String(label),iconSize:[30,30],iconAnchor:[15,15]}),title:`${label} · ${placeName(place.name)}`})
      .on('click',()=>openEndpoint(index,which)).addTo(waypointsLayer);
    marker(leg.from,index+1,'from'); if (index === selectedRoute.legs.length-1) marker(leg.to,'B','to');
  });
  $('map-trip-title').textContent=kindName(selectedRoute);
  $('map-trip-time').textContent=`${minutes(selectedRoute.total_seconds)} min · arrive ${time(selectedRoute.end_time)}`;
  renderStations(); renderPointMarkers();
}
function modeBadges(route) {
  const badges=el('div',undefined,'route-modes'),colors=legColors(route);
  route.legs.forEach((leg,index)=>{
    if (leg.mode === 'WALK' && route.legs.some(item=>item.mode !== 'WALK')) return;
    if (leg.mode === 'WALK' && badges.children.length) return;
    const badge=el('span',modeName(leg)); badge.style.setProperty('--leg-color',colors[index]); badges.append(badge);
  }); return badges;
}
function renderJourneyDetails() {
  const route=selectedRoute,details=$('journey-details'); details.replaceChildren();
  const heading=el('div',undefined,'itinerary-heading');
  const title=el('div'); title.append(el('span','SELECTED ROUTE','eyebrow'),el('h2',kindName(route)));
  heading.append(title,el('strong',`${minutes(route.total_seconds)} min`)); details.append(heading);
  details.append(el('p',`${time(route.start_time)} start → ${time(route.end_time)} arrival · Munich time`,'itinerary-time'));
  if (route.initial_wait_seconds >= 60) details.append(el('p',`Includes ${durationText(route.initial_wait_seconds)} before the first leg starts.`,'initial-wait'));
  const metrics=el('dl',undefined,'trip-metrics');
  for (const [label,value] of [['Walk',`${minutes(route.walk_seconds)} min`],['Bike',`${minutes(route.bike_seconds)} min`],['Wait',`${minutes(route.waiting_seconds)} min`],['Transfers',String(route.transfers)]]) {
    const item=el('div'); item.append(el('dt',label),el('dd',value)); metrics.append(item);
  }
  details.append(metrics);
  const overview=el('button','View full route on map ↗','route-show-map'); overview.type='button'; overview.onclick=()=>{ showScreen('map'); fitRoute(); }; details.append(overview);
  const timeline=el('ol',undefined,'timeline'),colors=legColors(route);
  route.legs.forEach((leg,index)=>{
    const row=el('li',undefined,'timeline-leg'),connection=route.connections?.find(c=>c.before_leg_index === index);
    if (connection) {
      const note=el('div',undefined,'connection-note'); note.append(el('strong',`Transfer · ${time(connection.alight_time)}–${time(connection.board_time)}`),
        el('span',`${durationText(connection.walk_seconds)} walk + ${durationText(connection.wait_seconds)} wait`)); row.append(note);
    } else if (leg.wait_before_seconds > 0) row.append(el('p',`Wait ${durationText(leg.wait_before_seconds)} · until ${time(leg.startTime)}`,'wait-row'));
    const step=el('button',undefined,'step-button'); step.type='button'; step.style.setProperty('--leg-color',colors[index]);
    const body=el('span',undefined,'step-body'); body.append(el('strong',`${modeName(leg)} · ${durationText(leg.duration)}`),el('span',`${time(leg.startTime)}–${time(leg.endTime)}`,'step-time'));
    if (leg.headsign && leg.transitLeg) body.append(el('span',`Towards ${leg.headsign}`,'step-direction'));
    body.append(el('span','Show this leg on map ↗','step-map-link'));
    step.append(el('span',String(index+1),'step-number'),body); step.onclick=()=>focusLeg(index); row.append(step);
    const stops=el('div',undefined,'step-stops');
    for (const which of ['from','to']) {
      const place=leg[which],stop=el('div',undefined,'stop-row');
      const label=which === 'from' ? leg.rentedBike ? 'Pick up bike' : leg.transitLeg ? 'Board here' : 'From' : leg.rentedBike ? 'Return bike' : leg.transitLeg ? 'Get off here' : 'To';
      const name=el('button',placeName(place.name),'stop-name'); name.type='button'; name.onclick=()=>openEndpoint(index,which);
      const link=mapsLink(place,'Google Maps ↗'); link.classList.add('stop-navigation'); link.setAttribute('aria-label',`Navigate to ${placeName(place.name)} in Google Maps`);
      stop.append(el('span',label,'stop-label'),name,link); stops.append(stop);
    }
    row.append(stops); timeline.append(row);
  });
  details.append(timeline);
  for (const warning of route.warnings) details.append(el('p',warning,'warning'));
  details.append(el('p','Scheduled MVV times. Live delays are not included. Bike availability may change.','route-note'));
  details.append(el('p','Rental cycling is checked before or after transit. Cycling between two transit journeys is not supported yet.','route-note'));
}
function selectRoute(index,{fit=true,scroll=true,save=true}={}) {
  selectedIndex=index; selectedRoute=resultsData.routes[index]; focusedLeg=null;
  $('route-options').querySelectorAll('.route-select').forEach((button,i)=>{
    button.setAttribute('aria-pressed',String(i === index)); button.parentElement.classList.toggle('selected',i === index);
  });
  requestAnimationFrame(()=>{
    const options=$('route-options'),card=options.children[index];
    if (card) options.scrollLeft=card.offsetLeft-options.offsetLeft;
  });
  renderJourneyDetails(); drawRoute(); syncLayout(); updateTripAge();
  if (fit && (!isMobile() || screen === 'map')) fitRoute();
  if (scroll) panel.scrollTop=0;
  if (save) saveTrip();
}
function renderRoutes(data,index=0) {
  resultsData=data; $('results').replaceChildren();
  const options=el('div',undefined,'route-options'); options.id='route-options'; options.setAttribute('role','group'); options.setAttribute('aria-label','Route alternatives');
  data.routes.forEach((route,i)=>{
    const card=el('article',undefined,'route-card'),button=el('button',undefined,'route-select'); button.type='button';
    const top=el('div',undefined,'route-top'); top.append(el('strong',`${minutes(route.total_seconds)} min`));
    if (route.kind !== 'transit' && route.saved_seconds >= 60) top.append(el('span',`−${Math.floor(route.saved_seconds/60)} min`,'badge'));
    button.append(top,el('div',kindName(route),'route-kind'),el('div',`Arrive ${time(route.end_time)} · ${route.transfers} transfers`,'route-times'),modeBadges(route));
    button.onclick=()=>selectRoute(i); card.append(button); options.append(card);
  });
  $('results').append(options,el('p',`${data.routes.length} options · swipe to compare · scheduled times`,'options-hint'));
  for (const warning of data.warnings.filter(w=>w.includes('Some route options'))) $('results').append(el('p',warning,'warning'));
  const details=el('article',undefined,'journey-details'); details.id='journey-details'; $('results').append(details);
  $('journey-title').replaceChildren(el('span',plannedPoints?.origin?.label || 'Start'),el('span',' → ','journey-arrow'),el('span',plannedPoints?.destination?.label || 'Destination'));
  selectRoute(index,{scroll:false,save:false});
}
function updateTripAge() {
  if (!resultsData || !calculatedAt) return;
  $('calculated-at').textContent=`Calculated ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(calculatedAt)}`;
  const passed=selectedRoute?.end_time < Date.now(),old=Date.now()-calculatedAt > 5*60000;
  $('trip-age').hidden=!passed && !old;
  $('trip-age').textContent=passed ? 'This saved trip has already ended. Refresh routes to plan a new departure.' : 'Saved itinerary. Refresh before travelling if your departure has changed.';
}
async function planTrip(event) {
  event?.preventDefault();
  if (!points.origin || !points.destination) { $('message').textContent='Choose a search result for both points or pick them on the map.'; return; }
  cancelPending(); const revision=tripRevision,controller=new AbortController(); routeController=controller;
  let timedOut=false; const timeout=setTimeout(()=>{ timedOut=true; controller.abort(); },55000);
  const requestedPoints=clone(points),requestedForm=formValues();
  loadingRoute=true; routingNotice=true; $('submit').disabled=true; $('refresh-trip').disabled=true;
  $('message').hidden=false; $('message').textContent=resultsData ? 'Comparing routes. Your saved trip is still available.' : 'Finding your best connection…'; applyStationEmphasis(); saveTrip();
  try {
    const response=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({origin:{lat:points.origin.lat,lon:points.origin.lon},destination:{lat:points.destination.lat,lon:points.destination.lon},
        departure:new Date($('departure').value).toISOString(),max_walk_minutes:+$('max-walk').value,max_bike_minutes:+$('max-bike').value})});
    const data=await response.json();
    if (revision !== tripRevision) return;
    if (!response.ok) { $('message').textContent=typeof data.detail === 'string' ? data.detail : 'Could not calculate a route. Your saved trip is still available.'; return; }
    if (!data.routes.length) { $('message').textContent='No routes found. Allow more walking or try different points. Your previous trip is kept.'; return; }
    plannedPoints=requestedPoints; plannedForm=requestedForm; calculatedAt=Date.now(); currentDetail=null; picking=null;
    routingNotice=false; screen='trip'; renderRoutes(data); showScreen('trip'); panel.scrollTop=0; saveTrip();
  } catch {
    if (revision === tripRevision && (!controller.signal.aborted || timedOut)) $('message').textContent='Routing is unavailable or took too long. Your saved trip is still available.';
  } finally {
    clearTimeout(timeout);
    if (routeController === controller) {
      loadingRoute=false; $('submit').disabled=false; $('refresh-trip').disabled=false; routeController=null; applyStationEmphasis(); syncLayout();
    }
  }
}
$('trip-form').onsubmit=planTrip;
$('refresh-trip').onclick=()=>{
  Object.assign(points,clone(plannedPoints)); fillForm(plannedForm); $('departure').value=deviceNow(); planTrip();
};

// Restore a saved itinerary locally; resuming never silently recalculates it.
if (saved) {
  fillForm(saved.form); Object.assign(points,saved.points);
  plannedPoints=saved.plannedPoints; plannedForm=saved.plannedForm; calculatedAt=saved.calculatedAt;
  screen=saved.screen; scrollToRestore=saved.scrollTop;
  if (saved.results) {
    renderRoutes(saved.results,saved.selectedIndex);
    if (saved.legIndex !== null) focusLeg(saved.legIndex,false);
  } else screen='edit';
  if (saved.map) map.setView([saved.map.lat,saved.map.lon],saved.map.zoom,{animate:false});
  $('all-stations').checked=saved.allStations !== false;
  if (saved.detail && validPoint(saved.detail.point) && screen === 'map') openDetail(saved.detail,false);
  $('message').textContent='Your trip draft was restored.';
}
renderPointMarkers(); showScreen(screen,{record:false});
navigation.start(navState(),!!resultsData);
restoring=false;
requestAnimationFrame(()=>{ panel.scrollTop=scrollToRestore; saveTrip(); });
loadStations();
fetch('/api/sources').then(response=>response.json()).then(data=>{
  if (data.mvv_retrieved_at) $('mvv-date').textContent=`Retrieved ${new Date(data.mvv_retrieved_at).toLocaleDateString('en-GB',{timeZone:'Europe/Berlin'})}.`;
}).catch(()=>{});
