import test from 'node:test';
import assert from 'node:assert/strict';
import {AppHistory, SESSION_KEY, backDestination, decodeSession, googleMapsURL, readSession, writeSession} from '../../mvgogo/static/trip-state.mjs';

const place = {name: 'Public stop', lat: 48.1, lon: 11.5};
const route = {kind:'mixed', start_time:1000, end_time:2000, total_seconds:1, walk_seconds:0, bike_seconds:1, transfers:0,
  warnings:[], connections:[], legs:[{from:place, to:place, mode:'BICYCLE', rentedBike:true, startTime:1000, endTime:2000, duration:1}]};
const session = () => ({version:1, savedAt:1, form:{origin:'A', destination:'B', departure:'2026-10-23T19:00', maxWalk:'30', maxBike:'30'},
  points:{origin:place,destination:place}, plannedPoints:{origin:place,destination:place},
  plannedForm:{origin:'A',destination:'B',departure:'2026-10-23T19:00',maxWalk:'30',maxBike:'30'}, calculatedAt:1000, results:{routes:[route],warnings:[]},
  screen:'map', selectedIndex:0, legIndex:0, scrollTop:520, map:{lat:48.1,lon:11.5,zoom:15}});

test('the full itinerary, selection, map and scroll survive a new storage reader', () => {
  const data = new Map(); const storage = {getItem:key=>data.get(key), setItem:(key,value)=>data.set(key,value)};
  assert.equal(writeSession(storage, session()), true);
  const restored = readSession(storage);
  assert.deepEqual(restored.results, session().results);
  assert.equal(restored.screen, 'map'); assert.equal(restored.legIndex, 0); assert.equal(restored.scrollTop, 520);
  assert.ok(data.has(SESSION_KEY));
});
test('unavailable storage is reported without breaking the live trip', () => {
  const storage = {getItem(){throw new Error('blocked');}, setItem(){throw new Error('quota');}};
  assert.equal(readSession(storage), null); assert.equal(writeSession(storage, session()), false);
});
test('corrupt, oversized and incompatible caches are ignored', () => {
  for (const raw of ['{', 'null', JSON.stringify({...session(),version:9}), ' '.repeat(3_000_001)]) assert.equal(decodeSession(raw), null);
  const broken=session(); broken.results.routes[0]={...route,legs:[{from:place,to:{lat:500,lon:11.5},mode:'WALK'}]};
  assert.equal(decodeSession(JSON.stringify(broken)), null);
});
test('invalid selection and viewport fall back without losing the trip', () => {
  const decoded=decodeSession(JSON.stringify({...session(),selectedIndex:999,legIndex:999,map:{lat:400,lon:2,zoom:12}}));
  assert.equal(decoded.selectedIndex,0); assert.equal(decoded.legIndex,null); assert.equal(decoded.map,undefined);
});
test('malformed warnings, timestamps and incomplete committed forms cannot break restoration', () => {
  const cases=[
    {...session(),calculatedAt:1e30},
    {...session(),plannedForm:null},
    {...session(),results:{routes:[route],warnings:[null]}},
    {...session(),results:{routes:[{...route,start_time:1e30}],warnings:[]}},
  ];
  for (const value of cases) assert.equal(decodeSession(JSON.stringify(value)),null);
});
test('Google Maps links use exact coordinates and walking navigation', () => {
  const link = new URL(googleMapsURL(place,true));
  assert.equal(link.origin,'https://www.google.com'); assert.equal(link.searchParams.get('destination'),'48.1,11.5');
  assert.equal(link.searchParams.get('dir_action'),'navigate'); assert.equal(link.searchParams.get('travelmode'),'walking');
  assert.equal(new URL(googleMapsURL(place)).searchParams.get('query'),'48.1,11.5');
  assert.equal(googleMapsURL({lat:NaN,lon:11}), null);
});
function browserHistory() {
  const values=[null]; let index=0;
  return {get state(){return values[index];}, get length(){return values.length;},
    replaceState(value){values[index]=value;}, pushState(value){values.splice(++index);values.push(value);},
    back(){if(index)index--;}};
}
test('Android-style Back unwinds station → map → trip without deleting itinerary state', () => {
  const history=browserHistory(); const applied=[]; const nav=new AppHistory(history,state=>applied.push(state));
  nav.start({screen:'edit'},false); nav.navigate({screen:'trip'}); nav.navigate({screen:'map'});
  nav.navigate({screen:'map',detail:{kind:'station',id:'123'}});
  nav.back(()=>assert.fail('should use browser history')); nav.pop(history.state); assert.equal(applied.at(-1).screen,'map'); assert.equal(applied.at(-1).detail,null);
  nav.back(()=>assert.fail('should use browser history')); nav.pop(history.state); assert.equal(applied.at(-1).screen,'trip');
});
test('restoring or reloading a trip does not grow history indefinitely or trap exit', () => {
  const history=browserHistory(); const nav=new AppHistory(history,()=>{});
  nav.start({screen:'map'},true); assert.equal(history.length,2);
  new AppHistory(history,()=>{}).start({screen:'map'},true); assert.equal(history.length,2);
  nav.back(()=>assert.fail()); nav.pop(history.state);
  let fallback=false; nav.back(()=>{fallback=true;}); assert.equal(fallback,true);
});
test('a reopened station has Back layers for its map and saved trip', () => {
  const history=browserHistory(),applied=[];
  const nav=new AppHistory(history,value=>applied.push(value));
  nav.start({screen:'map',detail:{kind:'station',id:'123'}},true);
  assert.equal(history.length,3);
  nav.back(()=>assert.fail()); nav.pop(history.state);
  assert.equal(applied.at(-1).screen,'map'); assert.equal(applied.at(-1).detail,null);
  nav.back(()=>assert.fail()); nav.pop(history.state);
  assert.equal(applied.at(-1).screen,'trip');
});
test('the in-app Back arrow opens the planner from a restored root trip', () => {
  const history=browserHistory(),nav=new AppHistory(history,()=>{});
  nav.start({screen:'trip'},true);
  assert.equal(nav.current.depth,0);
  nav.navigate({screen:backDestination(nav.current.screen,true)});
  assert.equal(nav.current.screen,'edit');
  assert.equal(backDestination('edit',true),'trip');
});
test('the map Back arrow returns to its parent rather than revisiting the previous map', () => {
  assert.equal(backDestination('map',true),'trip');
  assert.equal(backDestination('map',false),'edit');
  assert.equal(backDestination('edit',false),'edit');
});
