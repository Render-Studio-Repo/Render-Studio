import test from 'node:test';
import assert from 'node:assert/strict';
import { createWiringQuestionsHeader } from './wiring-questions.js';

class FakeElement {
  constructor(tagName) { this.tagName=tagName; this.children=[]; this.attributes={}; this.listeners={}; }
  setAttribute(name,value) { this.attributes[name]=value; }
  addEventListener(name,listener) { this.listeners[name]=listener; }
  append(...children) { this.children.push(...children); }
  click() { this.listeners.click?.(); }
}

const documentRef = { createElement: (tagName) => new FakeElement(tagName) };

test('wiring follow-up dialog has an accessible top-right close control', () => {
  let closeCount=0;
  const header=createWiringQuestionsHeader({documentRef,onClose:()=>{closeCount+=1;}});
  const [heading,close]=header.children;
  assert.equal(header.className,'wiring-questions-header');
  assert.equal(heading.textContent,'A few details to finish your wiring');
  assert.equal(close.className,'wiring-questions-close');
  assert.equal(close.attributes['aria-label'],'Close additional wiring details');
  close.click();
  assert.equal(closeCount,1);
});
