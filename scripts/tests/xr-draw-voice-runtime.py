"""Real browser PCM + served Draw modules; provider/network mutations are mocked."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'backups/xr-spatial-draw-20260915/verification'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args=['--autoplay-policy=no-user-gesture-required'])
        page = await browser.new_page(viewport={'width': 1240, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.route('**/__draw-voice-check', lambda route: route.fulfill(content_type='text/html', body='''<html><head><meta charset="utf-8"></head><body style="background:#17212b;color:#dbe9ef;font:18px/1.5 system-ui;padding:40px"><h1>VR Draw · Live voice workflow verification</h1><p>Real browser audio and served modules · isolated provider · no generation calls</p><pre id="result" style="white-space:pre-wrap"></pre><div id="note" style="margin-top:25px;padding:22px;border:1px solid #5c8293;border-radius:12px;background:#223643"></div></body></html>'''))
        await page.goto('http://127.0.0.1:8001/__draw-voice-check')
        result = await page.evaluate('''async () => {
          const {createXrAiBoardStore} = await import('/xr/xr-ai-board-state.js?v=20260915-spatial-draw4');
          const {createXrDrawVoice} = await import('/xr/xr-draw-voice.js?v=20260915-spatial-draw4');
          const {createVoiceMold} = await import('/components/voice-mold.js?v=20260915-spatial-draw4');
          const {createBoardSnapshot, boardPromptContext} = await import('/xr/xr-ai-board-graph.js?v=20260915-spatial-draw4');
          const checks=[], check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
          const board=createXrAiBoardStore({projectId:'isolated-project'});
          board.dispatch({type:'node.add',node:{id:'model',kind:'model',name:'Bracket assembly',source:{filename:'bracket.step',revision:'r1',units:'mm'}}});
          board.dispatch({type:'region.add',region:{id:'split-region',kind:'lasso',nodeId:'model',name:'Split plane'}});
          board.dispatch({type:'region.add',region:{id:'other-face',kind:'face',nodeId:'model',name:'Other face'}});
          board.dispatch({type:'selection.set',ids:['split-region']});
          let organized=0, generationCalls=0;
          const draw=createXrDrawVoice({getBoard:()=>board,getProjectId:()=> 'isolated-project',onOrganizePrompt:()=>{organized++;}});
          const audio=new AudioContext(), input=audio.createMediaStreamDestination().stream;
          navigator.mediaDevices.getUserMedia=async()=>input;
          class Socket extends EventTarget {
            static OPEN=1;
            constructor(){super();this.readyState=1;this.sent=[];window.testDrawSocket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
            send(raw){const data=JSON.parse(raw);this.sent.push(data);if(data.type==='session.update')queueMicrotask(()=>this.event({type:'session.updated'}));}
            close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
            event(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
          }
          window.WebSocket=Socket;
          const voice=createVoiceMold({bindDesktop:false,getProjectId:()=> 'isolated-project',getAgentSettings:()=>({name:'Astra',voiceModel:'gpt-realtime',includeVisualContext:false}),getSceneContext:()=>({projectId:'isolated-project',spatialBoard:draw.getContext()}),onDrawBoardCommand:args=>draw.command(args),onChangeProposal:()=>{generationCalls++;},api:async path=>path.includes('/models')?{models:[{id:'gpt-realtime',transport:'realtime'}]}:{transport:'realtime',model:'gpt-realtime',proxy_ws_path:'/api/voice-mold/ws'}});
          await voice.start();
          check(voice.getState().live,'Live voice starts through existing browser PCM transport');
          const call=async(callId,args,name='draw_board_command')=>{
            testDrawSocket.event({type:'response.function_call_arguments.done',call_id:callId,name,arguments:JSON.stringify(args)});
            for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,10));const output=testDrawSocket.sent.find(item=>item.item?.call_id===callId);if(output)return JSON.parse(output.item.output);}
            throw new Error('Missing tool response '+callId);
          };
          const first=await call('split',{action:'annotate_split',text:'Split this part for my Bambu printer, then assemble the pieces.',printerModel:'Bambu',assembly:'Reassemble the printed pieces.'});
          check(first.ok && first.missingDetails.length===2,'Voice adds an editable note and asks for printer model plus joint style');
          board.dispatch({type:'selection.set',ids:['other-face']});
          const followup=await call('answer',{action:'answer_clarification',clarificationId:first.clarificationId,printerModel:'Bambu P1S',jointStyle:'Bolts with alignment pins'});
          check(followup.ok && board.getState().notes[first.noteId].regionId==='split-region','Looking elsewhere keeps the answer attached to the original lasso');
          await call('edit',{action:'update_note',noteId:first.noteId,text:'Split plan: Bambu P1S; bolts and alignment pins. Keep bolt access clear. CAD has not been edited.'});
          board.dispatch({type:'node.add',node:{id:'image',kind:'image',name:'Chrome finish'}});
          board.dispatch({type:'node.add',node:{id:'memo',kind:'memo',name:'Assembly memo',transcript:'Use removable bolts.'}});
          await call('link1',{action:'add_link',fromId:'split-region',toId:'image',caption:'Final material'});
          await call('link2',{action:'add_link',fromId:'image',toId:'memo',caption:'Assembly requirements'});
          await call('final',{action:'final_look',nodeId:'image',finalLook:true});
          board.dispatch({type:'selection.set',ids:['split-region']});
          const prompt=boardPromptContext(board.getState());
          check(prompt.graph.nodes.some(item=>item.id==='memo') && prompt.text.includes('Final look'),'Connected image and memo appear in structured prompt context');
          await call('organize',{action:'organize_prompt'});
          const before=board.getState();
          const blocked=await call('generate',{action:'generate'});
          await call('cad',{instruction:'Cut this now'},'propose_cad_change');
          check(organized===1 && !blocked.ok && generationCalls===0 && board.getState()===before,'Organizing and voice requests never start generation');
          const snapshot=createBoardSnapshot(board.getState(),{prompt:'Reviewed draft',attachments:[]});
          board.dispatch({type:'node.update',id:'image',patch:{name:'Changed after review'}});
          check(JSON.stringify(snapshot).includes('Chrome finish') && !JSON.stringify(snapshot).includes('Changed after review'),'Reviewed reference snapshot stays immutable when the board changes');
          voice.stop();await audio.close();
          check(input.getTracks().every(track=>track.readyState==='ended'),'Stopping voice releases microphone tracks');
          document.querySelector('#result').textContent=checks.map(text=>'✓ '+text).join('\\n');
          document.querySelector('#note').textContent='Original lasso note: '+board.getState().notes[first.noteId].text;
          return {checks,generationCalls,providerCalls:0,boardRevision:board.getState().revision};
        }''')
        result['pageErrors'] = errors
        assert not errors, errors
        await page.screenshot(path=str(OUT / 'draw-voice-browser.png'))
        (OUT / 'draw-voice-browser.json').write_text(json.dumps(result, indent=2))
        await browser.close()
        print(json.dumps(result, indent=2))

asyncio.run(main())
