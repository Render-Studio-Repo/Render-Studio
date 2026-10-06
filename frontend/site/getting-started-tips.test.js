import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as tips from './getting-started-tips.js';

test('every tips export imported by Studio and getting-started remains available', () => {
  const versions = [];
  for (const filename of ['../components/render-agent.js', './getting-started.js']) {
    const source=readFileSync(new URL(filename,import.meta.url),'utf8');
    const match=source.match(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*getting-started-tips\.js\?v=([^"']+)["']/);
    assert.ok(match, `Tips import missing in ${filename}`);
    versions.push(match[2]);
    for(const name of match[1].split(',').map(item=>item.trim()).filter(Boolean)) {
      assert.ok(name in tips, `${filename} requires missing export ${name}`);
    }
  }
  assert.equal(new Set(versions).size,1,'All consumers must use the same fresh tips module');
});

test('Render Agent can rotate, read, and badge every tip even when storage is unavailable', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage disabled');}});
  try {
    tips.bumpTipOnRefresh();
    const first=tips.getCurrentTip();
    assert.ok(tips.GETTING_STARTED_TIPS.includes(first));
    tips.bumpTipForNewThread();
    assert.notEqual(tips.getCurrentTip(), first);
    for(const tip of tips.GETTING_STARTED_TIPS) {
      assert.equal(typeof tip.title,'string');
      assert.equal(typeof tip.body,'string');
      assert.match(tips.tipTopicClass(tip.topic),/^tip-topic--(?:dxf|software|prompt)$/);
    }
  } finally {
    if(original)Object.defineProperty(globalThis,'localStorage',original);
    else delete globalThis.localStorage;
  }
});
