/**
 * Opaque 32x32 RGB PNG used by the local downloadFrom fixture server.
 * Keep this valid image data: pdfcpu rejects a PNG with an invalid IDAT CRC,
 * but Gotenberg reports a generic unsupported stamp-source error.
 */
export const REMOTE_OVERLAY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAQUlEQVR42mOUiNrCQEvAxEBjQHMLWOCsc98qqWiuEVf7cAmiUQtGLRi1YNSCUQtGLRi1YNSCIdeyg7fFRoMIFQAABKAFLW6hN6EAAAAASUVORK5CYII=',
  'base64',
)
