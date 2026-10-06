import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { combineChatUnread, normalizeMarketplaceInbox } from "./chat-inbox-state.js";

test("marketplace inbox normalizes conversations and preserves the authoritative total", () => {
  const inbox = normalizeMarketplaceInbox({
    unread_count: 4,
    conversations: [
      { peer: { id: "alex" }, unread_count: 2 },
      { peer: { id: "sam" }, unread_count: -1 },
      { preview: "missing peer" },
    ],
  });
  assert.deepEqual(inbox.conversations.map((row) => [row.peer.id, row.unread_count]), [["alex", 2], ["sam", 0]]);
  assert.equal(inbox.unread_count, 4);
});

test("viewer badge combines project and marketplace unread without losing mention priority", () => {
  assert.deepEqual(
    combineChatUnread({ unread_count: 3, mention_count: 1 }, { unread_count: 2 }),
    { total: 5, project: 3, direct: 2, mentions: 1 },
  );
});

test("Studio Chat renders marketplace direct-message rows and opens the shared conversation UI", () => {
  const source = readFileSync(new URL("./project-chat.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/marketplace\/messages/);
  assert.match(source, /data-marketplace-peer/);
  assert.match(source, /combineChatUnread\(unread, marketplaceInbox\)/);
  assert.match(source, /openMarketplaceMessages\(\{ recipient: conversation\.peer \}\)/);
});
