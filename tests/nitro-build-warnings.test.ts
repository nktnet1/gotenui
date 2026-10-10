import { describe, expect, it } from 'vitest'
import {
  isBundledDependencyClientDirective,
  labelDynamicChunkGroups,
} from '../scripts/nitro-build-warnings'

describe('Nitro/Rolldown build diagnostics', () => {
  it('labels function-named groups without changing their behaviour', () => {
    const name = (id: string) => (id.includes('node_modules') ? 'vendor' : null)
    const group = { name, test: /node_modules/ }
    const output = { codeSplitting: { groups: [group, { name: 'fixed' }] } }

    labelDynamicChunkGroups(output)

    expect(name('node_modules/react/index.js')).toBe('vendor')
    expect(output.codeSplitting.groups[0].name).toBe(name)
    expect(Object.getOwnPropertyDescriptor(group, 'debugName')).toMatchObject({
      value: 'nitro-group-0',
      enumerable: false,
    })
    expect(Object.keys(group)).toEqual(['name', 'test'])
  })

  it('leaves existing labels and unrelated output alone', () => {
    const labelled = { name: () => 'existing', debugName: 'existing-group' }
    const output = [{ codeSplitting: { groups: [labelled] } }, { codeSplitting: false }]
    labelDynamicChunkGroups(output)
    labelDynamicChunkGroups(null)

    expect(labelled.debugName).toBe('existing-group')
    expect(output[1]).toEqual({ codeSplitting: false })
  })

  it('ignores only dependency use-client warnings in the server bundle', () => {
    const warning = {
      code: 'MODULE_LEVEL_DIRECTIVE',
      message: 'The module level directive "use client" may not be preserved',
      id: '/repo/node_modules/.pnpm/sonner/node_modules/sonner/dist/index.mjs',
    }

    expect(isBundledDependencyClientDirective('warn', warning)).toBe(true)
    expect(isBundledDependencyClientDirective('info', warning)).toBe(false)
    expect(isBundledDependencyClientDirective('warn', { ...warning, id: '/repo/src/app.ts' })).toBe(
      false,
    )
    expect(isBundledDependencyClientDirective('warn', { ...warning, code: 'OTHER_WARNING' })).toBe(
      false,
    )
    expect(
      isBundledDependencyClientDirective('warn', {
        ...warning,
        message: 'The module level directive "use server" may not be preserved',
      }),
    ).toBe(false)
  })

  it('recognises Windows and message-only dependency locations', () => {
    const message =
      'The module level directive "use client" in C:\\app\\node_modules\\sonner\\index.mjs may not be preserved'
    expect(
      isBundledDependencyClientDirective('warn', { code: 'MODULE_LEVEL_DIRECTIVE', message }),
    ).toBe(true)
  })
})
