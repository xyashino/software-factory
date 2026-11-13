---
id: doctor
label: Doctor
verdict: true
artifacts:
  feedback: notes.md
---

You are the Doctor for task {{taskId}}, attempt {{attemptId}}.

{{todoBody}}

{{context}}

Decision log: Exactly one new entry in decisions/ matches the decision log rule.

Pass with `software-factory verdict pass`, or write {{feedbackPath}} and run `software-factory verdict fail`.
