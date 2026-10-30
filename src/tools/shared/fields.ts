/** Shared Gotenberg field groups - compose these within individual tool configurations. */
import { CHROMIUM_MEDIA_OPTIONS } from '#/lib/chromium-media'
import type { FieldDefinition } from '#/tools/types'

export const pdfa: FieldDefinition = {
  name: 'pdfa',
  label: 'PDF/A standard',
  kind: 'select',
  options: ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b', 'PDF/A-4'],
  advanced: true,
  description: 'PDF/A-4 requires Gotenberg 8.39+ and the LibreOffice PDF engine.',
}

export const pdfMetadata: FieldDefinition = {
  name: 'metadata',
  label: 'PDF metadata',
  kind: 'json',
  customEditor: true,
  advanced: true,
  description: 'Edit common XMP fields visually; use JSON for other writable tags.',
}

export const pdfBookmarks: FieldDefinition = {
  name: 'bookmarks',
  label: 'Custom PDF bookmarks',
  kind: 'json',
  customEditor: true,
  description: 'A shared tree or per-input filename maps (with automatic page offsets).',
}

export const pdfua: FieldDefinition = {
  name: 'pdfua',
  label: 'Accessible PDF (PDF/UA)',
  kind: 'toggle',
  advanced: true,
}

export const chromiumWait: FieldDefinition[] = [
  {
    name: 'waitDelay',
    label: 'Wait before rendering',
    kind: 'text',
    placeholder: '2s',
    advanced: true,
    description:
      'Optional fallback delay. For dynamic pages prefer waiting for an element or JavaScript expression.',
  },
  {
    name: 'waitForSelector',
    label: 'Wait for CSS selector',
    kind: 'text',
    placeholder: '#app-ready',
    advanced: true,
    description: 'Render when this element appears in the page. Leave blank to disable.',
  },
  {
    name: 'waitForExpression',
    label: 'Wait for JavaScript expression',
    kind: 'text',
    placeholder: 'window.ready === true',
    advanced: true,
    description:
      'Render after this expression evaluates to true; expressions run in the target page.',
  },
  {
    name: 'userAgent',
    label: 'Browser User-Agent',
    kind: 'text',
    advanced: true,
    description: 'Overrides the User-Agent used by Chromium to fetch resources.',
  },
]

export const chromiumMedia: FieldDefinition[] = CHROMIUM_MEDIA_OPTIONS.map(
  ({ name, label, options, description }) => ({
    name,
    label,
    kind: 'select',
    options,
    description,
    section: 'rendering',
  }),
)

export const chromiumNetwork: FieldDefinition[] = [
  { name: 'cookies', label: 'Browser cookies', kind: 'json', advanced: true, customEditor: true },
  {
    name: 'extraHttpHeaders',
    label: 'Browser resource headers',
    kind: 'json',
    advanced: true,
    customEditor: true,
  },
]

export const optimizeImages: FieldDefinition[] = [
  {
    name: 'optimizeImages',
    label: 'Optimize PDF images',
    kind: 'toggle',
    section: 'compression',
    description:
      'Re-encode eligible raster images as JPEG during PDF post-processing (Gotenberg 8.36+).',
  },
  {
    name: 'imageQuality',
    label: 'Optimized JPEG quality',
    kind: 'number',
    integer: true,
    min: 1,
    max: 100,
    placeholder: '80 (default)',
    section: 'compression',
    when: { name: 'optimizeImages', equals: true },
  },
]

export const officeCompression: FieldDefinition[] = [
  {
    name: 'losslessImageCompression',
    label: 'Use lossless PNG compression',
    kind: 'toggle',
    section: 'compression',
    description:
      'Preserve image detail, potentially at the cost of a larger PDF. JPEG is the default.',
  },
  {
    name: 'quality',
    label: 'LibreOffice JPEG quality',
    kind: 'number',
    integer: true,
    min: 1,
    max: 100,
    placeholder: '90 (default)',
    section: 'compression',
    description:
      'Applies to the initial Office PDF export, not the separate PDF optimization pass.',
    when: { name: 'losslessImageCompression', equals: false },
  },
  {
    name: 'reduceImageResolution',
    label: 'Reduce embedded image resolution',
    kind: 'toggle',
    section: 'compression',
  },
  {
    name: 'maxImageResolution',
    label: 'Target resolution (DPI)',
    kind: 'select',
    options: ['75', '150', '300', '600', '1200'],
    section: 'compression',
    description: 'LibreOffice downsamples images above this resolution; default 300 DPI.',
    when: { name: 'reduceImageResolution', equals: true },
  },
]

export const officeOutput: FieldDefinition[] = [
  {
    name: 'merge',
    label: 'Merge converted documents into one PDF',
    kind: 'toggle',
    section: 'processing',
    description:
      'Use file arrows to reorder local documents; remote files follow Gotenberg filename sorting. Without merging, multiple documents yield a ZIP.',
  },
  {
    name: 'splitMode',
    label: 'Split output',
    kind: 'select',
    options: ['pages', 'intervals'],
    optionLabels: { pages: 'Page ranges', intervals: 'Fixed page intervals' },
    section: 'processing',
  },
  {
    name: 'splitSpan',
    label: 'Page range or interval',
    kind: 'text',
    placeholder: '1-3,5 or 2',
    description:
      'Page-range syntax depends on the configured PDF engine; intervals must be positive integers.',
    section: 'processing',
    when: { name: 'splitMode', equals: 'pages' },
    // Visible for intervals as well; conditional presentation is handled by isFieldVisible.
  },
  {
    name: 'splitUnify',
    label: 'Combine selected page ranges in one file',
    kind: 'toggle',
    section: 'processing',
    when: { name: 'splitMode', equals: 'pages' },
  },
]

