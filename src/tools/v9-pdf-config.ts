/** Gotenberg 9-only PDF tools. v8 tools remain in their original configurations. */
import type { FieldDefinition, Operation } from '#/tools/types'

const pages: FieldDefinition = {
  name: 'pages',
  label: 'Pages',
  kind: 'text',
  placeholder: '1-3, 3-, -3, !1, odd,!last or all',
  required: true,
  description: 'One-based page selection. Exclusions (!) and open ranges require Gotenberg 9.2+.',
}
const password: FieldDefinition = {
  name: 'password',
  label: 'PDF password',
  kind: 'password',
  description: 'Required only when inspecting an encrypted PDF.',
  advanced: true,
}
const profile: FieldDefinition = {
  name: 'profile',
  label: 'Compliance profile',
  kind: 'select',
  required: true,
  defaultValue: 'PDF/A-2b',
  options: [
    'PDF/A-1a',
    'PDF/A-1b',
    'PDF/A-2a',
    'PDF/A-2b',
    'PDF/A-2u',
    'PDF/A-3a',
    'PDF/A-3b',
    'PDF/A-3u',
    'PDF/A-4',
    'PDF/A-4e',
    'PDF/A-4f',
    'PDF/UA-1',
    'PDF/UA-2',
    'Factur-X',
  ],
}
const pdfRead = { input: 'pdf' as const, multiple: true, output: 'json' as const }
const pdfEdit = { input: 'pdf' as const, multiple: true, output: 'pdf' as const }
const version = { supportedGotenbergMajors: [9] as const, group: 'PDF tools' as const }
const tool = (
  id: string,
  title: string,
  summary: string,
  fields: readonly FieldDefinition[],
  options: Partial<Operation> = {},
): Operation => ({
  id,
  title,
  summary,
  ...version,
  ...pdfEdit,
  path: '/forms/pdf/pipe',
  docs: 'manipulate-pdfs',
  fields,
  ...options,
})

