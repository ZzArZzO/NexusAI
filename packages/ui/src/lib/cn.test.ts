import { describe, expect, test } from 'vitest'

import { cn } from './cn'

describe('cn', () => {
  test('joins class names', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center')
  })

  test('drops falsy values', () => {
    expect(cn('flex', false, undefined, null, 'gap-2')).toBe('flex gap-2')
  })

  test('resolves conflicting Tailwind utilities in favour of the last one', () => {
    // Without twMerge this would emit both and let CSS source order decide.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm text-muted-foreground', 'text-foreground')).toBe('text-sm text-foreground')
  })

  test('supports conditional objects and arrays', () => {
    expect(cn(['flex', { hidden: false, 'gap-2': true }])).toBe('flex gap-2')
  })
})
