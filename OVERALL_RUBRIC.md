# Overall Hackathon Rubric

This is what we are graded on. Use this document when choosing the product, planning implementation, and preparing the demo.

**Our intent:** fit all three tracks as well as we naturally can. Build a useful product first, and give each sponsor a meaningful role where it helps complete the task. Do not add artificial features just to check boxes. If a track does not fit, record the gap honestly; its entry requirements still apply if we submit to it.

Source: the track descriptions supplied by the team and the attached “Credits for Builders” screenshot on September 5, 2026. The requirements below summarize that material; the suggested plan is our guidance, not an additional organizer requirement. No scoring weights were supplied.

## Product direction

The workspace currently has no product implementation. Before building, define:

- **User:** who needs this?
- **Task:** what useful work will the product finish for them?
- **Input and stored data:** what do they provide, and what does the product already know?
- **Result:** what can they use or act on when it finishes?
- **Success:** how can we check that the result is good?

A possible shared flow, if it fits the chosen problem:

1. A user submits a task that combines stored data with missing information from the web.
2. Render Workflows runs the background process and exposes its progress.
3. Linkup searches and retrieves evidence. We store findings, identify gaps or conflicting evidence, and use those findings to choose follow-up searches.
4. Nebius Token Factory performs inference in the main flow to turn the evidence into a usable result, with sources and uncertainty visible.
5. The user retrieves the result. We evaluate representative inputs and demonstrate recovery from a controlled failure.

This is a candidate flow, not a committed architecture. A sponsor logo, unused API call, or unrelated feature does not establish meaningful integration.

## Track 1: Deep Research — Linkup

**Prize pool:** $500 cash (USD).

**Build:** a product that combines stored data with web information to help someone complete a task. We choose the user, problem, and interface.

### Entry requirements

- [ ] Use Linkup to search and retrieve information.
- [ ] Store research findings.
- [ ] Use stored findings to decide what to investigate next.

### What we must show

- [ ] A deployed product completing a task from start to finish.
- [ ] The sources used and the follow-up searches performed.
- [ ] How the findings affect the final result.

### What judges assess

| Criterion | What we need to demonstrate |
| --- | --- |
| Shipping | Someone outside the team can use the product. |
| Usefulness | It solves a clear problem for a person or business. |
| Research quality | It finds missing information, checks evidence, and flags uncertainty. |
| Integration | Linkup plays an essential role in completing the task. |

**Planning guidance:** preserve enough research history to explain “we found X, which left question Y, so we searched for Z.” Show disagreements or missing evidence honestly. A single search followed by a summary does not demonstrate the required follow-up research flow.

## Track 2: Applied AI — Nebius

**Prize pool:** $500 cash (USD).

**Build:** an AI product for a specific task whose results we can check, with a clear definition of a good result.

### Entry requirements

- [ ] Use Nebius Token Factory for inference in the main product flow.
- [ ] Evaluate outputs on a small set of representative inputs.
- [ ] Measure at least one of: accuracy, time to complete the task, or cost per task.

### What we must show

- [ ] A working product processing an input and producing a usable result.
- [ ] Evaluation results and an explanation of how we measured them.
- [ ] A case the product struggles with.

### What judges assess

| Criterion | What we need to demonstrate |
| --- | --- |
| Shipping | Someone outside the team can run the product and get a result. |
| Usefulness | It completes a task that matters to the intended user. |
| Output quality | Results are correct and useful across the tested cases, with clear limitations. |
| Integration | Token Factory is essential to the task, and we can explain choices around quality, speed, or cost. |

**Planning guidance:** save the evaluation inputs, expected outcomes or scoring criteria, actual outputs, and measured results. Include ordinary cases and a difficult case. Explain the measurement scope—for example, whether timing covers the full task or only inference. Report observed results rather than invented scores. The supplied rules do not specify a minimum case count.

## Track 3: Workflows — Render

**Prize pool:** $900 in credits (USD): first $500, second $300, third $100.

**Build:** a useful, multi-step background process that tracks progress, handles failures, and makes the final result available to the user.

### Entry requirements

- [ ] Use Render Workflows to execute the process.
- [ ] Include a way to recover from a failed step.
- [ ] Handle duplicate records or actions in the application wherever retrying could create them.

### What we must show

- [ ] A deployed workflow completing a task from start to finish.
- [ ] A controlled failure and the process recovering from it.
- [ ] A check of the final result after recovery.
- [ ] Visible execution status and any unresolved errors.

### What judges assess

| Criterion | What we need to demonstrate |
| --- | --- |
| Shipping | Someone outside the team can start the process and retrieve its result. |
| Usefulness | The process completes work someone needs done. |
| Reliability | It recovers from failures without losing results or creating duplicate effects. |
| Integration | Render Workflows handles a meaningful part of the process, with clear steps and visible progress. |

**Planning guidance:** choose a safe step for a deliberate demo failure, show recovery, and verify that prior results survive and final records or actions are not duplicated. Use stable operation identifiers or another appropriate deduplication mechanism where needed. Hosting the app on Render alone does not meet the Render Workflows requirement.

## Builder credits

These participant benefits are separate from the competition prizes. The screenshot lists:

| Sponsor | Benefit | Claim instructions shown |
| --- | --- | --- |
| Nebius | $25 in Token Factory credits for AI inference | Sign up through the Burning Token Builder Program link and follow its redemption steps. |
| Render | $50 in credits for app hosting | Sign in with GitHub on Render’s claim page for Burning Token participants. |

The screenshot does not provide readable claim URLs, show a Linkup credit offer, or confirm that credits have been redeemed. Confirm redemption, applicable services, and remaining balances before relying on them for the demo.

## Combined demo and submission checklist

This is our suggested evidence checklist for covering all three tracks in one coherent product demo:

- [ ] State the intended user, their problem, and what a successful result looks like.
- [ ] Provide a deployed entry point an outside user can access and use.
- [ ] Start a real task and show background progress through meaningful steps.
- [ ] Show stored data, Linkup sources, saved findings, and a follow-up search driven by those findings.
- [ ] Show how Nebius inference contributes to the usable result.
- [ ] Trigger a controlled workflow failure, recover, and verify the final result without duplicate effects.
- [ ] Show the final result, supporting sources, uncertainty, and any unresolved errors.
- [ ] Share the evaluation method, measured results, and a known difficult case.
- [ ] Explain each sponsor’s essential role and the relevant quality, speed, or cost choices.

Keep boxes unchecked until there is evidence. As we build, add links to the deployed product, relevant implementation, evaluation results, and demo evidence here. Record any unmet track requirements before submission.

## Browser-agent build evidence

The supplied browser-agent brief is implemented as a local TypeScript CLI; see
[CLI setup and usage](CLI_README.md), [observed validation](VALIDATION.md), and
[track eligibility gaps](RUBRIC_ALIGNMENT.md). The user subsequently requested Claude and ChatGPT subscription support. The
CLI implementation still uses browser-native research and has no Linkup, Nebius,
or Render Workflows integration, so it does not currently qualify for the Linkup, Nebius, or Render Workflows tracks.
The evaluation runner records blocked and failed cases without marking them as
passes. Sponsor and deployed-product checkboxes above remain unchecked.
