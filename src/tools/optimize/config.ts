/** Definition for the optimize Gotenberg operation. */
import { pdfFiles, v9DropSignatures } from '#/tools/shared/fields'
import type { Operation } from '#/tools/types'

export const operation: Operation = {
  id: 'optimize',
  supportedGotenbergMajors: [8, 9],
  title: 'Optimize PDFs',
  group: 'PDF tools',
  summary:
    'Optimize PDF files. Gotenberg 9 uses lossless optimization; Gotenberg 8 offers an image-quality slider.',
  path: '/forms/pdfengines/optimize',
  docs: 'manipulate-pdfs/optimize-pdfs',
  ...pdfFiles,
  fields: [
    v9DropSignatures,
    {
      name: 'imageQuality',
      supportedGotenbergMajors: [8],
      label: 'Image quality',
      kind: 'number',
      min: 1,
      max: 100,
      placeholder: '80',
    },
    ...(
      [
        [
          'v9ObjectStreams',
          'PDF object streams',
          'Compress eligible PDF objects into object streams.',
        ],
        ['v9Dedup', 'Deduplicate resources', 'Reuse duplicate objects across the document.'],
        [
          'v9RecompressImages',
          'Recompress images',
          'Losslessly recompress images without changing their quality.',
        ],
        ['v9SubsetFonts', 'Subset fonts', 'Keep only the glyphs used in embedded fonts.'],
        [
          'v9CompressStreams',
          'Compress streams',
          'Compress uncompressed PDF streams such as page content and fonts (Gotenberg 9.9+).',
        ],
      ] as const
    ).map(([name, label, description]) => ({
      name,
      label,
      description: `${description} Gotenberg 9 enables this by default.`,
      kind: 'select' as const,
      options: ['enabled', 'disabled'],
      optionLabels: { enabled: 'Enabled', disabled: 'Disabled' },
      supportedGotenbergMajors: [9] as const,
      ...(name === 'v9CompressStreams' ? { minGotenbergMinor: 9 } : {}),
      advanced: true,
    })),
  ],
  output: 'pdf',
}
