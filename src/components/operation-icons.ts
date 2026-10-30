import type { LucideIcon } from 'lucide-react'
import {
  BookmarkCheck,
  BookmarkPlus,
  Camera,
  Code2,
  FileArchive,
  FileCode2,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileStack,
  Files,
  FileText,
  FileUp,
  Globe2,
  Image,
  Layers3,
  LockKeyhole,
  RotateCw,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react'
import type { Operation } from '#/lib/operations'

const ICONS: Record<Operation['id'], LucideIcon> = {
  'url-pdf': Globe2,
  'html-pdf': Code2,
  'markdown-pdf': FileCode2,
  'office-pdf': FileUp,
  'url-shot': Camera,
  'html-shot': Image,
  'markdown-shot': Image,
  merge: Files,
  split: FileStack,
  pdfa: ShieldCheck,
  optimize: WandSparkles,
  rotate: RotateCw,
  flatten: Layers3,
  encrypt: LockKeyhole,
  watermark: FileText,
  stamp: FilePlus2,
  'metadata-read': FileSearch,
  'metadata-write': FilePenLine,
  'bookmarks-read': BookmarkCheck,
  'bookmarks-write': BookmarkPlus,
  embed: FileArchive,
  'factur-x': FileText,
}

export function operationIcon(id: Operation['id']): LucideIcon {
  return ICONS[id] ?? FileText
}