export const chromiumReliability: FieldDefinition[] = [
  {
    name: 'failOnHttpStatusCodes',
    label: 'Fail on page HTTP statuses',
    kind: 'http-codes',
    section: 'reliability',
    placeholder: '499, 599 (default)',
    description: 'Comma-separated HTTP codes; 499 and 599 mean any 4xx or 5xx response.',
  },
  {
    name: 'failOnResourceHttpStatusCodes',
    label: 'Fail on asset HTTP statuses',
    kind: 'http-codes',
    section: 'reliability',
    placeholder: 'e.g. 404, 499, 599',
    description: 'Fail if images, scripts or stylesheets return one of these codes.',
  },
  {
    name: 'ignoreResourceHttpStatusDomains',
    label: 'Exclude asset domains',
    kind: 'hostnames',
    section: 'reliability',
    placeholder: 'e.g. analytics.example.com, cdn.example.com',
    when: { name: 'failOnResourceHttpStatusCodes', equals: '' },
    description: 'Comma-separated hostnames excluded from asset HTTP status checks.',
  },
  {
    name: 'failOnResourceLoadingFailed',
    label: 'Fail when a page resource cannot load',
    kind: 'toggle',
    section: 'reliability',
  },
  {
    name: 'failOnConsoleExceptions',
    label: 'Fail on browser console exceptions',
    kind: 'toggle',
    section: 'reliability',
  },
  {
    name: 'failOnConsoleMessageTypes',
    label: 'Fail on console message types',
    kind: 'console-message-types',
    section: 'reliability',
    minGotenbergMinor: 39,
    description:
      'Fail with HTTP 409 when page JavaScript logs a selected message type (Gotenberg 8.39+). This does not include resource-loading failures.',
  },
  {
    name: 'skipNetworkIdleEvent',
    label: 'Skip waiting for zero active connections',
    kind: 'toggle',
    defaultValue: true,
    section: 'reliability',
    description: 'Gotenberg default: enabled. Disable to wait until network activity settles.',
  },
  {
    name: 'skipNetworkAlmostIdleEvent',
    label: 'Skip waiting for almost idle network',
    kind: 'toggle',
    defaultValue: true,
    section: 'reliability',
    description: 'Gotenberg default: enabled. Disable to wait for two or fewer connections.',
  },
]

export const chromePdf: FieldDefinition[] = [
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
  {
    name: 'omitBackground',
    label: 'Allow transparent page background',
    kind: 'toggle',
    advanced: true,
    description:
      'Remove the default white canvas; combine with Print background graphics for CSS colours.',
  },
  {
    name: 'singlePage',
    label: 'Fit content on one long page',
    kind: 'toggle',
    advanced: true,
    description: 'Overrides paper height and PDF page-range settings.',
  },
  {
    name: 'preferCssPageSize',
    label: 'Prefer CSS @page size',
    kind: 'toggle',
    advanced: true,
    description:
      'Use the page dimensions defined by the document instead of Gotenberg paper settings.',
  },
  {
    name: 'generateTaggedPdf',
    label: 'Generate accessible structure tags',
    kind: 'toggle',
    advanced: true,
    description: 'Include logical document structure for assistive technologies.',
  },
  {
    name: 'generateDocumentOutline',
    label: 'Create PDF outline from headings',
    kind: 'toggle',
    advanced: true,
    description: 'Create bookmarks from headings; Gotenberg also enables tagged PDF output.',
  },
  { name: 'marginTop', label: 'Top margin', kind: 'text', advanced: true },
  { name: 'marginRight', label: 'Right margin', kind: 'text', advanced: true },
  { name: 'marginBottom', label: 'Bottom margin', kind: 'text', advanced: true },
  { name: 'marginLeft', label: 'Left margin', kind: 'text', advanced: true },
  {
    name: 'nativePageRanges',
    label: 'Print only selected pages',
    kind: 'text',
    advanced: true,
    placeholder: '1-3,5',
    description: 'Chromium prints only these pages; ignored when fitting content on one long page.',
  },
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
  ...chromiumWait,
  ...chromiumNetwork,
  ...chromiumMedia,
  ...chromiumReliability,
  ...optimizeImages,
  { ...pdfa },
  { ...pdfua },
]

export const screenshot: FieldDefinition[] = [
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
  {
    name: 'optimizeForSpeed',
    label: 'Prefer faster image encoding',
    kind: 'toggle',
    advanced: true,
    description: 'Encode screenshots faster, potentially producing larger image files.',
  },
  { name: 'clip', label: 'Clip to viewport', kind: 'toggle', advanced: true },
  { name: 'selector', label: 'CSS selector', kind: 'text', advanced: true },
  { name: 'omitBackground', label: 'Transparent background', kind: 'toggle', advanced: true },
  ...chromiumWait,
  ...chromiumNetwork,
  ...chromiumMedia,
  ...chromiumReliability,
]

export const sourceUrl: FieldDefinition = {
  name: 'url',
  label: 'Website URL',
  kind: 'url',
  placeholder: 'https://example.com',
  required: true,
}

export const pdfFiles = { input: 'pdf' as const, multiple: true }

export const noFields: FieldDefinition[] = []
