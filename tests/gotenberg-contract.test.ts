import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { CHROMIUM_MEDIA_OPTIONS } from '#/lib/chromium-media'
import { createGotenbergForm } from '#/lib/gotenberg-client'
import { chromiumNames, officeNames } from '#/lib/gotenberg-conversion-adapter'
import { OPERATION_BY_ID, operationDefaults } from '#/lib/operations'
import { PDF_PIPELINE_STAGES } from '#/lib/pdf-pipeline'
import { V9_REMEDIATION_FIELD_NAMES } from '#/lib/pdf-remediation-options'

// Multipart bindings in Gotenberg v9.10.0's Chromium and LibreOffice routes.
// Transport fields (files, downloadFrom, ZIPs and stages) have separate tests.
const commonChromium = [
  'cookies',
  'emulatedMediaFeatures',
  'emulatedMediaType',
  'extraHttpHeaders',
  'failOnConsoleExceptions',
  'failOnConsoleMessageTypes',
  'failOnHttpStatusCodes',
  'failOnResourceHttpStatusCodes',
  'failOnResourceLoadingFailed',
  'ignoreResourceHttpStatusDomains',
  'omitBackground',
  'skipNetworkAlmostIdleEvent',
  'skipNetworkIdleEvent',
  'userAgent',
  'waitDelay',
  'waitForExpression',
  'waitForSelector',
  'waitForWindowStatus',
]
const chromiumPdf = [
  'footer.html',
  'header.html',
  'landscape',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'nativeBookmarks',
  'nativePages',
  'nativeTaggedPdf',
  'paperHeight',
  'paperSize',
  'paperWidth',
  'preferCssPageSize',
  'printBackground',
  'scale',
  'singlePage',
]
const screenshot = [
  'clip',
  'deviceScaleFactor',
  'format',
  'height',
  'optimizeForSpeed',
  'quality',
  'selector',
  'width',
]
const office = [
  'addOriginalDocumentAsStream',
  'allowDuplicateFieldNames',
  'centerWindow',
  'convertOooTargetToPdfTarget',
  'displayPDFDocumentTitle',
  'exportBookmarksToPdfDestination',
  'exportFormFields',
  'exportHiddenSlides',
  'exportLinksRelativeFsys',
  'exportNotes',
  'exportNotesInMargin',
  'exportNotesPages',
  'exportOnlyNotesPages',
  'exportPlaceholders',
  'hideViewerMenubar',
  'hideViewerToolbar',
  'hideViewerWindowControls',
  'initialPage',
  'initialView',
  'landscape',
  'locale',
  'magnification',
  'nativeBookmarks',
  'nativeLosslessImageCompression',
  'nativeMaxImageResolution',
  'nativePages',
  'nativePdfa',
  'nativePdfua',
  'nativeQuality',
  'nativeReduceImageResolution',
  'nativeTaggedPdf',
  'nativeTiledWatermarkText',
  'nativeWatermarkColor',
  'nativeWatermarkFont',
  'nativeWatermarkFontSize',
  'nativeWatermarkRotation',
  'nativeWatermarkText',
  'openBookmarkLevels',
  'openInFullScreenMode',
  'pageLayout',
  'paperHeight',
  'paperSize',
  'paperWidth',
  'password',
  'resizeWindowToInitialPage',
  'showTrackedChanges',
  'singlePage',
  'skipEmptyPages',
  'updateIndexes',
  'useTransitionEffects',
  'zoom',
]

const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const mediaFields = new Set<string>(CHROMIUM_MEDIA_OPTIONS.map(({ name }) => name))
const stageControls = new Set<string>([
  'merge',
  'splitMode',
  'splitSpan',
  'splitUnify',
  'pdfaProfile',
  'pdfuaProfile',
  'pdfaMethod',
  ...V9_REMEDIATION_FIELD_NAMES,
])
function operation(id: string) {
  const found = OPERATION_BY_ID.get(id)
  assert.ok(found, id)
  return found
}

test('every v9 conversion route exposes the pinned native multipart options', () => {
  for (const id of [
    'url-pdf',
    'html-pdf',
    'markdown-pdf',
    'url-shot',
    'html-shot',
    'markdown-shot',
    'office-pdf',
  ]) {
    const spec = operation(id)
    const isOffice = id === 'office-pdf'
    const names: Readonly<Record<string, string>> = isOffice ? officeNames : chromiumNames
    const fields = spec.fields
      .filter(
        (field) =>
          (!field.supportedGotenbergMajors || field.supportedGotenbergMajors.includes(9)) &&
          !stageControls.has(field.name),
      )
      .map(({ name }) => (mediaFields.has(name) ? 'emulatedMediaFeatures' : (names[name] ?? name)))
    if (isOffice) {
      assert.ok(spec.fields.some(({ name }) => name === 'pdfaProfile'))
      assert.ok(spec.fields.some(({ name }) => name === 'pdfuaProfile'))
      fields.push('nativePdfa', 'nativePdfua')
    } else if (spec.output === 'pdf') {
      // Header and footer are dedicated HTML editors rather than scalar fields.
      fields.push('header.html', 'footer.html')
    }
    const expected = isOffice
      ? office
      : [
          ...commonChromium,
          ...(spec.output === 'pdf' ? chromiumPdf : screenshot),
          ...(spec.input === 'url' ? ['url'] : []),
        ]
    assert.deepEqual(sorted(fields), sorted(expected), id)
  }
})

