import type { SupportedGotenbergMajor } from '#/lib/gotenberg-version'
import { parseGotenbergVersion } from '#/lib/gotenberg-version'

/** Gotenberg 8.40.0 LibreOffice conversion extensions (upstream Extensions() list). */
export const OFFICE_FORMAT_FAMILIES = {
  documents:
    '.doc .docx .docm .dot .dotm .dotx .odt .fodt .ott .rtf .txt .wps .wpd .pages .abw .zabw .lwp .mw .mcw .hwp .sxw .stw .sdw .sgl .vor .602 .bib .xml .cwk .psw .uof',
  spreadsheets:
    '.xls .xlsx .xlsm .xlsb .xlt .xltm .xltx .xlw .ods .fods .ots .csv .numbers .123 .wk1 .wks .wb2 .dbf .dif .slk .sxc .stc .uos .pxl .sdc',
  presentations:
    '.ppt .pptx .pptm .pot .potm .potx .pps .ppsx .ppsm .odp .fodp .otp .key .sxi .sti .uop .sdd .sdp .fopd',
  drawings:
    '.odg .fodg .otg .vsd .vsdx .vsdm .vdx .cdr .svg .svm .wmf .emf .cgm .dxf .std .sxd .pub .wpg .sda .odd .met .cmx .eps',
  images:
    '.jpg .jpeg .png .bmp .gif .tif .tiff .pbm .pgm .ppm .xbm .xpm .pcx .pcd .pct .psd .tga .ras .pwp',
  other: '.html .htm .xhtml .epub .uot .pdf .pdb .ltx .mml .smf .sxm .sxg .oth .odm .swf',
} as const

export const OFFICE_EXTENSIONS = Object.values(OFFICE_FORMAT_FAMILIES).flatMap((family) =>
  family.split(' '),
)
export const OFFICE_ACCEPT = OFFICE_EXTENSIONS.join(',')
export const OFFICE_EXTENSION_SET: ReadonlySet<string> = new Set(OFFICE_EXTENSIONS)

/** Gotenberg 9.0.0's Extensions() list is v8.40.0 minus EPUB. */
export const OFFICE_V9_EXTENSIONS = OFFICE_EXTENSIONS.filter(
  (extension) => extension !== '.epub',
).sort()
export const OFFICE_V9_ACCEPT = OFFICE_V9_EXTENSIONS.join(',')
export const OFFICE_V9_EXTENSION_SET: ReadonlySet<string> = new Set(OFFICE_V9_EXTENSIONS)
/** An unknown version uses the union until the proxy has verified /version. */
export function officeExtensionSetForMajor(major?: SupportedGotenbergMajor): ReadonlySet<string> {
  return major === 9 ? OFFICE_V9_EXTENSION_SET : OFFICE_EXTENSION_SET
}

/** The file picker follows the selected connection; a server-side check is still required. */
export function officeAcceptForVersion(version?: string): string {
  return parseGotenbergVersion(version)?.major === 9 ? OFFICE_V9_ACCEPT : OFFICE_ACCEPT
}
