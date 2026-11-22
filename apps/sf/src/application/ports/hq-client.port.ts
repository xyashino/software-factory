export type HqReply<T> =
  { kind: 'ok'; value: T } | { kind: 'rejected' } | { kind: 'unreachable' };

export interface HqEnrollment {
  factoryId: string;
  sessionToken: string;
  expiresAt: number;
}

export interface HqClientPort {
  enroll(input: {
    url: string;
    joinToken: string;
    name: string;
  }): Promise<HqReply<HqEnrollment>>;
  heartbeat(input: {
    url: string;
    sessionToken: string;
  }): Promise<HqReply<{ factoryId: string }>>;
  goneCell(input: {
    url: string;
    sessionToken: string;
    cellId: string;
  }): Promise<HqReply<{ cellId: string }>>;
}
