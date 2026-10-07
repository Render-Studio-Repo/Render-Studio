import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./marketplace-messages.css", import.meta.url), "utf8");

test("marketplace messages map every surface to the metal and gold theme", () => {
  const marketplaceTheme = css.match(/body\.mkt2 \.mkt-messages \{(?<rules>[\s\S]*?)\n\}/)?.groups?.rules;
  assert.ok(marketplaceTheme, "marketplace-specific message tokens are present");
  assert.match(marketplaceTheme, /--message-bg:\s*var\(--market-raised\)/);
  assert.match(marketplaceTheme, /--message-header:\s*linear-gradient/);
  assert.match(marketplaceTheme, /--message-text:\s*var\(--market-ink\)/);
  assert.match(marketplaceTheme, /--message-accent:\s*var\(--market-gold-bright\)/);

  assert.match(css, /background:\s*var\(--message-/);
  assert.match(css, /color:\s*var\(--message-/);
  assert.match(css, /border:\s*1px solid var\(--message-border\)/);
  assert.match(css, /\.mkt-inbox-unread/);
});
