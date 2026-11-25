/** Node decodes %22/%0A/%0D in ordinary multipart filenames, while Go does
 * not. Both parsers support extended UTF-8 filename parameters. Use those
 * when native FormData would otherwise change or conflate an upload name.
 * Node also strips leading U+FEFF from ordinary filename parameters.
 * Native FormData also rewrites bare CR/LF in text fields, including passwords.
 */
export function multipartBody(form: FormData): FormData | Blob {
  if (
    ![...form.values()].some((value) =>
      typeof value === 'string'
        ? /\r(?!\n)|(?<!\r)\n/.test(value)
        : /^\uFEFF|"|%22|%0[ad]/i.test(value.name),
    )
  ) {
    return form
  }
  const boundary = `gotenui-${Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const parts: BlobPart[] = []
  for (const [name, value] of form) {
    // The route field names have already been validated. Escape delimiters
    // just as native FormData does for ordinary field names.
    const field = name.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
    const disposition = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"`
    if (typeof value === 'string') {
      parts.push(`${disposition}\r\n\r\n`, value, '\r\n')
    } else {
      const encoded = encodeURIComponent(value.name).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      )
      parts.push(
        `${disposition}; filename="upload"; filename*=UTF-8''${encoded}\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`,
        value,
        '\r\n',
      )
    }
  }
  parts.push(`--${boundary}--\r\n`)
  return new Blob(parts, { type: `multipart/form-data; boundary=${boundary}` })
}
