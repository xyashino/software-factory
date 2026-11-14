import { describe, expect, it } from 'vitest';
import {
  projectAddRequestSchema,
  projectRemoveRequestSchema,
  projectSetRequestSchema,
} from '../supervisor';

const add = {
  projectId: 'software-factory',
  repoUrl: 'https://example.test/software-factory.git',
};

describe('project add request', () => {
  it('fills the defaults: main, two running orders, delivered', () => {
    expect(projectAddRequestSchema.parse(add)).toEqual({
      ...add,
      baseBranch: 'main',
      maxRunning: 2,
      depPolicy: 'delivered',
    });
  });

  it('refuses a project id that is not a slug', () => {
    expect(
      projectAddRequestSchema.safeParse({ ...add, projectId: 'Bad Id' })
        .success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5])('refuses maxRunning of %s', (maxRunning) => {
    expect(
      projectAddRequestSchema.safeParse({ ...add, maxRunning }).success,
    ).toBe(false);
  });

  it('refuses a depPolicy other than delivered or merged', () => {
    expect(
      projectAddRequestSchema.safeParse({ ...add, depPolicy: 'shipped' })
        .success,
    ).toBe(false);
  });

  it('refuses a base branch with whitespace', () => {
    expect(
      projectAddRequestSchema.safeParse({ ...add, baseBranch: 'release 1' })
        .success,
    ).toBe(false);
  });

  it('refuses a repository url that is empty', () => {
    expect(
      projectAddRequestSchema.safeParse({ ...add, repoUrl: '' }).success,
    ).toBe(false);
  });
});

describe('project set request', () => {
  it('accepts a single field', () => {
    expect(
      projectSetRequestSchema.parse({
        projectId: 'software-factory',
        maxRunning: 3,
      }),
    ).toEqual({ projectId: 'software-factory', maxRunning: 3 });
  });

  it('refuses a repository url: it cannot change in place', () => {
    expect(
      projectSetRequestSchema.safeParse({
        projectId: 'software-factory',
        repoUrl: 'https://example.test/other.git',
      }).success,
    ).toBe(false);
  });

  it('refuses an empty patch', () => {
    expect(
      projectSetRequestSchema.safeParse({ projectId: 'software-factory' })
        .success,
    ).toBe(false);
  });

  it('refuses a max running of zero', () => {
    expect(
      projectSetRequestSchema.safeParse({
        projectId: 'software-factory',
        maxRunning: 0,
      }).success,
    ).toBe(false);
  });
});

describe('project remove request', () => {
  it('takes only the project id', () => {
    expect(
      projectRemoveRequestSchema.safeParse({
        projectId: 'software-factory',
        force: true,
      }).success,
    ).toBe(false);
  });
});
