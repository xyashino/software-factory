import type { DefinitionError } from './errors';
import type { OperatorProfile } from './operator-profile';
import type { ArtifactRef, InputRef, Line, LineStation } from './line-schema';

/**
 * Checks one Line against the loaded operator profiles. Every rule about
 * station order, artifact origin, retry targets and judging profiles lives
 * here. `brokenOperators` names profiles whose file failed to parse: a
 * reference to one is not reported twice.
 */
export const validateLine = (
  file: string,
  line: Line,
  operators: ReadonlyMap<string, OperatorProfile>,
  brokenOperators: ReadonlySet<string> = new Set(),
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
  const fail = (field: string, message: string): void => {
    errors.push({ file, field, message });
  };

  const stationIndex = new Map<string, number>();
  line.stations.forEach((station, index) => {
    if (stationIndex.has(station.id)) {
      fail(`stations[${index}].id`, `duplicate station id "${station.id}"`);
    } else {
      stationIndex.set(station.id, index);
    }
  });

  const profileOf = (key: string): OperatorProfile | undefined => {
    const pool = line.operators[key];
    return pool === undefined ? undefined : operators.get(pool.profile);
  };

  for (const [key, pool] of Object.entries(line.operators)) {
    if (!operators.has(pool.profile) && !brokenOperators.has(pool.profile)) {
      fail(`operators.${key}.profile`, `unknown profile "${pool.profile}"`);
    }
  }

  const usedOperators = new Set<string>();

  const artifactProblem = (ref: ArtifactRef, before: number): string | null => {
    const index = stationIndex.get(ref.stationId);
    if (index === undefined) {
      return `unknown station "${ref.stationId}"`;
    }
    if (index >= before) {
      return `station "${ref.stationId}" must come before this station`;
    }
    const producer = line.stations[index];
    if (producer?.kind !== 'operator') {
      return `station "${ref.stationId}" is an inspection and produces no artifacts`;
    }
    const profile = profileOf(producer.operator);
    if (
      profile !== undefined &&
      !Object.hasOwn(profile.artifacts, ref.artifactKey)
    ) {
      return `station "${ref.stationId}" does not produce artifact "${ref.artifactKey}"`;
    }
    return null;
  };

  const gateProblem = (stationId: string, before: number): string | null => {
    const index = stationIndex.get(stationId);
    if (index === undefined) {
      return `unknown station "${stationId}"`;
    }
    if (index >= before) {
      return `station "${stationId}" must come before this station`;
    }
    if (line.stations[index]?.kind !== 'inspection') {
      return `station "${stationId}" is an operator station; "${stationId}.gate" needs an inspection`;
    }
    return null;
  };

  const retryProblem = (retry: string, index: number): string | null => {
    const target = stationIndex.get(retry);
    if (target === undefined) {
      return `unknown station "${retry}"`;
    }
    if (target >= index) {
      return `"${retry}" must be an earlier station`;
    }
    if (line.stations[target]?.kind !== 'operator') {
      return `"${retry}" is an inspection; retry must target an operator station`;
    }
    return null;
  };

  const inputProblem = (input: InputRef, index: number): string | null => {
    if (input.kind === 'gate') {
      return gateProblem(input.stationId, index);
    }
    return artifactProblem(input, index);
  };

  line.stations.forEach((station: LineStation, index) => {
    const prefix = `stations[${index}]`;

    if (station.onFail !== undefined) {
      const problem = retryProblem(station.onFail.retry, index);
      if (problem !== null) {
        fail(`${prefix}.onFail.retry`, problem);
      }
    }

    if (station.kind === 'inspection') {
      return;
    }

    usedOperators.add(station.operator);
    if (!Object.hasOwn(line.operators, station.operator)) {
      fail(
        `${prefix}.operator`,
        `unknown operator "${station.operator}"; declare it under operators:`,
      );
    }

    const profile = profileOf(station.operator);
    if (
      station.onFail !== undefined &&
      profile !== undefined &&
      !profile.verdict
    ) {
      fail(
        `${prefix}.onFail`,
        `only a judging profile (verdict: true) can fail a station; profile "${profile.id}" is not judging`,
      );
    }

    station.inputs.forEach((input, inputIndex) => {
      const problem = inputProblem(input, index);
      if (problem !== null) {
        fail(`${prefix}.inputs[${inputIndex}]`, problem);
      }
    });
  });

  for (const key of Object.keys(line.operators)) {
    if (!usedOperators.has(key)) {
      fail(`operators.${key}`, 'is not used by any station');
    }
  }

  const deliverRefs: Array<[string, ArtifactRef]> = [
    ['deliver.commit', line.deliver.commit],
    ['deliver.report', line.deliver.report],
  ];
  for (const [field, ref] of deliverRefs) {
    const problem = artifactProblem(ref, line.stations.length);
    if (problem !== null) {
      fail(field, problem);
    }
  }

  return errors;
};