test('untouched screenshot, network and Office toggle defaults agree with Gotenberg', () => {
  for (const id of ['url-shot', 'html-shot', 'markdown-shot']) {
    const spec = operation(id)
    const fields = operationDefaults(spec)
    assert.deepEqual(fields, {
      width: '800',
      height: '600',
      format: 'png',
      skipNetworkIdleEvent: true,
      skipNetworkAlmostIdleEvent: true,
    })
    const form = createGotenbergForm(
      spec,
      {
        operation: id,
        fields: { ...fields, ...(id === 'url-shot' ? { url: 'https://example.test' } : {}) },
        advanced: {},
        ...(id !== 'url-shot' ? { source: 'Example' } : {}),
      },
      [],
      [],
      undefined,
      {},
      [],
      9,
      { major: 9, minor: 10, patch: 0 },
    )
    for (const name of [
      'quality',
      'deviceScaleFactor',
      'failOnHttpStatusCodes',
      'failOnResourceHttpStatusCodes',
    ])
      assert.equal(form.has(name), false, name)
  }
  const defaults = operationDefaults(operation('office-pdf'))
  for (const name of [
    'updateIndexes',
    'exportFormFields',
    'exportBookmarks',
    'displayPDFDocumentTitle',
    'useTransitionEffects',
  ])
    assert.equal(defaults[name], true, name)
  assert.equal(defaults.showTrackedChanges, undefined)
})

function goFunction(source: string, name: string): string {
  const match = new RegExp(`^func ${name}\\([^]*?^}`, 'm').exec(source)
  assert.ok(match, `Missing Go function ${name}`)
  return match[0]
}
function boundFields(source: string): string[] {
  return sorted([
    ...Array.from(
      source.matchAll(/\b(?:Bool|Int|Float64|String|Custom|PaperSize|Inches|Content)\("([^"]+)"/g),
      (match) => match[1],
    ),
    ...Array.from(source.matchAll(/api\.JSON\(form, "([^"]+)"/g), (match) => match[1]),
  ])
}

// CI checks out the exact backend release. Local runs can point at the supplied
// source archive with GOTENBERG_SOURCE_DIR, without network or Docker access.
const sourceDir = process.env.GOTENBERG_SOURCE_DIR
if (sourceDir) {
  const read = (path: string) => readFileSync(join(sourceDir, 'pkg/modules', path), 'utf8')
  test('native multipart contract matches the actual upstream Go bindings', () => {
    const chromium = read('chromium/routes.go')
    assert.deepEqual(
      boundFields(goFunction(chromium, 'FormDataChromiumOptions')),
      sorted(commonChromium),
    )
    assert.deepEqual(
      boundFields(goFunction(chromium, 'FormDataChromiumPdfOptions')),
      sorted(chromiumPdf),
    )
    assert.deepEqual(
      boundFields(goFunction(chromium, 'FormDataChromiumScreenshotOptions')),
      sorted(screenshot),
    )
    assert.deepEqual(
      boundFields(
        goFunction(read('libreoffice/routes.go'), 'convertRoute').split('.RejectUnknown')[0],
      ),
      sorted(office),
    )
  })
  test('all PDF stage names and top-level JSON fields match the actual upstream stage types', () => {
    const upstream = read('pdf/stages.go')
    const types = read('pdf/stage_types.go')
    const stageMap = Object.fromEntries(
      Array.from(
        upstream.matchAll(/"([a-z-]+)":\s*func\(\) stage \{ return new\((\w+)\) \}/g),
        ([, op, name]) => {
          const match = new RegExp(
            `^type ${name} struct\\{\\}|^type ${name} struct\\s*\\{([^]*?)^\\}`,
            'm',
          ).exec(types)
          assert.ok(match, name)
          const body = match[1] ?? ''
          return [
            op,
            sorted([
              ...Array.from(body.matchAll(/json:"([^",]+)(?:,[^"]*)?"/g), (tag) => tag[1]),
              ...(/^\s*signatureDrop\s*$/m.test(body) ? ['dropSignatures'] : []),
            ]),
          ]
        },
      ),
    )
    assert.ok(Object.keys(stageMap).length > 0)
    assert.deepEqual(
      Object.fromEntries(PDF_PIPELINE_STAGES.map(({ op, fields }) => [op, sorted(fields)])),
      stageMap,
    )
  })
  test('pinned defaults agree with the upstream option constructors', () => {
    const chromium = read('chromium/chromium.go')
    const screenshotDefaults = goFunction(chromium, 'DefaultScreenshotOptions')
    for (const [field, value] of Object.entries({
      Width: '800',
      Height: '600',
      Format: '"png"',
      Quality: '100',
      DeviceScaleFactor: '1.0',
    })) {
      assert.equal(
        new RegExp(`^\\s*${field}:\\s*([^,]+),`, 'm').exec(screenshotDefaults)?.[1],
        value,
      )
    }
    const common = goFunction(chromium, 'DefaultOptions')
    assert.match(common, /FailOnHttpStatusCodes:\s*\[\]int64\{499, 599\}/)
    assert.match(common, /FailOnResourceHttpStatusCodes:\s*nil,/)
    for (const field of ['SkipNetworkIdleEvent', 'SkipNetworkAlmostIdleEvent'])
      assert.match(common, new RegExp(`${field}:\\s*true,`))
    const officeDefaults = goFunction(read('libreoffice/api/api.go'), 'DefaultOptions')
    for (const field of [
      'UpdateIndexes',
      'ExportFormFields',
      'ExportBookmarks',
      'DisplayPDFDocumentTitle',
      'UseTransitionEffects',
    ])
      assert.match(officeDefaults, new RegExp(`${field}:\\s*true,`))
    assert.match(officeDefaults, /ShowTrackedChanges:\s*false,/)
  })
}
