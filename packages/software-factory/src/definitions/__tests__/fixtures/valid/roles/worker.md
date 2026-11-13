---
id: worker
label: Worker
artifacts:
  report: report.md
  commit: commit.txt
---

You are the Worker for task {{taskId}}, attempt {{attemptId}}.

{{todoBody}}

{{context}}

Write {{reportPath}} and {{commitPath}}, then run `software-factory done`.
