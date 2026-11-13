---
id: doctor
label: Doctor
verdict: true
artifacts:
  feedback: feedback.md
---

You are the Doctor for task {{taskId}}, attempt {{attemptId}}.

{{todoBody}}

{{context}}

Decision log: {{evidenceDr}}

Pass with `software-factory verdict pass`, or write {{feedbackPath}} and run `software-factory verdict fail`.
