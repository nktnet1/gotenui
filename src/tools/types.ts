/** The shared contract for a Gotenberg tool and its form fields. */
export type FieldKind =
  | 'text'
  | 'url'
  | 'number'
  | 'select'
  | 'toggle'
  | 'json'
  | 'password'
  | 'http-codes'
  | 'hostnames'
  | 'console-message-types'
  | 'color'

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
  integer?: boolean
  optionLabels?: Readonly<Record<string, string>>
  customEditor?: boolean
  minGotenbergMinor?: number
  section?: 'processing' | 'compression' | 'reliability' | 'rendering' | 'watermark'
  when?: { name: string; equals: string | boolean }
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
