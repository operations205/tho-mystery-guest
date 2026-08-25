// Shared check for any field that gets rendered straight back into an <img src="..."> — every
// caller must confirm the value is actually an image data URL, not just "a string under N bytes".
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function isValidImageDataUrl(value) {
  return typeof value === 'string' && IMAGE_DATA_URL_RE.test(value);
}

module.exports = { isValidImageDataUrl };
