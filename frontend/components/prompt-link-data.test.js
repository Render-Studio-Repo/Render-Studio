import test from "node:test";
import assert from "node:assert/strict";
import { linkDescriptionBefore, originalLink, expandReferenceTokens, clipboardNodeText } from "./prompt-link-data.js";

test("URL binds to colon on same line or previous nonempty line", () => {
  for (const text of ["This is the control board: ", "Other text\nThis is the control board:\n\n "]) {
    assert.equal(linkDescriptionBefore(text), "This is the control board");
  }
  assert.equal(linkDescriptionBefore("Unrelated text"), "");
  assert.equal(linkDescriptionBefore("Label:\nAnother sentence"), "");
});
test("original URL, including variant parameters, survives token expansion", () => {
  const ref = {id:"url:1", token:"@amazon", url:"https://amazon.com/dp/B0BM3BFZ35", original_url:"https://amazon.com/dp/B0BM3BFZ35?th=1&variant=2"};
  assert.equal(expandReferenceTokens("Board: @amazon", [ref]), `Board: ${ref.original_url}`);
  assert.equal(originalLink({url:"javascript:alert(1)"}), "");
});
test("copy mixed text and noneditable chips retains full URLs and omits remove buttons", () => {
  const ref = {id:"url:1", url:"https://example.com/motor?model=2"};
  const root = {childNodes:[{nodeType:3,textContent:"Motor: "},{nodeType:1,dataset:{refId:"url:1"},childNodes:[{nodeType:3,textContent:"Short label"}]}]};
  assert.equal(clipboardNodeText(root,[ref]), "Motor: https://example.com/motor?model=2");
});
