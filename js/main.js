import {Tracker} from './tracker.js';
import {UI} from './ui.js';
import {now, bearingToText} from './utils.js';
import {PoseHelper} from './pose.js';
import {DriftEstimator} from './flow.js';
import {DemoSource} from './demo.js';

const video=document.getElementById('video');
const canvas=document.getElementById('overlay');
const mapCanvas=document.getElementById('mapCanvas');
const ui=new UI(canvas,mapCanvas);
const fsBtn=document.getElementById('fsBtn');
const menuToggle=document.getElementById('menuToggle');
const mapToggle=document.getElementById('mapToggle');
const dropdown=document.getElementById('dropdown');
const guide=document.getElementById('guide'); const guideClose=document.getElementById('guideClose'); const guideTitle=document.getElementById('guideTitle'); const guideMeta=document.getElementById('guideMeta'); const gpsMeta=document.getElementById('gpsMeta'); const arrow=document.getElementById('arrow');

// Controls
const sourceSelect=document.getElementById('sourceSelect'); const cameraSelect=document.getElementById('cameraSelect');
const seaState=document.getElementById('seaState'); const confThreshold=document.getElementById('confThreshold');
const preAlertSec=document.getElementById('preAlertSec'); const alertSec=document.getElementById('alertSec');
const ensembleStrict=document.getElementById('ensembleStrict'); const useMoveNet=document.getElementById('useMoveNet');
const demoInterval=document.getElementById('demoInterval'); const demoDisappearSec=document.getElementById('demoDisappearSec'); const demoRealism=document.getElementById('demoRealism');
const runState=document.getElementById('runState'); const fpsEl=document.getElementById('fps'); const alarmCountEl=document.getElementById('alarmCount'); const driftVecEl=document.getElementById('driftVec');
const startBtn=document.getElementById('startBtn'); const stopBtn=document.getElementById('stopBtn'); const roiBtn=document.getElementById('roiBtn'); const clearRoiBtn=document.getElementById('clearRoiBtn');

let detector=null; let poseHelper=new PoseHelper(); let running=false; let tracker=new Tracker(); let lastFpsT=now(); let frames=0; let stream=null; let drift=new DriftEstimator(); let demo=null; let demoRAF=0; window._lastAlert=null;

// Audio alarm
let audioCtx=null, osc=null, gain=null;
function startAlarmTone(){ try{ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(osc) return; osc=audioCtx.createOscillator(); gain=audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination); osc.type='square'; osc.frequency.setValueAtTime(880,audioCtx.currentTime); gain.gain.setValueAtTime(0.0001,audioCtx.currentTime); osc.start(); const schedule=()=>{ if(!osc) return; gain.gain.cancelScheduledValues(audioCtx.currentTime); gain.gain.setValueAtTime(0.0001,audioCtx.currentTime); for(let i=0;i<4;i++){ const on=audioCtx.currentTime+i*0.25; gain.gain.exponentialRampToValueAtTime(0.2,on+0.02); gain.gain.exponentialRampToValueAtTime(0.0001,on+0.15);} setTimeout(schedule,1000); }; schedule(); }catch{} }
function stopAlarmTone(){ if(osc){ try{osc.stop();}catch{} osc.disconnect(); gain.disconnect(); osc=null; gain=null; } }
function vibrateAlert(){ if(navigator.vibrate){ navigator.vibrate([200,100,200,400,200,100,200]); } }

if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
menuToggle.addEventListener('click',()=> dropdown.classList.toggle('open'));
mapToggle.addEventListener('click',()=> ui.setMapVisible(!ui.showMap));
fsBtn.addEventListener('click', async ()=>{ try{ if(document.fullscreenElement){ await document.exitFullscreen(); return; } await document.documentElement.requestFullscreen(); }catch{} });
guideClose.addEventListener('click',()=>{ guide.style.display='none'; document.getElementById('stage').classList.remove('flash'); stopAlarmTone(); });

// GPS + Compass
let currentGPS={lat:null,lon:null,accuracy:null}; let compassDeg=null;
function startGPS(){ if(!navigator.geolocation) return; navigator.geolocation.watchPosition((pos)=>{ currentGPS.lat=pos.coords.latitude; currentGPS.lon=pos.coords.longitude; currentGPS.accuracy=pos.coords.accuracy; },()=>{}, {enableHighAccuracy:true, maximumAge:2000, timeout:10000}); }
function startCompass(){ const handler=(e)=>{ compassDeg = e.webkitCompassHeading ?? (360-(e.alpha||0)); };
  if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'){ DeviceOrientationEvent.requestPermission().then(s=>{ if(s==='granted') window.addEventListener('deviceorientation', handler); }).catch(()=>{}); }
  else { window.addEventListener('deviceorientation', handler); } }

async function startCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  const val=cameraSelect.value; let constraints;
  if(val==='env'||val==='user'){ constraints={audio:false, video:{facingMode:(val==='env'?'environment':'user'), width:{ideal:1280}, height:{ideal:720}}}; }
  else { constraints={audio:false, video:{deviceId:{exact:val}, width:{ideal:1280}, height:{ideal:720}}}; }
  stream=await navigator.mediaDevices.getUserMedia(constraints); video.srcObject=stream; await video.play(); canvas.width=canvas.clientWidth; canvas.height=canvas.clientHeight; }

