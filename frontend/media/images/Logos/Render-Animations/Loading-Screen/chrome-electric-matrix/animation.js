/* Alternate loading artwork. Standalone: does not access Studio state or APIs. */
(() => {
  'use strict';
  const canvas = document.getElementById('animation');
  const ctx = canvas.getContext('2d', { alpha: false });
  const slider = document.getElementById('timeline');
  const clock = document.getElementById('clock');
  const pause = document.getElementById('pause');
  const phase = document.getElementById('phase');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const DURATION = 8000;
  const logo = new Image();
  const TAU = Math.PI * 2;
  let time = 0, raf = 0, origin = 0, playing = false, ready = false, disposed = false;
  let resumeWhenVisible = false;
  const clamp = (x, a=0, b=1) => Math.min(b, Math.max(a,x));
  const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
  const noise = n => { const v=Math.sin(n*127.1+311.7)*43758.5453; return v-Math.floor(v); };
  const front = new Path2D('M200 172 L654 170 L734 238 L731 387 L668 434 L766 546 L720 599 L586 599 L483 450 L361 450 L361 579 L312 615 L199 611 Z M355 290 L548 290 Q578 290 584 312 Q590 339 551 346 L355 351 Z');
  const face = new Path2D('M234 205 L648 204 L695 248 L694 370 L638 419 L591 420 L704 566 L597 567 L491 423 L327 422 L327 565 L234 571 Z M328 267 L550 267 Q606 267 606 317 Q606 371 550 371 L328 371 Z');
  const jets = new Path2D('M357 478 C403 469 422 490 441 517 C466 483 500 509 535 549 L588 646 L544 710 L433 713 L374 642 L358 575 Z');
  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ012345789<>/{}';
  const bolts = [
    [[203,181],[311,177],[422,178],[533,176],[653,179],[724,241]],
    [[207,194],[208,284],[210,383],[209,485],[210,583]],
    [[720,248],[723,322],[722,383],[665,433],[748,547]],
    [[244,584],[318,583],[345,565],[345,436],[483,438],[590,580]],
    [[57,390],[78,307],[100,229],[158,165],[222,122],[286,109]],
    [[77,471],[107,517],[160,550],[193,552]],
  ];

  function stroke(points, color, width, glow=0) {
    ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.shadowColor=color; ctx.shadowBlur=glow;
    ctx.stroke(); ctx.shadowBlur=0;
  }

  function gearPath(cx,cy,outer,root,angle) {
    const p=new Path2D();
    for(let i=0;i<28;i++) for(let j=0;j<4;j++) {
      const a=angle+(i+[0,.17,.63,.8][j])/28*TAU;
      const r=(j===1||j===2)?outer:root;
      const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
      if(i===0&&j===0)p.moveTo(x,y);else p.lineTo(x,y);
    }
    p.closePath();p.moveTo(cx+191,cy);p.arc(cx,cy,191,0,TAU,true);
    return p;
  }

  function drawGear(t) {
    const cx=310,cy=333,angle=t*.36;
    const path=gearPath(cx,cy,288,263,angle);
    ctx.save();
    ctx.translate(7,10);ctx.fillStyle='#080c11';ctx.strokeStyle='#1f3440';ctx.lineWidth=4;ctx.fill(path,'evenodd');ctx.stroke(path);
    ctx.restore();
    const metal=ctx.createLinearGradient(80,40,504,603);
    [[0,'#52616d'],[.13,'#e1eaf0'],[.23,'#75858e'],[.32,'#202b34'],[.47,'#6f7e85'],[.49,'#eaf6fd'],[.53,'#7f99a8'],[.65,'#18242b'],[.84,'#647783'],[.95,'#d4e3eb'],[1,'#4c6475']].forEach(s=>metal.addColorStop(...s));
    ctx.fillStyle=metal;ctx.fill(path,'evenodd');ctx.strokeStyle='#92a9b7';ctx.lineWidth=2;ctx.stroke(path);
    ctx.save();ctx.clip(path,'evenodd');
    for(let i=0;i<150;i++) { const a=i*.87;const r=203+noise(i)*78;
      stroke([[cx+Math.cos(a)*r,cy+Math.sin(a)*r],[cx+Math.cos(a+.01)*r+4,cy+Math.sin(a+.01)*r+2]],'rgba(210,231,241,.14)',.7);
    }
    ctx.restore();
    for(const [r,color,w] of [[252,'#080f17',9],[244,'#a4c0cf',2],[234,'#101e2b',17],[223,'#20beef',3],[215,'#90e8ff',1],[199,'#405a6d',4]]) {
      ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.strokeStyle=color;ctx.lineWidth=w;
      ctx.shadowColor='#00baff';ctx.shadowBlur=r===223?13:0;ctx.stroke();ctx.shadowBlur=0;
    }
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);
    for(let i=0;i<14;i++) {
      const a=i/14*TAU;
      ctx.save();ctx.rotate(a);
      stroke([[194,0],[169,16],[120,16],[95,40]],'#102837',12);
      stroke([[194,0],[169,16],[120,16],[95,40]],'#3484a3',1);
      ctx.beginPath();ctx.arc(251,0,4.2,0,TAU);ctx.fillStyle='#09121a';ctx.fill();ctx.strokeStyle='#718897';ctx.lineWidth=1.3;ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    for(let i=0;i<3;i++) { const a=angle*1.3+i*2.3;ctx.beginPath();ctx.arc(cx,cy,229,a,a+.18);ctx.strokeStyle='rgba(190,247,255,.88)';ctx.lineWidth=3;ctx.shadowBlur=9;ctx.shadowColor='#19caff';ctx.stroke();ctx.shadowBlur=0; }
  }

  function drawChrome(t, matrix) {
    ctx.save();ctx.clip(front,'evenodd');ctx.drawImage(logo,0,0,768,768);ctx.restore();
    ctx.save();ctx.clip(jets);ctx.drawImage(logo,0,0,768,768);ctx.restore();
    ctx.save();ctx.clip(face,'evenodd');
    const x=-300+(t*.37%1.8)*1000;
    const sheen=ctx.createLinearGradient(x-85,190,x+160,420);
    [[0,'rgba(255,255,255,0)'],[.38,'rgba(216,239,255,.02)'],[.49,'rgba(255,255,255,.70)'],[.53,'rgba(244,251,255,.92)'],[.6,'rgba(144,225,255,.22)'],[1,'rgba(255,255,255,0)']].forEach(s=>sheen.addColorStop(...s));
    ctx.globalCompositeOperation='screen';ctx.fillStyle=sheen;ctx.fillRect(190,170,570,440);
    ctx.globalCompositeOperation='source-over';
    if(matrix>0) {
      ctx.fillStyle=`rgba(0,13,10,${matrix*.86})`;ctx.fillRect(190,170,570,440);
      ctx.font='bold 15px ui-monospace, "Hiragino Kaku Gothic ProN", monospace';ctx.textAlign='center';
      for(let col=0;col<34;col++) {
        const x=240+col*14;
        const age=Math.max(0,t-5.15-noise(col+80)*.65);
        const head=155+age*(130+noise(col+9)*115);
        for(let row=0;row<22;row++) {
          const y=head-row*16;
          if(y<180||y>590)continue;
          const a=matrix*Math.pow(1-row/23,1.5);
          const index=Math.floor(noise(col*33+row+Math.floor(t*8))*glyphs.length);
          ctx.fillStyle=row===0?`rgba(214,255,224,${a})`:`rgba(${row<3?'100,255,166':'24,216,113'},${a})`;
          ctx.shadowColor='#20ff9b';ctx.shadowBlur=row<2?7:0;
          ctx.fillText(glyphs[index],x,y);
        }
      }
      ctx.shadowBlur=0;
      const scanY=190+(t-5.2)*155;
      const scan=ctx.createLinearGradient(0,scanY-32,0,scanY+2);
      scan.addColorStop(0,'rgba(55,255,162,0)');scan.addColorStop(1,`rgba(89,255,177,${matrix*.16})`);
      ctx.fillStyle=scan;ctx.fillRect(190,scanY-32,550,34);
    }
    ctx.restore();
  }

  function drawElectricity(t,matrix) {
    const energy=smooth(.12,1.1,t)*(1-matrix*.42);
    const step=Math.floor(t*12);
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    bolts.forEach((base,index)=>{
      const pulse=.35+.65*Math.pow((Math.sin(t*3.7+index*2)+1)/2,2);
      const pts=[];
      for(let j=0;j<base.length-1;j++){
        const a=base[j],b=base[j+1];const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
        for(let k=0;k<9;k++) { const u=k/9;const dev=(noise(step+index*71+j*9+k)-.5)*15*(k?1:0);
          pts.push([a[0]+dx*u-dy/len*dev,a[1]+dy*u+dx/len*dev]);
        }
      }pts.push(base[base.length-1]);
      ctx.globalAlpha=energy*pulse;
      stroke(pts,'#038df4',5,16);stroke(pts,'#31ccff',2.5,5);stroke(pts,'#d5fbff',.95);
      if(index<4) {const at=pts[Math.floor(noise(index+step)*pts.length)];stroke([at,[at[0]+10,at[1]-13],[at[0]+4,at[1]-25],[at[0]+20,at[1]-40]],'#78e8ff',1.1,6);}
    });
    // A moving current also crosses the metal face, clipped to the R itself.
    ctx.save();ctx.clip(face,'evenodd');
    const flowY=205+((t*.42)%1)*370;
    const current=[];
    for(let k=0;k<28;k++)current.push([230+k*18,flowY+Math.sin(k*1.8+step)*9+(noise(k+step)-.5)*12]);
    ctx.globalAlpha=energy*.38*(.5+.5*Math.sin(t*2.1)**2);
    stroke(current,'#17bbff',2,8);stroke(current,'#c5f7ff',.75);
    ctx.restore();ctx.globalAlpha=1;ctx.restore();
  }

  function drawSparks(t,matrix) {
    ctx.save();ctx.lineCap='round';
    for(let i=0;i<94;i++) {
      const cycle=.45+noise(i+3)*.7;
      const a=(t+noise(i)*cycle)%cycle;
      const life=a/cycle;
      const origin=i%3===0?[204,566]:i%2?[421,607]:[492,599];
      const angle=(i%3===0?2.3:.88)+(noise(i+40)-.5)*1.15;
      const speed=80+noise(i+12)*180;
      const x=origin[0]+Math.cos(angle)*speed*a;
      const y=origin[1]+Math.sin(angle)*speed*a+75*a*a;
      const alpha=(1-life)*(1-matrix*.6)*smooth(.5,1.5,t);
      if(alpha<.02)continue;
      ctx.globalAlpha=alpha;
      const tail=3+noise(i+6)*8;
      stroke([[x,y],[x-Math.cos(angle)*tail,y-Math.sin(angle)*tail]],i%5===0?'#c3f9ff':i%3===0?'#ffedbd':'#ff9b30',.75+noise(i)*1.1,5);
    }ctx.restore();
  }

  function draw(tms) {
    if(!ready||disposed)return;
    const t=tms/1000;
    const matrix=smooth(5.25,6.25,t);
    ctx.setTransform(canvas.width/900,0,0,canvas.height/650,0,0);
    ctx.fillStyle='#030507';ctx.fillRect(0,0,900,650);
    const halo=ctx.createRadialGradient(445,307,30,445,307,330);
    halo.addColorStop(0,matrix>.5?'#05231f':'#062232');halo.addColorStop(.55,'#06121b');halo.addColorStop(1,'#030507');
    ctx.fillStyle=halo;ctx.fillRect(0,0,900,650);
    ctx.save();ctx.globalAlpha=.13;
    for(let i=0;i<36;i++) {const x=noise(i+300)*900,y=noise(i+600)*650;ctx.fillStyle=i%3?'#72cce2':'#59ffd0';ctx.fillRect(x,y,1,1);}
    ctx.restore();
    const grow=.93+.07*smooth(0,1.1,t);
    const size=482*grow,s=size/768;
    ctx.save();ctx.translate(450-size/2,50+(482-size)/2);ctx.scale(s,s);
    ctx.globalAlpha=.22+.78*smooth(0,.7,t);
    drawGear(motion.matches?1:t);drawChrome(motion.matches?7:t,matrix);
    if(!motion.matches){drawElectricity(t,matrix);drawSparks(t,matrix);}
    ctx.restore();
    ctx.textAlign='center';ctx.font='500 22px -apple-system, BlinkMacSystemFont, sans-serif';
    const word=ctx.createLinearGradient(0,520,0,546);word.addColorStop(0,'#f5faff');word.addColorStop(.46,'#9cabb7');word.addColorStop(.5,'#f2f8ff');word.addColorStop(1,'#647684');
    ctx.fillStyle=word;ctx.letterSpacing='7px';ctx.fillText('RENDER STUDIO',450,555);ctx.letterSpacing='0px';
    ctx.font='10px ui-monospace, monospace';ctx.fillStyle=matrix>.1?'#75e5b1':'#7e9eaf';
    ctx.letterSpacing='2.5px';ctx.fillText(t>=7.95?'SYSTEM READY':matrix>.05?'DECODING THE NEXT DIMENSION':'BRINGING YOUR IDEAS TO LIFE',450,578);ctx.letterSpacing='0px';
    const trackX=345,trackY=603,trackW=210;
    ctx.fillStyle='#15232d';ctx.fillRect(trackX,trackY,trackW,2);
    const progress=clamp(tms/DURATION);
    ctx.fillStyle=matrix>.1?'#54efa8':'#8eeaff';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=8;ctx.fillRect(trackX,trackY,trackW*progress,2);ctx.shadowBlur=0;
    const phaseText=t<1.5?'01 — ENERGIZE':t<5.25?'02 — FORGE':t<7.95?'03 — DECODE':'04 — READY';
    if(phase.textContent!==phaseText)phase.textContent=phaseText;
    slider.value=String(tms);clock.textContent=`${(tms/1000).toFixed(1)} / 8.0s`;
    canvas.dataset.phase=matrix>0?'matrix':'chrome';canvas.dataset.time=String(Math.round(tms));
  }

  function setButton(){pause.textContent=playing?'Pause':'Play';pause.setAttribute('aria-label',playing?'Pause animation':'Play animation');}
  function stop(){playing=false;cancelAnimationFrame(raf);raf=0;setButton();}
  function frame(now){if(!playing||disposed)return;time=Math.min(DURATION,now-origin);draw(time);if(time>=DURATION)stop();else raf=requestAnimationFrame(frame);}
  function play(){if(!ready||disposed||motion.matches)return;if(time>=DURATION)time=0;cancelAnimationFrame(raf);playing=true;origin=performance.now()-time;setButton();raf=requestAnimationFrame(frame);}
  function seek(ms){stop();time=clamp(Number(ms),0,DURATION);draw(time);}
  function replay(){seek(0);if(motion.matches)seek(7400);else play();}
  function resize(){const dpr=Math.min(devicePixelRatio||1,1.5);const width=Math.min(1350,Math.round(canvas.clientWidth*dpr));canvas.width=Math.max(1,width);canvas.height=Math.round(canvas.width*650/900);draw(time);}
  function applyMotion(){if(motion.matches){stop();time=7400;draw(time);pause.disabled=true;document.getElementById('motion-note').textContent='Reduced motion is on. Showing a still frame of the final Matrix reveal.';}else{pause.disabled=false;document.getElementById('motion-note').textContent='An eight-second alternate loading sequence. Matrix rain enters during the final third.';}}
  function visibility(){if(document.hidden){resumeWhenVisible=playing;stop();}else if(resumeWhenVisible){resumeWhenVisible=false;play();}}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);
  document.getElementById('replay').addEventListener('click',replay);
  pause.addEventListener('click',()=>playing?stop():play());
  slider.addEventListener('input',()=>seek(slider.value));
  document.addEventListener('visibilitychange',visibility);
  motion.addEventListener('change',applyMotion);
  window.addEventListener('pagehide',stop);
  window.renderChromePreview={
    seek, replay, pause:stop, play, duration:DURATION,
    setProgress(value){seek(clamp(Number(value),0,100)/100*DURATION);},
    complete(){seek(DURATION);},
    destroy(){stop();disposed=true;resizeObserver.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',applyMotion);},
    get ready(){return ready;},get playing(){return playing;}
  };
  logo.onload=()=>{ready=true;resize();applyMotion();if(!motion.matches)play();};
  logo.onerror=()=>{phase.textContent='LOGO COULD NOT LOAD';document.getElementById('motion-note').textContent='Keep render-logo.png beside this preview.';stop();};
  logo.src='render-logo.png?v=20260908-chrome-electric-matrix-1';
})();
