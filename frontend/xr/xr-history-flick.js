/**
 * Right analog-stick X flick: left = undo, right = redo.
 * Ignores stick Y (tilt-up is never debugger / never history). One action per return-to-center.
 */
export function createStickHistoryFlick() {
  let started=0, peak=0, dir=0, cooldown=0;
  function reset(){started=0;peak=0;dir=0;}
  function sample({x=0,now=0,enabled=true}={}){
    if(!enabled||!Number.isFinite(now)){reset();return null;}
    const v=Number(x)||0;
    if(now<cooldown)return null;
    const dead=.28, fire=.62, maxMs=240;
    if(Math.abs(v)<dead){
      let action=null;
      if(dir&&peak>=fire&&started&&now-started<=maxMs){
        action=dir<0?'undo':'redo';
        cooldown=now+320;
      }
      reset();
      return action;
    }
    const sign=v<0?-1:1;
    if(!dir){dir=sign;started=now;}
    else if(sign!==dir){reset();dir=sign;started=now;}
    peak=Math.max(peak,Math.abs(v));
    if(started&&now-started>maxMs){reset();}
    return null;
  }
  return {sample,reset};
}

/** Deliberate yaw flick after a steady wrist; one action until the wrist settles again. */
export function createWristHistoryFlick() {
  let last=null, anchor=null, steady=0, armed=false, cooldown=0;
  const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  function reset(){last=anchor=null;steady=0;armed=false;}
  function sample({yaw,now,enabled=true}){
    if(!enabled||!Number.isFinite(yaw)||!Number.isFinite(now)){reset();return null;}
    if(!last||now-last.now>180||now<last.now){last={yaw,now};steady=now;return null;}
    const dt=now-last.now;if(dt<=0)return null;
    const speed=Math.abs(delta(yaw,last.yaw))*1000/dt;last={yaw,now};
    if(now<cooldown){steady=now;armed=false;return null;}
    if(!armed){
      if(speed>.6)steady=now;
      else if(now-steady>=180){armed=true;anchor={yaw,now};}
      return null;
    }
    const turn=delta(yaw,anchor.yaw);
    if(Math.abs(turn)<.08){anchor={yaw,now};return null;}
    if(now-anchor.now>280){armed=false;steady=now;return null;}
    if(Math.abs(turn)>.32&&speed>2.2){cooldown=now+900;armed=false;steady=now;return turn<0?'undo':'redo';}
    return null;
  }
  return {sample,reset};
}
