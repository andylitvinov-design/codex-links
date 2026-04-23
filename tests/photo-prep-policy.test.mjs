import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PHOTO_FILE_SIZE,
  MAX_PHOTO_UPLOAD_BYTES,
  shouldTranscodePhotoBeforeUpload
} from "../public/_lib/photo-prep.js";

test("photo prep policy keeps the client-side upload target at 1.5 MB", () => {
  assert.equal(MAX_PHOTO_UPLOAD_BYTES, 1_500_000);
  assert.equal(MAX_PHOTO_FILE_SIZE, 4_500_000);
});

test("shouldTranscodePhotoBeforeUpload only compresses files above the upload target", () => {
  assert.equal(shouldTranscodePhotoBeforeUpload(1_500_000), false);
  assert.equal(shouldTranscodePhotoBeforeUpload(1_500_001), true);
});
