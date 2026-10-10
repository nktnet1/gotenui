export type FieldKind = 'text' | 'url' | 'number' | 'select' | 'toggle' | 'json' | 'password'
export type OperationGroup = 'Convert' | 'Capture' | 'PDF tools'
export type InputKind = 'url' | 'html' | 'markdown' | 'office' | 'pdf'

export type FieldDefinition = {
  name: string
  label: string
  kind: FieldKind
  description?: string
  placeholder?: string
  required?: boolean
  advanced?: boolean
  defaultValue?: string | boolean
  options?: readonly string[]
  min?: number
  max?: number
}

export type AuxiliaryUpload = {
  name: string
  label: string
  description: string
  accept?: string
  multiple?: boolean
  required?: boolean
}

export type Operation = {
  id: string
  title: string
  group: OperationGroup
  summary: string
  path: `/forms/${string}`
  docs: string
  input: InputKind
  fields: readonly FieldDefinition[]
  auxiliary?: AuxiliaryUpload
  output: 'pdf' | 'image' | 'zip' | 'json'
  featured?: boolean
  multiple?: boolean
}

const pdfa: FieldDefinition = {
  name: 'pdfa',
  label: 'PDF/A standard',
  kind: 'select',
  options: ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'],
  advanced: true,
}
const pdfua: FieldDefinition = {
  name: 'pdfua',
  label: 'Accessible PDF (PDF/UA)',
  kind: 'toggle',
  advanced: true,
}
const chromePdf: FieldDefinition[] = [
  {
    name: 'paperWidth',
    label: 'Paper width',
    kind: 'text',
    placeholder: '8.27in (A4)',
    advanced: true,
  },
  {
    name: 'paperHeight',
    label: 'Paper height',
    kind: 'text',
    placeholder: '11.7in (A4)',
    advanced: true,
  },
  { name: 'landscape', label: 'Landscape orientation', kind: 'toggle' },
  { name: 'printBackground', label: 'Print background graphics', kind: 'toggle' },
  { name: 'marginTop', label: 'Top margin', kind: 'text', advanced: true },
  { name: 'marginRight', label: 'Right margin', kind: 'text', advanced: true },
  { name: 'marginBottom', label: 'Bottom margin', kind: 'text', advanced: true },
  { name: 'marginLeft', label: 'Left margin', kind: 'text', advanced: true },
  {
    name: 'emulatedMediaType',
    label: 'Media rendering',
    kind: 'select',
    options: ['print', 'screen'],
    advanced: true,
  },
  {
    name: 'scale',
    label: 'Print scale',
    kind: 'number',
    min: 0.1,
    max: 2,
    placeholder: '1',
    advanced: true,
  },
  {
    name: 'waitDelay',
    label: 'Wait for dynamic content',
    kind: 'text',
    placeholder: '2s',
    advanced: true,
  },
  { ...pdfa },
  { ...pdfua },
]
const screenshot: FieldDefinition[] = [
  {
    name: 'width',
    label: 'Viewport width',
    kind: 'number',
    defaultValue: '1440',
    min: 1,
    max: 10000,
  },
  {
    name: 'height',
    label: 'Viewport height',
    kind: 'number',
    defaultValue: '900',
    min: 1,
    max: 10000,
  },
  {
    name: 'format',
    label: 'Image format',
    kind: 'select',
    options: ['png', 'jpeg', 'webp'],
    defaultValue: 'png',
  },
  {
    name: 'deviceScaleFactor',
    label: 'Pixel density',
    kind: 'number',
    min: 0.1,
    max: 5,
    advanced: true,
  },
  { name: 'quality', label: 'JPEG quality', kind: 'number', min: 0, max: 100, advanced: true },
  { name: 'clip', label: 'Clip to viewport', kind: 'toggle', advanced: true },
  { name: 'selector', label: 'CSS selector', kind: 'text', advanced: true },
  { name: 'omitBackground', label: 'Transparent background', kind: 'toggle', advanced: true },
]
const sourceUrl: FieldDefinition = {
  name: 'url',
  label: 'Website URL',
  kind: 'url',
  placeholder: 'https://example.com',
  required: true,
}
const pdfFiles = { input: 'pdf' as const, multiple: true }
const noFields: FieldDefinition[] = []

