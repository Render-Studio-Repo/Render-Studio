import test from "node:test";
import assert from "node:assert/strict";

import { personalProjectPinAction } from "./workspace-browser.js";

test("a project made public can still be unpinned from Projects", () => {
  assert.deepEqual(
    personalProjectPinAction(
      { id: "public-project", public: true, folder_id: "__public__" },
      { signedIn: true, canToggle: true, pinnedIds: ["public-project"] },
    ),
    { visible: true, pinned: true, label: "Unpin from projects" },
  );
});

test("an unpinned public project does not gain a personal pin action", () => {
  assert.deepEqual(
    personalProjectPinAction(
      { id: "public-project", public: true, folder_id: "__public__" },
      { signedIn: true, canToggle: true, pinnedIds: [] },
    ),
    { visible: false, pinned: false, label: "Pin to projects" },
  );
});
