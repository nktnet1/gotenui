/** Gotenberg 8.37 LibreOffice conversion extensions (upstream docs + 8.36 OOXML slide-show fix). */
export const OFFICE_FORMAT_FAMILIES = {
  documents:
    '.doc .docx .docm .dot .dotm .dotx .odt .fodt .ott .rtf .txt .wps .wpd .pages .abw .zabw .lwp .mw .mcw .hwp .sxw .stw .sgl .vor .602 .bib .xml .cwk .psw .uof',
  spreadsheets:
    '.xls .xlsx .xlsm .xlsb .xlt .xltm .xltx .xlw .ods .fods .ots .csv .numbers .123 .wk1 .wks .wb2 .dbf .dif .slk .sxc .stc .uos .pxl .sdc',
  presentations:
    '.ppt .pptx .pptm .pot .potm .potx .pps .ppsx .ppsm .odp .fodp .otp .key .sxi .sti .uop .sdd .sdp .fopd',
  drawings:
    '.odg .fodg .otg .vsd .vsdx .vsdm .vdx .cdr .svg .svm .wmf .emf .cgm .dxf .std .sxd .pub .wpg .sda .odd .met .cmx .eps',
  images:
    '.jpg .jpeg .png .bmp .gif .tif .tiff .pbm .pgm .ppm .xbm .xpm .pcx .pcd .pct .psd .tga .ras .pwp',
  other: '.html .htm .xhtml .epub .pdf .pdb .ltx .mml .smf .sxm .sxg .oth .odm .swf',
} as const

export const OFFICE_EXTENSIONS = Object.values(OFFICE_FORMAT_FAMILIES).flatMap((family) =>
  family.split(' '),
)
export const OFFICE_ACCEPT = OFFICE_EXTENSIONS.join(',')
export const OFFICE_EXTENSION_SET: ReadonlySet<string> = new Set(OFFICE_EXTENSIONS)