export const OPERATIONS: readonly Operation[] = [
  {
    id: 'url-pdf',
    title: 'Website to PDF',
    group: 'Convert',
    summary: 'Turn any public web page into a paginated PDF.',
    path: '/forms/chromium/convert/url',
    docs: 'convert-with-chromium/convert-url-to-pdf',
    input: 'url',
    fields: [sourceUrl, ...chromePdf],
    output: 'pdf',
    featured: true,
  },
  {
    id: 'html-pdf',
    title: 'HTML to PDF',
    group: 'Convert',
    summary: 'Render your HTML and optional assets.',
    path: '/forms/chromium/convert/html',
    docs: 'convert-with-chromium/convert-html-to-pdf',
    input: 'html',
    fields: chromePdf,
    output: 'pdf',
    featured: true,
  },
  {
    id: 'markdown-pdf',
    title: 'Markdown to PDF',
    group: 'Convert',
    summary: 'Convert Markdown using a matching HTML template.',
    path: '/forms/chromium/convert/markdown',
    docs: 'convert-with-chromium/convert-markdown-to-pdf',
    input: 'markdown',
    fields: chromePdf,
    output: 'pdf',
  },
  {
    id: 'office-pdf',
    title: 'Office to PDF',
    group: 'Convert',
    summary: 'Convert documents, spreadsheets and presentations.',
    path: '/forms/libreoffice/convert',
    docs: 'convert-with-libreoffice/convert-to-pdf',
    input: 'office',
    multiple: true,
    fields: [
      { name: 'landscape', label: 'Landscape orientation', kind: 'toggle' },
      { name: 'singlePageSheets', label: 'Single page per sheet', kind: 'toggle' },
      { name: 'skipEmptyPages', label: 'Skip blank pages', kind: 'toggle', advanced: true },
      { name: 'exportNotes', label: 'Export presentation notes', kind: 'toggle', advanced: true },
      pdfa,
      pdfua,
    ],
    output: 'pdf',
    featured: true,
  },
  {
    id: 'url-shot',
    title: 'Website screenshot',
    group: 'Capture',
    summary: 'Capture a website as PNG, JPEG or WebP.',
    path: '/forms/chromium/screenshot/url',
    docs: 'convert-with-chromium/screenshot-url',
    input: 'url',
    fields: [sourceUrl, ...screenshot],
    output: 'image',
    featured: true,
  },
  {
    id: 'html-shot',
    title: 'HTML screenshot',
    group: 'Capture',
    summary: 'Capture rendered HTML at any viewport size.',
    path: '/forms/chromium/screenshot/html',
    docs: 'convert-with-chromium/screenshot-html',
    input: 'html',
    fields: screenshot,
    output: 'image',
  },
  {
    id: 'markdown-shot',
    title: 'Markdown screenshot',
    group: 'Capture',
    summary: 'Capture a Markdown document as an image.',
    path: '/forms/chromium/screenshot/markdown',
    docs: 'convert-with-chromium/screenshot-markdown',
    input: 'markdown',
    fields: screenshot,
    output: 'image',
  },
  {
    id: 'merge',
    title: 'Merge PDFs',
    group: 'PDF tools',
    summary: 'Combine PDFs in the order they are uploaded.',
    path: '/forms/pdfengines/merge',
    docs: 'manipulate-pdfs/merge-pdfs',
    ...pdfFiles,
    fields: [
      { name: 'autoIndexBookmarks', label: 'Keep document bookmarks', kind: 'toggle' },
      {
        name: 'titleBookmarks',
        label: 'Add bookmarks from titles',
        kind: 'toggle',
        advanced: true,
      },
    ],
    output: 'pdf',
    featured: true,
  },
  {
    id: 'split',
    title: 'Split PDFs',
    group: 'PDF tools',
    summary: 'Extract page ranges or split into intervals.',
    path: '/forms/pdfengines/split',
    docs: 'manipulate-pdfs/split-pdfs',
    ...pdfFiles,
    fields: [
      {
        name: 'splitMode',
        label: 'Split mode',
        kind: 'select',
        options: ['pages', 'intervals'],
        defaultValue: 'pages',
        required: true,
      },
      {
        name: 'splitSpan',
        label: 'Page range or interval',
        kind: 'text',
        placeholder: '1-3,5 or 2',
        required: true,
      },
      { name: 'splitUnify', label: 'Unify extracted ranges', kind: 'toggle' },
    ],
    output: 'zip',
  },
  {
    id: 'pdfa',
    title: 'PDF/A & PDF/UA',
    group: 'PDF tools',
    summary: 'Make PDFs archival or accessibility compliant.',
    path: '/forms/pdfengines/convert',
    docs: 'manipulate-pdfs/pdfa-pdfua',
    ...pdfFiles,
    fields: [
      { ...pdfa, advanced: false },
      { ...pdfua, advanced: false },
    ],
    output: 'pdf',
  },
  {
    id: 'optimize',
    title: 'Optimize PDFs',
    group: 'PDF tools',
    summary: 'Reduce PDF sizes with image optimization.',
    path: '/forms/pdfengines/optimize',
    docs: 'manipulate-pdfs/optimize-pdfs',
    ...pdfFiles,
    fields: [
      {
        name: 'imageQuality',
        label: 'Image quality',
        kind: 'number',
        min: 1,
        max: 100,
        placeholder: '80',
      },
    ],
    output: 'pdf',
  },
  {
    id: 'rotate',
    title: 'Rotate PDF pages',
    group: 'PDF tools',
    summary: 'Rotate all or selected pages.',
    path: '/forms/pdfengines/rotate',
    docs: 'manipulate-pdfs/rotate-pdfs',
    ...pdfFiles,
    fields: [
      {
        name: 'rotateAngle',
        label: 'Rotation',
        kind: 'select',
        options: ['90', '180', '270'],
        required: true,
        defaultValue: '90',
      },
      { name: 'rotatePages', label: 'Pages to rotate', kind: 'text', placeholder: 'All pages' },
    ],
    output: 'pdf',
  },
  {
    id: 'flatten',
    title: 'Flatten PDFs',
    group: 'PDF tools',
    summary: 'Flatten interactive fields and annotations.',
    path: '/forms/pdfengines/flatten',
    docs: 'manipulate-pdfs/flatten-pdfs',
    ...pdfFiles,
    fields: noFields,
    output: 'pdf',
  },
  {
    id: 'encrypt',
    title: 'Encrypt PDFs',
    group: 'PDF tools',
    summary: 'Protect PDF content with passwords and permissions.',
    path: '/forms/pdfengines/encrypt',
    docs: 'manipulate-pdfs/encrypt-pdfs',
    ...pdfFiles,
    fields: [
      { name: 'userPassword', label: 'Open password', kind: 'password' },
      { name: 'ownerPassword', label: 'Owner password', kind: 'password' },
      {
        name: 'allowPrinting',
        label: 'Allow printing',
        kind: 'toggle',
        defaultValue: true,
        advanced: true,
      },
      {
        name: 'allowCopying',
        label: 'Allow copying',
        kind: 'toggle',
        defaultValue: true,
        advanced: true,
      },
      {
        name: 'allowModifying',
        label: 'Allow editing',
        kind: 'toggle',
        defaultValue: true,
        advanced: true,
      },
    ],
    output: 'pdf',
  },
  {
    id: 'watermark',
    title: 'Watermark PDFs',
    group: 'PDF tools',
    summary: 'Add text, an image or a PDF behind pages.',
    path: '/forms/pdfengines/watermark',
    docs: 'manipulate-pdfs/watermark-pdfs',
    ...pdfFiles,
    fields: [
      {
        name: 'watermarkSource',
        label: 'Source',
        kind: 'select',
        options: ['text', 'image', 'pdf'],
        required: true,
        defaultValue: 'text',
      },
      {
        name: 'watermarkExpression',
        label: 'Text or uploaded filename',
        kind: 'text',
        placeholder: 'CONFIDENTIAL',
        required: true,
      },
      {
        name: 'watermarkPages',
        label: 'Pages',
        kind: 'text',
        placeholder: 'All pages',
        advanced: true,
      },
      {
        name: 'watermarkOptions',
        label: 'Options JSON',
        kind: 'json',
        placeholder: '{"opacity":0.25,"rotation":45}',
        advanced: true,
      },
    ],
    auxiliary: {
      name: 'watermark',
      label: 'Watermark image or PDF',
      description: 'Needed for image/PDF sources.',
      accept: 'image/*,.pdf',
    },
    output: 'pdf',
  },
  {
    id: 'stamp',
    title: 'Stamp PDFs',
    group: 'PDF tools',
    summary: 'Place text or artwork on top of document pages.',
    path: '/forms/pdfengines/stamp',
    docs: 'manipulate-pdfs/stamp-pdfs',
    ...pdfFiles,
    fields: [
      {
        name: 'stampSource',
        label: 'Source',
        kind: 'select',
        options: ['text', 'image', 'pdf'],
        required: true,
        defaultValue: 'text',
      },
      {
        name: 'stampExpression',
        label: 'Text or uploaded filename',
        kind: 'text',
        placeholder: 'APPROVED',
        required: true,
      },
      {
        name: 'stampPages',
        label: 'Pages',
        kind: 'text',
        placeholder: 'All pages',
        advanced: true,
      },
      {
        name: 'stampOptions',
        label: 'Options JSON',
        kind: 'json',
        placeholder: '{"opacity":0.5,"rotation":0}',
        advanced: true,
      },
    ],
    auxiliary: {
      name: 'stamp',
      label: 'Stamp image or PDF',
      description: 'Needed for image/PDF sources.',
      accept: 'image/*,.pdf',
    },
    output: 'pdf',
  },
  {
    id: 'metadata-read',
    title: 'Read metadata',
    group: 'PDF tools',
    summary: 'Inspect PDF metadata as JSON.',
    path: '/forms/pdfengines/metadata/read',
    docs: 'manipulate-pdfs/read-metadata',
    ...pdfFiles,
    fields: noFields,
    output: 'json',
  },
  {
    id: 'metadata-write',
    title: 'Write metadata',
    group: 'PDF tools',
    summary: 'Set author, title, keywords and more.',
    path: '/forms/pdfengines/metadata/write',
    docs: 'manipulate-pdfs/write-metadata',
    ...pdfFiles,
    fields: [
      {
        name: 'metadata',
        label: 'Metadata JSON',
        kind: 'json',
        required: true,
        defaultValue: '{"Author":"Gotenui"}',
      },
    ],
    output: 'pdf',
  },
  {
    id: 'bookmarks-read',
    title: 'Read bookmarks',
    group: 'PDF tools',
    summary: 'Export bookmark trees as JSON.',
    path: '/forms/pdfengines/bookmarks/read',
    docs: 'manipulate-pdfs/read-bookmarks',
    ...pdfFiles,
    fields: noFields,
    output: 'json',
  },
  {
    id: 'bookmarks-write',
    title: 'Write bookmarks',
    group: 'PDF tools',
    summary: 'Replace document bookmarks from JSON.',
    path: '/forms/pdfengines/bookmarks/write',
    docs: 'manipulate-pdfs/write-bookmarks',
    ...pdfFiles,
    fields: [
      {
        name: 'bookmarks',
        label: 'Bookmarks JSON',
        kind: 'json',
        required: true,
        defaultValue: '[{"title":"Chapter 1","page":1,"children":[]}]',
      },
    ],
    output: 'pdf',
  },
  {
    id: 'embed',
    title: 'Embed attachments',
    group: 'PDF tools',
    summary: 'Attach files within a PDF.',
    path: '/forms/pdfengines/embed',
    docs: 'manipulate-pdfs/attachments',
    ...pdfFiles,
    fields: [
      { name: 'embedsMetadata', label: 'Attachment metadata JSON', kind: 'json', advanced: true },
    ],
    auxiliary: {
      name: 'embeds',
      label: 'Attachments to embed',
      description: 'Choose one or more files to embed.',
      multiple: true,
      required: true,
    },
    output: 'pdf',
  },
  {
    id: 'factur-x',
    title: 'Factur-X invoices',
    group: 'PDF tools',
    summary: 'Attach compliant CII invoice XML to a PDF.',
    path: '/forms/pdfengines/factur-x',
    docs: 'manipulate-pdfs/factur-x',
    ...pdfFiles,
    fields: [
      {
        name: 'facturxConformanceLevel',
        label: 'Conformance level',
        kind: 'select',
        options: ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'],
        defaultValue: 'EN 16931',
        required: true,
      },
      {
        name: 'facturxDocumentType',
        label: 'Document type',
        kind: 'select',
        options: ['INVOICE', 'ORDER', 'ORDER_RESPONSE', 'ORDER_CHANGE'],
        advanced: true,
      },
      {
        name: 'facturxVersion',
        label: 'Factur-X version',
        kind: 'text',
        placeholder: '1.0',
        advanced: true,
      },
      { ...pdfa, options: ['PDF/A-3a', 'PDF/A-3b', 'PDF/A-3u'] },
      pdfua,
    ],
    auxiliary: {
      name: 'facturxXml',
      label: 'Factur-X invoice XML',
      description: 'Upload CII-format invoice XML.',
      accept: '.xml',
      required: true,
    },
    output: 'pdf',
  },
]

export const OPERATION_BY_ID = new Map(OPERATIONS.map((operation) => [operation.id, operation]))
export const GROUPS: readonly OperationGroup[] = ['Convert', 'Capture', 'PDF tools']

export function operationDefaults(operation: Operation): Record<string, string | boolean> {
  return Object.fromEntries(
    operation.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.name, field.defaultValue]),
  )
}
