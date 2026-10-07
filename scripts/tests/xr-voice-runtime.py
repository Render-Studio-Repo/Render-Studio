import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
  page=await browser.new_page(viewport={'width':1100,'height':700})
  await page.route('**/__voice-transport-check',lambda route:route.fulfill(content_type='text/html',body='<html><body style="background:#111827;color:#dbeafe;font:20px system-ui;padding:40px"><h1>VR voice transport verification</h1><pre id="result">Running isolated checks…</pre></body></html>'))
  await page.goto('http://127.0.0.1:8001/__voice-transport-check')
  result=await page.evaluate('''async () => {
   const {VoiceAudioOutput}=await import('/components/voice-audio-output.js?v=20260915-xragent1');
   const {createVoiceMold}=await import('/components/voice-mold.js?v=20260915-xragent1');
   const checks=[];const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)};
   let peak=0;const audio=new VoiceAudioOutput({volume:0,onLevel:n=>peak=Math.max(peak,n)});await audio.resume();
   const pcm=new Int16Array(12000);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i*Math.PI*2*220/24000)*5000;
   audio.playPcm16(pcm);await new Promise(r=>setTimeout(r,180));
   check(peak>0.1,'Real PCM output produces a measured voice waveform');
   check(audio.getOutputStream().getAudioTracks().length===1,'Assistant output exposes a separate audio stream');
   check(audio.gain.gain.value===0,'Local mute does not remove room stream');
   audio.close();check(audio.getOutputStream().getTracks().every(t=>t.readyState==='ended'),'Dismissal stops output stream');
   const inputContext=new AudioContext();const input=inputContext.createMediaStreamDestination().stream;
   navigator.mediaDevices.getUserMedia=async()=>input;
   class MockSocket extends EventTarget {static OPEN=1;constructor(){super();this.readyState=1;this.sent=[];window.testSocket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')))}send(raw){let m=JSON.parse(raw);this.sent.push(m);if(m.type==='session.update')queueMicrotask(()=>this.event({type:'session.updated'}))}close(){this.readyState=3;this.dispatchEvent(new Event('close'))}event(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}))}}
   window.WebSocket=MockSocket;let proposals=[];let transcripts=[];
   const voice=createVoiceMold({bindDesktop:false,getAgentSettings:()=>({name:'Astra',wakeName:'Astra',voiceModel:'gpt-realtime'}),api:async(path)=>path.includes('/models')?{models:[{id:'gpt-realtime',transport:'realtime'}]}:{transport:'realtime',model:'gpt-realtime',proxy_ws_path:'/api/voice-mold/ws'},getSceneContext:()=>({selected:'Wire W1',wire:{source:'Controller D2',destination:'Sensor OUT',gauge:'22 AWG',documents:[{url:'https://manufacturer.example/pinout'}]},generationModel:'chosen-cad-model'}),getSceneImage:()=>document.createElement('canvas').toDataURL('image/png'),onChangeProposal:p=>proposals.push(p),onTranscript:t=>transcripts.push(t)});
   await voice.start();await new Promise(r=>setTimeout(r,30));check(voice.getState().live,'Actual browser microphone/PCM setup starts with mocked provider');
   check(testSocket.sent.some(m=>m.item?.content?.some(c=>c.type==='input_image')),'Viewport frame is encoded in Realtime image message');
   testSocket.event({type:'response.function_call_arguments.done',name:'propose_cad_change',call_id:'one',arguments:JSON.stringify({instruction:'Route W1 along left wall',targetIds:['W1']})});await new Promise(r=>setTimeout(r,10));
   check(proposals.length===1&&proposals[0].generationModel==='chosen-cad-model','Voice queues a targeted change for selected-model review');
   testSocket.event({type:'response.output_audio_transcript.done',transcript:'I added that route to your review list.'});check(transcripts[0].role==='assistant','Spoken transcript is delivered to the VR agent');
   voice.stop();check(input.getTracks().every(t=>t.readyState==='ended'),'Stopping voice releases microphone tracks');await inputContext.close();
   document.querySelector('#result').textContent=checks.map(x=>'✓ '+x).join('\\n');return {checks,paidRequests:0};
  }''')
  Path('/private/tmp/xr-voice-browser.json').write_text(json.dumps(result,indent=2))
  await page.screenshot(path='/private/tmp/xr-voice-browser.png')
  await browser.close()
  print(json.dumps(result,indent=2))
asyncio.run(main())
