import {rgba} from './utils.js';
export class UI{
  constructor(canvas,mapCanvas){ this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.mapCanvas=mapCanvas; this.mapCtx=mapCanvas.getContext('2d'); this.showMap=false; this.roi=null; this._drawing=false; this._points=[]; this.drift={vx:0,vy:0,mag:0}; this.hud=document.getElementById('hud'); this.lastSeen=null; this.estimated=null; }
  beginDrawROI(){ this._drawing=true; this._points=[]; this.roi=null; }
  cancelROI(){ this._drawing=false; this._points=[]; this.roi=null; }
  attachInteraction(){ const cnv=this.canvas; const getRel=(e)=>{ const r=cnv.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width; const y=(e.clientY-r.top)/r.height; return {x:Math.max(0,Math.min(1,x)), y:Math.max(0,Math.min(1,y))}; };
    cnv.addEventListener('click',(e)=>{ if(!this._drawing) return; this._points.push(getRel(e)); });
    cnv.addEventListener('dblclick',(e)=>{ if(!this._drawing) return; if(this._points.length>=3){ this.roi=this._points.slice(); this._drawing=false; }});
  }
  setMapVisible(v){ this.showMap=v; this.mapCanvas.style.display=v?'block':'none'; const leg=document.getElementById('mapLegend'); if(leg) leg.style.display=v?'block':'none'; }
  updateTargets(last,est){ this.lastSeen=last; this.estimated=est; }
  showAlertHUD(text){ this.hud.textContent=text; this.hud.style.display='flex'; clearTimeout(this._hudTO); this._hudTO=setTimeout(()=> this.hud.style.display='none', 6000); }
  draw(frameW,frameH,tracks,fps){ const ctx=this.ctx; const w=this.canvas.width=this.canvas.clientWidth; const h=this.canvas.height=this.canvas.clientHeight; ctx.clearRect(0,0,w,h);
    if(this.roi && this.roi.length>=3){ ctx.save(); ctx.beginPath(); const p0=this.roi[0]; ctx.moveTo(p0.x*w,p0.y*h); for(let i=1;i<this.roi.length;i++){ const p=this.roi[i]; ctx.lineTo(p.x*w,p.y*h);} ctx.closePath(); ctx.fillStyle=rgba(30,144,255,0.15); ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle=rgba(30,144,255,0.9); ctx.stroke(); ctx.restore(); }
    for(const tr of tracks){ const bb=tr.bbox; if(!bb) continue; const x=bb.x/frameW*w, y=bb.y/frameH*h; const wd=bb.w/frameW*w, ht=bb.h/frameH*h; let color=[46,213,115]; if(tr.state==='PREALERT'||tr.state==='LOST_SHORT') color=[255,165,2]; if(tr.state==='ALERT') color=[255,71,87]; ctx.save(); ctx.lineWidth=2; ctx.strokeStyle=rgba(color[0],color[1],color[2],0.95); ctx.strokeRect(x,y,wd,ht); ctx.restore(); }
    const m=this.mapCanvas; const mx=m.getBoundingClientRect().width; const my=m.getBoundingClientRect().height; m.width=mx; m.height=my; const mctx=this.mapCtx; mctx.clearRect(0,0,mx,my);
    if(this.showMap){ mctx.fillStyle='#02253b'; mctx.fillRect(0,0,mx,my); mctx.strokeStyle='#1b4a74'; mctx.strokeRect(0,0,mx,my);
      mctx.strokeStyle='rgba(255,255,255,0.1)'; for(let i=1;i<6;i++){ mctx.beginPath(); mctx.moveTo(i*mx/6,0); mctx.lineTo(i*mx/6,my); mctx.stroke(); mctx.beginPath(); mctx.moveTo(0,i*my/4); mctx.lineTo(mx,i*my/4); mctx.stroke(); }
      if(this.lastSeen){ const x=this.lastSeen.c.cx/frameW*mx; const y=this.lastSeen.c.cy/frameH*my; mctx.fillStyle='#ffffff'; mctx.beginPath(); mctx.arc(x,y,4,0,Math.PI*2); mctx.fill(); if(this.estimated){ mctx.fillStyle='#ff4757'; mctx.beginPath(); mctx.arc(this.estimated.x/frameW*mx,this.estimated.y/frameH*my,4,0,Math.PI*2); mctx.fill(); mctx.strokeStyle='rgba(255,255,255,0.6)'; mctx.beginPath(); mctx.moveTo(x,y); mctx.lineTo(this.estimated.x/frameW*mx,this.estimated.y/frameH*my); mctx.stroke(); } } }
  }
}
