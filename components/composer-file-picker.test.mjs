import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { englishMessages } = await jiti.import("../lib/i18n/locale-plugins.ts");

const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindowSource = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("the desktop composer picker routes all picked files through ChatWindow", () => {
  assert.match(chatInputSource, /onAttachFiles\?: \(files: File\[\]\) => void;/);
  assert.match(chatInputSource, /accept=\{!onAttachFiles \? "image\/\*" : undefined\}/);
  assert.match(chatInputSource, /if \(onAttachFiles\) onAttachFiles\(files\);/);
  assert.match(chatWindowSource, /<ChatInput[\s\S]*?onAttachFiles=\{onAttachFiles\}/);
});

test("picked images remain visible and all originals use the unified transfer path", () => {
  const source = chatWindowSource.slice(
    chatWindowSource.indexOf("const onAttachFiles = useCallback"),
    chatWindowSource.indexOf("const { isDragOver, handleDragEnter", chatWindowSource.indexOf("const onAttachFiles = useCallback")),
  );
  assert.match(source, /partitionChatDroppedFiles\(files\)/);
  assert.match(source, /chatInputRef\?\.current\?\.addImages\(images\)/);
  assert.match(source, /importProjectFiles\(files\)/);
});

test("the add-files label is available in every locale", () => {
  assert.equal(englishMessages["chat.attachFiles"], "Add files");
  assert.equal(englishMessages["chat.attachImage"], "Attach image");
  assert.match(chatInputSource, /aria-label=\{t\("a11y2\.attach"\)\}/);
  assert.equal(englishMessages["a11y2.attach"], "Add attachments");
});

test("chat composers preserve arbitrary binary files through the unified transfer path", () => {
  // Unified transfers preserve originals and attach stable paths instead of reading arbitrary files as text.
  assert.doesNotMatch(chatInputSource, /chatOnly \|\| !onAttachFiles \? "image/);
  const attach = chatWindowSource.slice(
    chatWindowSource.indexOf("const importProjectFiles = useCallback"),
    chatWindowSource.indexOf("const onDrop = useCallback"),
  );
  assert.match(attach, /uploadSessionFiles\(setup.sessionId,projectFiles,/);
  assert.doesNotMatch(attach, /addTextFiles\(projectFiles\)/);
  assert.doesNotMatch(attach, /chat\.chatOnlyImagesOnly/);
});
