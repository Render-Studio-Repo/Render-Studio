/** Studio bindings translated to the Pi protocol, using actual handedness.
 * dimOS recording contract: A starts recording, A again stops + saves, and
 * B is forwarded to the Pi as discard. Y is handled separately by teleop as
 * calibrate/activate/pause/reactivate and hold-to-home/reset.
 */
export function createPiUiInput(emit) {
  let emoteOpen=false,confirmOpen=false,recording=false,yAt=null,lastNav=0,reservedA=false,reservedB=false;
  const held=new Map();
  return {
    setState(s){
      if('emoteOpen' in s) emoteOpen=!!s.emoteOpen;
      if('confirmOpen' in s) confirmOpen=!!s.confirmOpen;
      if('recording' in s) recording=!!s.recording;
    },
    ownsRightButtons(){return recording;},
    clear(){held.clear();yAt=null;lastNav=0;emoteOpen=false;confirmOpen=false;recording=false;reservedA=false;reservedB=false;},
    retainHands(hands){for(const hand of held.keys())if(!hands.has(hand))held.delete(hand);if(!hands.has('left'))yAt=null;if(!hands.has('right')){reservedA=false;reservedB=false;}},
    sample(hand,mapped,now){
      const buttons=mapped.buttons,prev=held.get(hand)||[];
      const raw=buttons.slice();held.set(hand,raw);
      const rising=i=>!!raw[i]&&!prev[i];
      if(hand==='left'){
        if(rising(4)&&!confirmOpen)emit({action:'emote_picker'});
        buttons[4]=0; // X belongs to the Pi menu, never the legacy deadman.
        if(raw[5]&&yAt===null)yAt=now;
        if(!raw[5])yAt=null;
        if(emoteOpen&&Math.abs(mapped.axes[1])>.65&&now-lastNav>300){lastNav=now;emit({action:'emote_next',direction:mapped.axes[1]>0?1:-1});}
      }
      if(hand==='right'){
        // While the Pi profile is active, A/B are dedicated recorder buttons.
        // Do not let an open Robotics panel reinterpret them as menu clicks.
        if(rising(4)&&!reservedA)emit({action:recording?'record_stop':'record_start'});
        if(rising(5)&&!reservedB&&recording)emit({action:'record_discard'});
        if(!raw[4])reservedA=false;if(!raw[5])reservedB=false;
        buttons[4]=0;buttons[5]=0;
      }
      // Grip is always Studio manipulation; integrated Pi grippers use trigger.
      mapped.axes[3]=0;buttons[1]=0;
    },
    holdProgress(now){return yAt===null?0:Math.min(1,Math.max(0,(now-yAt)/3000));},
  };
}

export function piServerUiAction(message){
  return ["emote_confirm","record_saved"].includes(message?.type) ? {action:"confirm",name:String(message.name||"Saved take"),samples:Number(message.samples)||0} : null;
}
