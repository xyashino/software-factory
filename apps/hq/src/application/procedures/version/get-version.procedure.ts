import {
  HQ_PROTOCOL_VERSION,
  versionContract,
} from '@repo/hq-contracts/version.contract';
import { HQ_VERSION } from '../../../version';
import { publicProcedure } from '../../core/procedure';

export const getVersionProcedure = publicProcedure(versionContract)(() => ({
  code: 200 as const,
  version: HQ_VERSION,
  protocolVersion: HQ_PROTOCOL_VERSION,
}));