export const V9_PDF_OPERATIONS: readonly Operation[] = [
  tool(
    'compose-pages',
    'Compose PDF pages',
    'Arrange pages from uploaded PDFs on new sheets, labels or packing slips (Gotenberg 9.2+).',
    [
      {
        name: 'paperSize',
        label: 'Paper size',
        kind: 'select',
        defaultValue: 'A4',
        options: ['A3', 'A4', 'A5', 'B4', 'B5', 'Letter', 'Legal', 'Tabloid'],
        description: 'Use a named page size, or clear it and enter both custom dimensions.',
      },
      {
        name: 'paperWidth',
        label: 'Custom paper width',
        kind: 'text',
        placeholder: '6in or 432pt',
        description: 'Optional. Overrides the selected paper size width.',
      },
      {
        name: 'paperHeight',
        label: 'Custom paper height',
        kind: 'text',
        placeholder: '5in or 360pt',
        description: 'Optional. Overrides the selected paper size height.',
      },
      {
        name: 'placements',
        label: 'Page placements (JSON)',
        kind: 'json',
        required: true,
        defaultValue: '[{"sourcePage":1,"page":1,"x":0,"y":0}]',
        description:
          'Each placement accepts source, sourcePage, page, x, y, scale and rotation. Coordinates are PDF points. sourcePage and page are one-based: page 2 creates the second output sheet, not page 1. Gotenberg also treats 0 as the first page. Name each source when uploading multiple PDFs, and place every input at least once. Source annotations, fields, bookmarks, tags and metadata are not copied.',
      },
    ],
    { path: '/forms/pdf/compose' },
  ),
  tool(
    'pdf-info',
    'PDF information',
    'Inspect page count, version, encryption and tagging.',
    [password],
    {
      ...pdfRead,
      path: '/forms/pdf/info',
    },
  ),
  tool(
    'pdf-validate',
    'Validate PDF',
    'Check PDF/A, PDF/UA or Factur-X conformance and inspect violations.',
    [
      profile,
      {
        name: 'additionalProfile',
        label: 'Additional PDF/UA profile',
        kind: 'select',
        options: ['PDF/UA-1', 'PDF/UA-2'],
        description: 'Optional. Must match the PDF version of the main PDF/A or Factur-X profile.',
      },
      password,
    ],
    { ...pdfRead, path: '/forms/pdf/validate' },
  ),
  tool(
    'pdf-attachments',
    'List attachments',
    'Inspect PDF-embedded attachments and filenames.',
    [password],
    {
      ...pdfRead,
      path: '/forms/pdf/attachments',
    },
  ),
  tool(
    'extract-attachments',
    'Extract PDF attachments',
    'Download embedded files from one or more PDFs, individually or as a ZIP.',
    [
      {
        name: 'name',
        label: 'Attachment filename (optional)',
        kind: 'text',
        description: 'Leave blank to extract all attachments, or enter an exact embedded filename.',
      },
    ],
    {
      path: '/forms/pdf/extract-attachments',
      output: 'file',
    },
  ),
  tool(
    'extract-text',
    'Extract PDF text',
    'Save page text as UTF-8 .txt files (multiple documents return a ZIP). No OCR.',
    [
      { ...pages, required: false },
      { name: 'invisible', label: 'Include invisible text', kind: 'toggle', advanced: true },
      {
        name: 'artifacts',
        label: 'Include header, footer and stamp artifacts',
        kind: 'toggle',
        advanced: true,
      },
      { name: 'annotations', label: 'Include annotation text', kind: 'toggle', advanced: true },
    ],
    {
      path: '/forms/pdf/extract-text',
      output: 'text',
    },
  ),
  tool(
    'pdf-form',
    'Read PDF forms',
    'Inspect interactive form fields, states and current values.',
    [{ ...pages, required: false, advanced: true }, password],
    { ...pdfRead, path: '/forms/pdf/form' },
  ),
  tool(
    'select-pages',
    'Select PDF pages',
    'Extract selected pages into a new PDF in the requested order.',
    [pages],
  ),
  tool('delete-pages', 'Delete PDF pages', 'Remove the specified pages from a PDF.', [pages]),
  tool(
    'insert-pages',
    'Insert PDF pages',
    'Insert pages from a second PDF at a given position.',
    [
      {
        name: 'at',
        label: 'Insert after page',
        kind: 'number',
        min: 0,
        integer: true,
        defaultValue: '0',
        description:
          '0 inserts before the first page. The position applies to each source document.',
      },
      {
        name: 'sourcePages',
        label: 'Inserted page selection',
        kind: 'text',
        placeholder: '1-3,5',
        description: 'Leave blank to insert all pages of the additional PDF.',
      },
    ],
    {
      auxiliary: {
        name: 'source',
        label: 'PDF containing pages to insert',
        description:
          'Exactly one additional PDF; Gotenberg reads PDF contents even if the filename lacks a .pdf extension. The filename must differ from all input documents.',
        required: true,
      },
    },
  ),
  tool('fill-form', 'Fill PDF form', 'Set named fields in an interactive PDF form.', [
    {
      name: 'formValues',
      label: 'Form values (JSON)',
      kind: 'json',
      required: true,
      placeholder: '{"Customer.Name":"Alice","Consent":"Yes"}',
      description:
        'A JSON object keyed by fully-qualified form names; values must be strings or arrays of strings.',
    },
  ]),
  tool(
    'flatten-transparency',
    'Flatten transparency',
    'Replace transparent PDF content with opaque content.',
    [],
  ),
  tool('convert-colors', 'Convert PDF colours', 'Convert PDF content to a target colour space.', [
    {
      name: 'target',
      label: 'Target colour space',
      kind: 'select',
      required: true,
      defaultValue: 'rgb',
      options: ['rgb', 'cmyk', 'gray', 'output-intent'],
      optionLabels: {
        rgb: 'RGB',
        cmyk: 'CMYK',
        gray: 'Grayscale',
        'output-intent': 'Document output intent',
      },
    },
  ]),
  tool('redact', 'Redact PDF', 'Permanently remove content inside specified rectangles.', [
    {
      name: 'regions',
      label: 'Redaction regions (JSON)',
      kind: 'json',
      required: true,
      placeholder: '[{"page":1,"x":72,"y":600,"width":200,"height":40}]',
      description:
        'Array of page rectangles, in PDF points from the bottom-left corner. x and y default to 0 when omitted. Review the result for unredacted information.',
    },
    {
      name: 'confirmRedaction',
      label: 'I understand redaction permanently removes content',
      kind: 'toggle',
      required: true,
      description:
        'Check coordinates on a copy. This operation is not equivalent to drawing an opaque box.',
    },
  ]),
  tool(
    'autotag',
    'Automatically tag PDF',
    'Infer an accessibility structure tree for an untagged PDF.',
    [],
  ),
  tool('detach', 'Remove PDF attachment', 'Detach one embedded file by its exact name.', [
    {
      name: 'attachmentName',
      label: 'Embedded filename',
      kind: 'text',
      required: true,
      description: 'Inspect embedded attachments first to obtain the exact name.',
    },
  ]),
  tool(
    'decrypt',
    'Decrypt PDF',
    'Remove encryption from a PDF, including owner-password-only documents.',
    [
      {
        ...password,
        required: false,
        advanced: false,
        description: 'Leave blank for PDFs protected only by an owner password.',
      },
    ],
  ),
  tool(
    'sign',
    'Digitally sign PDF',
    'Apply a certificate-backed digital signature to a PDF.',
    [
      {
        name: 'certificatePassword',
        label: 'PKCS#12 certificate password',
        kind: 'password',
        advanced: true,
      },
      { name: 'reason', label: 'Reason', kind: 'text', advanced: true },
      { name: 'location', label: 'Location', kind: 'text', advanced: true },
      { name: 'contactInfo', label: 'Contact', kind: 'text', advanced: true },
      { name: 'signerName', label: 'Signer name', kind: 'text', advanced: true },
      { name: 'pades', label: 'Create PAdES signature', kind: 'toggle', advanced: true },
      {
        name: 'timestampUrl',
        label: 'Optional RFC 3161 timestamp authority',
        kind: 'url',
        advanced: true,
      },
    ],
    {
      auxiliary: {
        name: 'certificate',
        label: 'Signing credentials',
        description:
          'Upload one PKCS#12 credential, or a PEM certificate and private key. File extensions are not required. Credentials are sent only to your selected Gotenberg server.',
        // Gotenberg reads the certificate bytes and does not require a filename extension.
        multiple: true,
        required: true,
      },
    },
  ),
  tool('timestamp', 'Timestamp PDF', 'Apply a document timestamp from an RFC 3161 authority.', [
    {
      name: 'timestampUrl',
      label: 'Timestamp authority URL',
      kind: 'url',
      required: true,
      description: 'The selected Gotenberg server must be able to reach this trusted authority.',
    },
  ]),
  tool(
    'render-pages',
    'Render PDF pages',
    'Export pages as PNG or JPEG images (multiple images produce a ZIP).',
    [
      { ...pages, required: false },
      {
        name: 'format',
        label: 'Image format',
        kind: 'select',
        required: true,
        defaultValue: 'png',
        options: ['png', 'jpeg'],
      },
      {
        name: 'dpi',
        label: 'Resolution (DPI)',
        kind: 'number',
        min: 1,
        integer: true,
        placeholder: 'Default Gotenberg DPI',
        description:
          'Higher DPI needs more memory. Gotenberg 9.3+ rejects pages above the server PDF_MAX_RENDER_PIXELS limit; lower DPI if this happens.',
        advanced: true,
      },
      {
        name: 'quality',
        label: 'JPEG quality',
        kind: 'number',
        min: 1,
        max: 100,
        integer: true,
        when: { name: 'format', equals: 'jpeg' },
        advanced: true,
      },
    ],
    { output: 'zip' },
  ),
]

export const V9_PDF_IDS = new Set(V9_PDF_OPERATIONS.map(({ id }) => id))
export const V9_PDF_READ_ROUTES = new Map(
  V9_PDF_OPERATIONS.filter(({ output }) => output === 'json').map(({ id, path }) => [id, path]),
)

export const V9_PDF_OPERATION_BY_ID = new Map(
  V9_PDF_OPERATIONS.map((operation) => [operation.id, operation]),
)

/** Ensure the per-tool modules and the catalogue share one verified definition. */
export function requireV9PdfOperation(id: string): Operation {
  const operation = V9_PDF_OPERATION_BY_ID.get(id)
  if (!operation) throw new Error(`Missing Gotenberg 9 tool definition: ${id}`)
  return operation
}
