/** Follow-up form retains the exact generation request, references and entered answers. */
const instances = new WeakMap();
export function createWiringQuestionsHeader({onClose, documentRef = document}) {
  const heading=documentRef.createElement('h2'); heading.textContent='A few details to finish your wiring';
  const close=documentRef.createElement('button'); close.type='button'; close.className='wiring-questions-close'; close.setAttribute('aria-label','Close additional wiring details'); close.title='Close'; close.textContent='×'; close.addEventListener('click',onClose);
  const header=documentRef.createElement('header'); header.className='wiring-questions-header'; header.append(heading,close);
  return header;
}

export function updateWiringQuestions({root, projectId, schematic, onContinue}) {
  if (!root) return;
  let state = instances.get(root);
  if (!state) {
    const style = document.createElement('link'); style.rel='stylesheet'; style.href=new URL('./wiring-questions.css?v=20260928-dialog-close-1', import.meta.url).href; document.head.append(style);
    const button=document.createElement('button'); button.type='button'; button.className='wiring-questions-open'; button.hidden=true; root.append(button);
    const dialog=document.createElement('dialog'); dialog.className='wiring-questions-dialog'; dialog.setAttribute('aria-label','Additional wiring details'); document.body.append(dialog);
    state={button,dialog,seen:new Set(),drafts:new Map(),key:'',busy:false}; instances.set(root,state);
    button.addEventListener('click',()=>{if(!dialog.open) dialog.showModal();});
  }
  const questions=(schematic.followup_questions || []).map((q,i)=>typeof q==='string'?{id:`detail-${i}`,question:q}:q).filter(q=>q?.question || q?.text);
  if (!questions.length && schematic.blocker?.reason) questions.push({id:'circuit-details',question:schematic.blocker.reason+' Provide the missing details or a reference link.'});
  const key=JSON.stringify([projectId, questions]);
  if (key===state.key) return;
  state.dialog.close(); state.key=key; state.busy=false;
  state.button.hidden=!questions.length;
  if (!questions.length) return;
  state.button.textContent=`Additional details (${questions.length})`;
  const form=document.createElement('form');
  const header=createWiringQuestionsHeader({onClose:()=>state.dialog.close()});
  const intro=document.createElement('p'); intro.textContent='Your parts, reference links and current connections are saved. Answer these questions to continue generation.';
  form.append(header,intro);
  const fields=[]; const draft=state.drafts.get(key)||{};
  questions.slice(0,8).forEach((q,i)=>{
    const group=document.createElement('label'); group.className='wiring-question';
    const title=document.createElement('span'); title.textContent=q.question || q.text; group.append(title);
    const input=document.createElement('textarea'); input.rows=2; input.maxLength=3000; input.required=q.required!==false; input.name=String(q.id || `detail-${i}`); input.value=draft[input.name] || ''; input.placeholder='Your answer or reference link';
    const remember=()=>{draft[input.name]=input.value;state.drafts.set(key,draft);}; input.addEventListener('input',remember);
    if (Array.isArray(q.options) && q.options.length) {
      const choices=document.createElement('div'); choices.className='wiring-question-options';
      q.options.forEach(option=>{const choice=document.createElement('button');choice.type='button';choice.textContent=String(option);choice.addEventListener('click',()=>{input.value=String(option);remember();input.focus();});choices.append(choice);});group.append(choices);
    }
    group.append(input); form.append(group); fields.push({q,input});
  });
  const error=document.createElement('p'); error.className='wiring-questions-error'; error.setAttribute('role','alert');
  const footer=document.createElement('div');footer.className='wiring-questions-actions';
  const later=document.createElement('button');later.type='button';later.textContent='Answer later';later.addEventListener('click',()=>state.dialog.close());
  const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue generation';submit.className='primary';footer.append(later,submit);form.append(error,footer);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.busy)return;
    state.busy=true;submit.disabled=true;submit.textContent='Starting…';error.textContent='';
    const answers=fields.map(({q,input})=>({id:input.name,question:q.question || q.text,answer:input.value.trim()}));
    try {
      if (fields.some(({q,input}) => q.required !== false && !input.value.trim())) throw new Error('Please answer each required question.');
      await onContinue({prompt:`Complete the saved wiring schematic ${schematic.name || ''} using the answers below and the project reference files. Resolve its remaining questions and preserve documented connections.`, ...(schematic.continuation || {}),answers});
      if(state.key===key) {state.dialog.close();state.button.hidden=true;}
    } catch(e) {if(state.key===key) error.textContent=e.message || 'Could not continue. Your answers are saved here.';}
    finally {state.busy=false;submit.disabled=false;submit.textContent='Continue generation';}
  });
  state.dialog.replaceChildren(form);
  if (!state.seen.has(key) && document.getElementById('app')?.classList.contains('wiring-mode')) {state.seen.add(key);state.dialog.showModal();}
}
