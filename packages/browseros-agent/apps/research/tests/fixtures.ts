import type { Providers } from '../src/providers'
import type { Result, Source } from '../src/schema'

export const evidence: Source = {
  id: 'fixture-source',
  url: 'https://example.com/pricing',
  title: 'Example vendor pricing',
  content:
    'The team plan costs $20 per seat. SSO is only in Enterprise; retention is unspecified.',
}
export function fixtureProviders(
  options: { noSources?: boolean; badCitation?: boolean } = {},
) {
  const calls: string[] = []
  const providers: Providers = {
    async search(query) {
      calls.push(`search:${query}`)
      if (options.noSources)
        throw new Error(
          'Linkup returned no usable sources; revise the research question',
        )
      return { query, sources: [evidence] }
    },
    async infer(stage, question, brief, results): Promise<Result> {
      calls.push(`infer:${stage}`)
      if (!results.some((r) => r.sources?.length))
        throw new Error('Missing stored evidence')
      const usage = {
        model: 'fixture-not-live',
        inputTokens: 100,
        outputTokens: 50,
        elapsedMs: 1,
      }
      if (stage === 'investigate')
        return {
          plan: {
            findings: [{ text: evidence.content, sources: [evidence.id] }],
            gaps: ['Retention is unspecified'],
            query: 'Example vendor official retention policy',
            reason:
              'Saved pricing evidence does not establish retention; verify the policy before recommending.',
          },
          usage,
        }
      return {
        report: {
          title: 'Vendor recommendation',
          summary: `Evaluate against: ${brief || question}`,
          findings: [
            {
              text: evidence.content,
              sources: [options.badCitation ? 'invented' : evidence.id],
            },
          ],
          uncertainties: ['Retention could not be verified.'],
          nextActions: ['Ask vendor to confirm retention.'],
        },
        usage,
      }
    },
  }
  return { providers, calls }
}
