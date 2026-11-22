import { describe, expect, it } from 'vitest';
import { cellUnitOf, serverUnitOf } from '../../../src/domain/service/units';

describe('service unit text', () => {
  it('renders the server unit as a snapshot', () => {
    // Arrange
    const input = {
      execArgs: ['/usr/bin/sf', '__server'],
      env: { FACTORY_DATA_DIR: '/var/lib/sf', FACTORY_PORT: '7070' },
    };

    // Act
    const text = serverUnitOf(input);

    // Assert
    expect(text).toMatchInlineSnapshot(`
      "# managed-by: sf service install
      [Unit]
      Description=Software factory server
      After=network-online.target
      Wants=network-online.target

      [Service]
      ExecStart=/usr/bin/sf __server
      Environment=FACTORY_DATA_DIR=/var/lib/sf
      Environment=FACTORY_PORT=7070
      Restart=on-failure
      RestartSec=5

      [Install]
      WantedBy=default.target
      "
    `);
  });

  it('renders the cell unit with its working directory and env file as a snapshot', () => {
    // Arrange
    const input = {
      cellName: 'edge',
      execArgs: ['/usr/bin/sf', 'cell', 'start', '--name', 'edge'],
      workingDir: '/srv/repo',
      env: {},
      envFile: '/var/lib/sf/service/sf-cell-edge.env',
    };

    // Act
    const text = cellUnitOf(input);

    // Assert
    expect(text).toMatchInlineSnapshot(`
      "# managed-by: sf service install
      [Unit]
      Description=Software factory Cell edge
      After=network-online.target
      Wants=network-online.target

      [Service]
      WorkingDirectory=/srv/repo
      ExecStart=/usr/bin/sf cell start --name edge
      EnvironmentFile=/var/lib/sf/service/sf-cell-edge.env
      Restart=on-failure
      RestartSec=5

      [Install]
      WantedBy=default.target
      "
    `);
  });

  it('quotes and escapes values that systemd would split or expand', () => {
    // Arrange
    const input = {
      execArgs: ['/opt/sf dir/sf', 'cell', 'start'],
      env: { NOTE: 'a "b" $HOME 100%' },
    };

    // Act
    const text = serverUnitOf(input);

    // Assert
    expect(text).toContain('ExecStart="/opt/sf dir/sf" cell start');
    expect(text).toContain('Environment="NOTE=a \\"b\\" $$HOME 100%%"');
  });
});
