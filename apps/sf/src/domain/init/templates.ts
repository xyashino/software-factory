const WORKSPACE = `workspace:
  setup:
    timeout: 10m
    exec:
      - pnpm install --frozen-lockfile
`;

const BUILDER_OPERATOR = `  builder:
    profile: builder
    runner: claude
    model: sonnet
    timeout: 60m
    headless: false
    permission: write
`;

const BUILD_STATION = `  - id: build
    kind: operator
    operator: builder
    inputs: []
`;

const QUALITY_GATE_STATION = `  - id: quality-gate
    kind: inspection
    timeout: 15m
    exec:
      - pnpm run --if-present lint
      - pnpm run --if-present check-types
      - pnpm run --if-present test
    onFail:
      retry: build
      max: 3
`;

const DELIVER = `deliver:
  commit: build.commit
  report: build.report
  to: new-pr
`;

export const LINE_FAST = `name: fast
description: Direct builder build with quality gate and direct delivery

${WORKSPACE}
operators:
${BUILDER_OPERATOR}
stations:
${BUILD_STATION}
${QUALITY_GATE_STATION}
${DELIVER}`;

export const LINE_STANDARD = `name: standard
description: Direct builder build with quality gate and doctor audit

${WORKSPACE}
operators:
${BUILDER_OPERATOR}  doctor:
    profile: doctor
    runner: claude
    model: sonnet
    timeout: 20m
    headless: false
    permission: read

stations:
${BUILD_STATION}
${QUALITY_GATE_STATION}  - id: audit
    kind: operator
    operator: doctor
    inputs:
      - build.report
      - build.commit
      - quality-gate.gate
    onFail:
      retry: build
      max: 2

${DELIVER}`;

export const BUILDER_PROFILE = `---
id: builder
label: Builder
rules: [rich-commit]
artifacts:
  report: report.md
  commit: commit.txt
---

## Role

You are the Builder for task {{taskId}}, attempt {{attemptId}}. You implement the task solo.

## Inputs

Read each input before you begin:
{{inputs}}

## Context
{{context}}

## Rules

You must follow the declared rules.
{{rules}}

## Instructions

1. If the change is complex, write a short plan first.
2. Follow the declared rules and the conventions of the code around your change.
3. Run the checks the repo defines (lint, check-types, test) for every package you touched. Fix every finding.
4. Proof: this attempt's evidence directory is {{evidenceDir}}. Save the output of each check you ran there (for example check.txt, test.txt). Do not write proof to /tmp, to the worktree, or to another attempt's directory.
5. Write the report and the commit message to the artifacts named above.
`;

export const DOCTOR_PROFILE = `---
id: doctor
label: Doctor
verdict: true
rules: [rich-commit]
artifacts:
  feedback: feedback.md
---

## Role

You are the Doctor for task {{taskId}}, attempt {{attemptId}}. You audit quality, proof and rules. You review; you do not edit code.

## Inputs

Read each input before you begin:
{{inputs}}

## Context
{{context}}

## Rules

You must follow the declared rules.
{{rules}}

## Instructions

1. The diff of the cell's worktree against HEAD (including untracked and staged files) is in your context. HEAD is the base this task started from.
2. Scope: the change does what the task and the cell report say, nothing more.
3. Rules: check the declared rules against the changed files. For rich-commit, check the message in the build.commit input against the rule text.
4. Proof: the cell's proof is in the directory of the build.report input. Check it there.

## Commands

- The quality gate already ran. Its result is in the context as "Gate result". Cite it; do not re-run it.
- Run no shell commands except the verdict command. Everything you need is in your context.

## Blocking vs notes

- Blocking: a failing rule, missing proof the attempt could produce, wrong scope, a defect in the diff.
- Note, not blocking: anything the attempt cannot run itself. Record it under "Notes" in the feedback and still pass.

## Finish

- Everything holds: run \`factory-operator verdict pass\`. No feedback is needed for a pass.
- Otherwise run \`factory-operator verdict fail --feedback -\` and give each problem with its file and line on stdin.
`;

export const PR_BODY_TEMPLATE = `## 🎯 Task: \`{{taskId}}\`

{{objective}}

### 📝 Changes

{{changes}}

## 🏛️ ADR

{{adrSection}}

## 🧪 Checks

{{verificationSection}}
`;

export const repoConfigText = (projectId: string): string =>
  `${JSON.stringify({ project: projectId }, null, 2)}\n`;
