import { expect, test } from 'bun:test'
import { packagedManifest, researchOrigin } from './package'

test('desktop configuration only accepts HTTPS origins', () => {
  expect(researchOrigin('https://research.example.com/')).toBe(
    'https://research.example.com',
  )
  for (const bad of [
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com/path',
    'https://example.com/?key=secret',
    'https://example.com/#test',
  ]) {
    expect(() => researchOrigin(bad)).toThrow()
  }
})

test('packaged extension retains native API identity without upstream extension updates', () => {
  const original = {
    key: 'native-key',
    update_url: 'https://vendor/update',
    permissions: ['browserOS'],
  }
  const packaged = packagedManifest(original)
  expect(packaged).toEqual({
    key: 'native-key',
    permissions: ['browserOS'],
    name: 'AI Browser Assistant',
    version_name: 'Development alpha',
  })
  expect(original.update_url).toBe('https://vendor/update')
})
