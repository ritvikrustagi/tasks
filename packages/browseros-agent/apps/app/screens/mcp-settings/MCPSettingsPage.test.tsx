import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createElement, type FC, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The three sibling sections are stubbed so this exercises the page's own
// composition.
mock.module('./MCPServerHeader', () => ({
  MCPServerHeader: () => createElement('div', null, 'server-header'),
}))

mock.module('./IntegrationsSection', () => ({
  IntegrationsSection: () => createElement('div', null, 'integrations'),
}))

mock.module('./MCPToolsSection', () => ({
  MCPToolsSection: () => createElement('div', null, 'tools'),
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children }: { children?: ReactNode }) =>
    createElement('button', { type: 'button' }, children),
}))

mock.module('@/lib/metrics/track', () => ({
  track: () => {},
}))

mock.module('@/lib/sentry/sentry', () => ({
  sentry: { captureException: () => {} },
}))

mock.module('@/lib/browseros/helpers', () => ({
  getMcpServerUrl: async () => 'http://127.0.0.1:9200/mcp',
}))

let MCPSettingsPage: FC

beforeAll(async () => {
  MCPSettingsPage = (await import('./MCPSettingsPage')).MCPSettingsPage
})

describe('MCPSettingsPage', () => {
  it('renders the server header above integrations with no third-party promo', () => {
    const html = renderToStaticMarkup(createElement(MCPSettingsPage))

    // Pin the stub positions first: a missing stub would return -1 and turn the
    // ordering bound below into an assertion that is trivially true.
    const headerIndex = html.indexOf('server-header')
    const integrationsIndex = html.indexOf('integrations')
    expect(headerIndex).toBeGreaterThan(-1)
    expect(integrationsIndex).toBeGreaterThan(-1)
    expect(headerIndex).toBeLessThan(integrationsIndex)

    expect(html).not.toContain('BrowserOS neo')
  })
})
