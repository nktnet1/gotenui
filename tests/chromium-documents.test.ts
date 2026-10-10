import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { defaultMarkdownTemplate, markdownTemplateReferences } from '#/lib/chromium-documents'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { InputError, validateFiles, validatePayload } from '#/lib/validation'

const header =
  '<!doctype html><html><head><style>body{font-size:10px}</style></head><body>Page <span class="pageNumber"></span></body></html>'
const footer = '<html><head></head><body>Footer <span class="totalPages"></span></body></html>'

function makePayload(operationId: string, extras: Record<string, unknown> = {}) {
  const operation = OPERATION_BY_ID.get(operationId)
  assert.ok(operation)
  return validatePayload({
    operation: operationId,
    fields: {
      ...operationDefaults(operation),
      ...(operation.input === 'url' ? { url: 'https://example.com' } : {}),
    },
    advanced: {},
    ...(operation.input === 'html'
      ? { source: '<!doctype html><html><body>Hello</body></html>' }
      : operation.input === 'markdown'
        ? { source: '# First document' }
        : {}),
    ...extras,
  })
}

function validateAssets(operationId: string, extras: Record<string, unknown>, assets: File[]) {
  const { operation, payload } = makePayload(operationId, extras)
  validateFiles(operation, [], assets, 4_000_000, payload)
  return createGotenbergForm(operation, payload, [], assets)
}

describe('Chromium PDF headers and footers', () => {
  test.each(['url-pdf', 'html-pdf', 'markdown-pdf'])(
    '%s sends optional named HTML files through the files field',
    async (id) => {
      const form = validateAssets(id, { headerHtml: header, footerHtml: footer }, [])
      const files = form.getAll('files') as File[]
      assert.deepEqual(files.map((file) => file.name).slice(-2), ['header.html', 'footer.html'])
      assert.equal(await files.at(-2)?.text(), header)
      assert.equal(await files.at(-1)?.text(), footer)
      assert.equal(form.has('headerHtml'), false)
      assert.equal(form.has('footerHtml'), false)
      assert.equal(form.has('header'), false)
    },
  )

  test('a URL PDF can use a header without HTML source or local assets', () => {
    const form = validateAssets('url-pdf', { headerHtml: header }, [])
    assert.deepEqual(
      (form.getAll('files') as File[]).map((file) => file.name),
      ['header.html'],
    )
  })

  test.each(['url-shot', 'html-shot', 'markdown-shot', 'office-pdf'])(
    '%s rejects PDF-only header assets',
    (id) => {
      assert.throws(() => makePayload(id, { headerHtml: header }), /Chromium PDF output/)
      assert.throws(() => makePayload(id, { footerHtml: footer }), /Chromium PDF output/)
    },
  )

  test.each(['', '<div>Partial HTML</div>', '<html><body>Missing head</body></html>'])(
    'rejects incomplete header markup',
    (invalid) => {
      assert.throws(() => makePayload('url-pdf', { headerHtml: invalid }), /complete HTML/)
    },
  )

  test('rejects reserved header/footer asset names even if the HTML fields were not supplied', () => {
    for (const fileName of ['header.html', 'HEADER.HTML', 'footer.html', 'index.html']) {
      assert.throws(
        () => validateAssets('html-pdf', {}, [new File(['file content'], fileName)]),
        /Duplicate filename/,
      )
    }
    assert.throws(
      () =>
        validateAssets('markdown-pdf', { footerHtml: footer }, [
          new File(['already here'], 'footer.html'),
        ]),
      /Duplicate filename/,
    )
  })
})

