import { describe, expect, it, vi } from 'vitest'
import {
  filterBundledDependencyClientDirectives,
  isBundledDependencyClientDirective,
  labelDynamicChunkGroups,
} from '#scripts/nitro-build-warnings'

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

  it('filters known third-party directives without hiding other logs', () => {
    const delegate = vi.fn()
    const previousOnLog = vi.fn()
    const handler = filterBundledDependencyClientDirectives(previousOnLog)
    const directive = {
      code: 'MODULE_LEVEL_DIRECTIVE',
      message: 'The module level directive "use client" may not be preserved',
      id: '/app/node_modules/sonner/index.mjs',
    }
    const unrelated = { code: 'UNRESOLVED_IMPORT', message: 'Could not resolve import' }

    handler('warn', directive, delegate)
    expect(previousOnLog).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()

    handler('warn', unrelated, delegate)
    expect(previousOnLog).toHaveBeenCalledTimes(1)
    expect(previousOnLog).toHaveBeenCalledWith('warn', unrelated, delegate)
    expect(delegate).not.toHaveBeenCalled()

    filterBundledDependencyClientDirectives(undefined)('warn', unrelated, delegate)
    expect(delegate).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith('warn', unrelated)
  })

  it('recognises Windows and message-only dependency locations', () => {
    const message =
      'The module level directive "use client" in C:\\app\\node_modules\\sonner\\index.mjs may not be preserved'
    expect(
      isBundledDependencyClientDirective('warn', { code: 'MODULE_LEVEL_DIRECTIVE', message }),
    ).toBe(true)
  })
})
