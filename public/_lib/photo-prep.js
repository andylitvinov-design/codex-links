export const MAX_PHOTO_FILE_SIZE = 4_500_000;
export const MAX_PHOTO_UPLOAD_BYTES = 1_500_000;
export const MAX_PHOTO_DIMENSION = 1600;

export function shouldTranscodePhotoBeforeUpload(fileSize) {
  const size = Number(fileSize) || 0;
  return size > MAX_PHOTO_UPLOAD_BYTES;
}
