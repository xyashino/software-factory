export const usage = `usage: factory-operator <command>

Talks only to the Cell that runs this Cycle ($FACTORY_OPERATOR_URL, $FACTORY_CYCLE_TOKEN).

  done                                  finish the station; the outputs are checkpointed
  verdict pass                          the verdict passes
  verdict fail --feedback <file>        the verdict fails; the file is the feedback
  ask "<question>"                      ask the Supervisor; waits for the answer
  tell <station|supervisor> "<note>"    leave a note; does not wait
  block --reason "<why>" --handover <file>
                                        stop with a Handover the next Operator reads
  context                               print this Cycle's inputs and outputs
  incident --diagnosis "<what>" --action <resume|cancel|nudge|escalate|repair>
           --outcome "<result>" [--change <file|config>:<path>=<ref> ...]
                                        Mechanic only: record the incident of the Andon
  escalate --diagnosis "<why>" --outcome "<what you tried>"
                                        Mechanic only: hand the Andon to the Supervisor`;
