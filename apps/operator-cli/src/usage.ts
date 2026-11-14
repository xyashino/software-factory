export const usage = `usage: factory-operator <command>

Talks only to the Cell that runs this Cycle ($FACTORY_OPERATOR_SOCKET, $FACTORY_CYCLE_TOKEN).

  done                                  finish the station; the outputs are checkpointed
  verdict pass                          the verdict passes
  verdict fail --feedback <file>        the verdict fails; the file is the feedback
  ask "<question>"                      ask the Supervisor; waits for the answer
  tell <station|supervisor> "<note>"    leave a note; does not wait
  block --reason "<why>" --handover <file>
                                        stop with a Handover the next Operator reads
  context                               print this Cycle's inputs and outputs`;