describe('Markdown files and templates', () => {
  test('retains the original one-file generated-template contract', async () => {
    const form = validateAssets('markdown-pdf', {}, [])
    const files = form.getAll('files') as File[]
    assert.deepEqual(
      files.map((file) => file.name),
      ['index.html', 'document.md'],
    )
    assert.deepEqual(markdownTemplateReferences(await files[0].text()), ['document.md'])
    assert.equal(
      await files[0].text(),
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Markdown</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:820px;padding:0 24px}</style></head><body>{{ toHTML "document.md" }}</body></html>',
    )
    assert.equal(await files[1].text(), '# First document')
  })

  test('generated template renders ordered named sources and preserves local assets', async () => {
    const sources = [
      { name: 'chapter-b.md', content: '# B' },
      { name: 'chapter-a.md', content: '# A' },
    ]
    const form = validateAssets(
      'markdown-pdf',
      { markdownName: 'intro.md', markdownFiles: sources },
      [new File(['body {color: blue}'], 'theme.css')],
    )
    const files = form.getAll('files') as File[]
    assert.deepEqual(
      files.map((file) => file.name),
      ['index.html', 'intro.md', 'chapter-b.md', 'chapter-a.md', 'theme.css'],
    )
    assert.deepEqual(markdownTemplateReferences(await files[0].text()), [
      'intro.md',
      'chapter-b.md',
      'chapter-a.md',
    ])
    assert.deepEqual(await Promise.all(files.slice(1, 4).map((file) => file.text())), [
      '# First document',
      '# B',
      '# A',
    ])
  })

  test('a custom template renders multiple files (including screenshot Markdown)', async () => {
    const template =
      '<!doctype html><html><head></head><body><img src="logo.png">{{ toHTML "next.md" }}{{ toHTML "document.md" }}</body></html>'
    for (const operationId of ['markdown-pdf', 'markdown-shot']) {
      const form = validateAssets(
        operationId,
        {
          markdownTemplate: template,
          markdownFiles: [{ name: 'next.md', content: '# Next' }],
        },
        [new File(['asset'], 'logo.png')],
      )
      const files = form.getAll('files') as File[]
      assert.equal(await files[0].text(), template)
      assert.deepEqual(
        files.map((file) => file.name),
        ['index.html', 'document.md', 'next.md', 'logo.png'],
      )
    }
    assert.deepEqual(markdownTemplateReferences(defaultMarkdownTemplate(['a.md', 'b.md'])), [
      'a.md',
      'b.md',
    ])
  })

  test('rejects missing and unrendered Markdown template references', () => {
    assert.throws(
      () => makePayload('markdown-pdf', { markdownTemplate: '<html>No toHTML action</html>' }),
      /must contain/,
    )
    assert.throws(
      () => makePayload('markdown-pdf', { markdownTemplate: '{{ toHTML "missing.md" }}' }),
      /missing file: missing.md/,
    )
    assert.throws(
      () =>
        makePayload('markdown-pdf', {
          markdownFiles: [{ name: 'second.md', content: '# Second' }],
          markdownTemplate: '{{ toHTML "document.md" }}',
        }),
      /does not render second.md/,
    )
  })

  test('rejects filename collisions, empty Markdown, missing content and invalid filenames', () => {
    const invalid = [
      { markdownFiles: [{ name: 'DOCUMENT.MD', content: 'Duplicate' }] },
      { markdownFiles: [{ name: 'document.md', content: 'Duplicate' }] },
    ]
    for (const extras of invalid) {
      assert.throws(() => makePayload('markdown-pdf', extras), /unique/)
    }
    assert.throws(
      () => makePayload('markdown-pdf', { markdownFiles: [{ name: 'empty.md', content: '' }] }),
      /no Markdown content/,
    )
    assert.throws(
      () => makePayload('markdown-pdf', { markdownFiles: [{ name: '../evil.md', content: 'Hi' }] }),
      /simple names/,
    )
    assert.throws(() => makePayload('markdown-pdf', { markdownName: 'first.html' }), /\.md/)
    assert.throws(
      () => makePayload('markdown-pdf', { markdownFiles: [{ name: 'plain.txt', content: 'Hi' }] }),
      /\.md/,
    )
    assert.throws(
      () => validateAssets('markdown-pdf', {}, [new File(['something'], 'notes.md')]),
      /Markdown sources editor/,
    )
    assert.throws(
      () => validateAssets('markdown-pdf', {}, [new File(['a'], 'DOCUMENT.MD')]),
      /Markdown sources editor/,
    )
  })

  test('rejects Markdown-only fields on non-Markdown routes', () => {
    assert.throws(
      () => makePayload('html-pdf', { markdownFiles: [{ name: 'extra.md', content: 'x' }] }),
      /Markdown operation/,
    )
    assert.throws(
      () => makePayload('url-pdf', { markdownTemplate: '{{ toHTML "document.md" }}' }),
      /Markdown operation/,
    )
  })

  test('counts generated content against the upstream size limit', () => {
    const { operation, payload } = makePayload('markdown-pdf', {
      markdownFiles: [{ name: 'second.md', content: 'Hello' }],
    })
    assert.throws(
      () => validateFiles(operation, [], [], 4, payload),
      (error) => {
        assert.ok(error instanceof InputError)
        assert.equal(error.status, 413)
        return true
      },
    )
  })
})