function startDemo(){ if(stream){ try{stream.getTracks().forEach(t=>t.stop());}catch{} stream=null; }
  const iv=parseInt(demoInterval.value,10)||12; const dur=parseInt(demoDisappearSec.value,10)||8; const realism=parseFloat(demoRealism.value)||0.7;
  demo=new DemoSource(1280,720,iv,dur,realism); const demoStream=demo.getStream(30); video.srcObject=demoStream; video.play();
  const step=()=>{ if(!running) return; demo.step(1/30); demoRAF=requestAnimationFrame(step); }; step(); }

async function loadModels(){ if(!detector) detector=await cocoSsd.load({base:'lite_mobilenet_v2'}); }

function getFrameDims(){ return {vw: video.videoWidth||1280, vh: video.videoHeight||720}; }

async function detectionLoop(){ if(!running) return; await loadModels(); const {vw,vh}=getFrameDims();
  const preds=await detector.detect(video); const conf=parseFloat(confThreshold.value);
  const people=preds.filter(p=>p.class==='person' && p.score>=conf).map(p=>({x:p.bbox[0], y:p.bbox[1], w:p.bbox[2], h:p.bbox[3], score:p.score}));
  tracker.setParams({ preAlertSec: parseFloat(preAlertSec.value), alertSec: parseFloat(alertSec.value), roi:null, seaState: parseInt(seaState.value,10), ensembleStrict: ensembleStrict.checked });
  tracker.update(people,new Map(),vw,vh);
  for(const ev of tracker.consumeEvents()){
    if(ev.type==='prealert'){ document.getElementById('hud').style.display='flex'; document.getElementById('hud').style.background='#ffa502'; document.getElementById('hud').textContent='PRE-ALLERTA'; setTimeout(()=>{ if(document.getElementById('hud').style.background!=='#ff4757') document.getElementById('hud').style.display='none'; }, 2500); }
    if(ev.type==='alert'){ if(ev.last){ window._lastAlert={t: performance.now()/1000, last: ev.last.c}; } ui.setMapVisible(true); document.getElementById('stage').classList.add('flash'); startAlarmTone(); vibrateAlert(); guide.style.display='flex'; guideTitle.textContent='ALLERTA'; }
  }
  const dv=(new DriftEstimator()).estimate(video,null); driftVecEl.innerText=`${dv.vx.toFixed(1)}, ${dv.vy.toFixed(1)}`;
  if(window._lastAlert){ const age=performance.now()/1000 - window._lastAlert.t; const gain=4; const est={x:window._lastAlert.last.cx + dv.vx*gain*age, y: window._lastAlert.last.cy + dv.vy*gain*age}; ui.updateTargets({c:window._lastAlert.last}, est);
    const ang=Math.atan2(dv.vy, dv.vx); arrow.setAttribute('transform', `rotate(${ang*180/Math.PI},100,100)`);
    const meters=Math.max(0, Math.hypot(est.x-window._lastAlert.last.cx, est.y-window._lastAlert.last.cy)/30); guideMeta.textContent=`${age.toFixed(1)} s · ${meters.toFixed(1)} m stimati`;
    const compText = compassDeg==null ? '--' : bearingToText(compassDeg); if(currentGPS.lat!=null){ gpsMeta.textContent=`GPS: ${currentGPS.lat.toFixed(5)}, ${currentGPS.lon.toFixed(5)} (±${currentGPS.accuracy?Math.round(currentGPS.accuracy):'--'}m) · Bussola: ${compText}`; } else { gpsMeta.textContent=`GPS: -- · Bussola: ${compText}`; }
  } else { ui.updateTargets(null,null); }
  const snapshot=tracker.getSnapshot(); alarmCountEl.innerText=String(snapshot.filter(s=>s.state==='ALERT').length); ui.draw(vw,vh,snapshot,0); requestAnimationFrame(detectionLoop); }

startBtn.addEventListener('click', async ()=>{ try{ if(sourceSelect.value==='camera'){ await startCamera(); } else { startDemo(); } running=true; runState.innerText='in esecuzione'; dropdown.classList.remove('open'); try{ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); const n=audioCtx.createOscillator(); const g=audioCtx.createGain(); n.connect(g); g.connect(audioCtx.destination); n.start(); n.stop(); } }catch{} startGPS(); startCompass(); detectionLoop(); }catch(e){ alert('Errore: '+e.message); console.error(e); running=false; runState.innerText='errore'; } });
stopBtn.addEventListener('click',()=>{ running=false; runState.innerText='inattivo'; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if(demoRAF) cancelAnimationFrame(demoRAF); document.getElementById('stage').classList.remove('flash'); stopAlarmTone(); guide.style.display='none'; window._lastAlert=null; });
roiBtn.addEventListener('click',()=> ui.beginDrawROI()); clearRoiBtn.addEventListener('click',()=> ui.cancelROI()); ui.attachInteraction();
