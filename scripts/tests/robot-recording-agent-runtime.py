import asyncio
import json
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        page = await browser.new_page(viewport={"width": 1440, "height": 960})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto("http://127.0.0.1:8001/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(10000)
        result = await page.evaluate("""async () => {
          const primary = document.querySelector('.prompt-skills-primary')?.getBoundingClientRect();
          const trail = document.querySelector('.prompt-skills-trail')?.getBoundingClientRect();
          const host = document.createElement('div');
          document.body.append(host);
          let asked = false;
          const mod = await import('/code/project-code-editor.js?robot-agent-runtime=1');
          const editor = mod.createProjectCodeEditor({
            host,
            docTabs: { setDirty(){}, upsert(){}, setActive(){}, remove(){} },
            api: async () => ({ files: [] }),
            rawFetch: fetch,
            getProjectId: () => 'runtime-project',
            onAskAgent: () => { asked = true; },
          });
          const agentButton = host.querySelector('[data-ask-agent]');
          agentButton?.click();
          const output = {
            guideMounted: !!document.querySelector('[data-robot-recording-guide]'),
            recordingControls: !!document.querySelector('[data-viser-recording-controls]'),
            toolbarIsTwoRows: !!primary && !!trail && trail.top >= primary.bottom - 1,
            codeAgentVisible: !!agentButton && !agentButton.hidden,
            codeAgentCallable: asked,
          };
          editor.clear();
          host.remove();
          return output;
        }""")
        print(json.dumps({"result": result, "errors": errors}))
        await browser.close()
        assert all(result.values()), result
        assert not errors, errors


asyncio.run(main())
