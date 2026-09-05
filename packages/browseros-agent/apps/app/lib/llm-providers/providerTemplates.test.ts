import { describe, expect, it } from 'bun:test'
import { getProviderTemplate, providerTemplates } from './providerTemplates'

describe('providerTemplates', () => {
  it('offers Nebius without replacing the generic compatible provider', () => {
    expect(getProviderTemplate('openai-compatible')?.name).toBe(
      'OpenAI Compatible',
    )
    expect(
      providerTemplates.find(
        (provider) => provider.name === 'Nebius Token Factory',
      ),
    ).toMatchObject({
      id: 'openai-compatible',
      defaultBaseUrl: 'https://api.tokenfactory.nebius.com/v1',
      defaultModelId: '',
    })
  })
  it('uses ChatGPT as the display name for new ChatGPT providers', () => {
    const template = providerTemplates.find(
      (provider) => provider.id === 'chatgpt-pro',
    )

    expect(template).toMatchObject({
      name: 'ChatGPT',
      defaultModelId: 'gpt-5.5',
      contextWindow: 1050000,
    })
  })
})
