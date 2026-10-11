import { describe, expect, it } from 'vitest'
import { MAX_HTML_SOURCE_BYTES, readHtmlSource } from '#/lib/html-source-import'
import { InputError } from '#/lib/validation'

describe('browser HTML source import', () => {
  it.each(['page.html', 'page.htm', 'PAGE.HTML'])(
    'loads %s as editable UTF-8 text',
    async (name) => {
      const content = '<!doctype html><html><body>Olá, 世界</body></html>'
      expect(await readHtmlSource(new File([content], name))).toBe(content)
    },
  )

  it('does not trim valid imported source or execute markup', async () => {
    const content = '  <script>window.secret = true</script>\n'
    expect(await readHtmlSource(new File([content], 'index.html'))).toBe(content)
  })

  it.each(['document.txt', 'page.html.exe', 'page.htm.txt', 'image.png'])(
    'rejects a misleading filename %s',
    async (name) => {
      await expect(readHtmlSource(new File(['markup'], name))).rejects.toBeInstanceOf(InputError)
    },
  )

  it('rejects empty files and whitespace-only documents', async () => {
    for (const text of ['', ' \n\t ']) {
      await expect(readHtmlSource(new File([text], 'index.html'))).rejects.toThrow(
        /empty|non-empty/i,
      )
    }
  })

  it('enforces the schema-compatible 300 KB source limit before reading', async () => {
    const file = new File(['x'.repeat(MAX_HTML_SOURCE_BYTES + 1)], 'index.html')
    file.arrayBuffer = () => {
      throw new Error('Oversized files must not be read')
    }
    await expect(readHtmlSource(file)).rejects.toThrow(/300 KB/)
  })

  it('accepts content at the exact limit', async () => {
    const data = 'a'.repeat(MAX_HTML_SOURCE_BYTES)
    expect(await readHtmlSource(new File([data], 'index.htm'))).toBe(data)
  })

  it('rejects invalid UTF-8 instead of replacing document bytes silently', async () => {
    await expect(
      readHtmlSource(new File([new Uint8Array([0xc3, 0x28])], 'index.html')),
    ).rejects.toThrow(/UTF-8/)
  })
})
