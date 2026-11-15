import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Boxes,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const SECTIONS: readonly Section[] = [
  { id: 'board', label: 'Board', icon: LayoutDashboard },
  { id: 'plans', label: 'Plans', icon: ListChecks },
  { id: 'intake', label: 'Intake', icon: Inbox },
  { id: 'cells', label: 'Cells', icon: Boxes },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'admin', label: 'Admin', icon: Settings },
];

const LAST_INDEX = SECTIONS.length - 1;

const NAV_BUTTON_CLASS =
  'flex items-center gap-2 rounded-control px-4 py-2 text-left text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink';

type SectionId = 'board' | 'plans' | 'intake' | 'cells' | 'projects' | 'admin';

type Section = {
  id: SectionId;
  label: string;
  icon: LucideIcon;
};

const indexAfterKey = (key: string, current: number): number | null => {
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return current === LAST_INDEX ? 0 : current + 1;
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return current === 0 ? LAST_INDEX : current - 1;
  }
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return LAST_INDEX;
  }
  return null;
};

export default function AppShell() {
  const [activeId, setActiveId] = useState<SectionId>('board');
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeSection = SECTIONS.find((section) => section.id === activeId);

  const handleNavKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentIndex = buttonRefs.current.findIndex(
      (button) => button === document.activeElement,
    );
    if (currentIndex === -1) {
      return;
    }
    const nextIndex = indexAfterKey(event.key, currentIndex);
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink font-sans">
      <a href="#main" className="ui-skip-link">
        Skip to main content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="ui-dashboard-centered flex items-center justify-between py-4">
          <p className="text-lg font-semibold">Software Factory</p>
        </div>
      </header>

      <div className="ui-dashboard-centered flex flex-1 flex-col gap-4 py-4 768:flex-row">
        <nav
          aria-label="Primary"
          className="z-(--z-sidebar) w-full 768:w-56 768:shrink-0"
          onKeyDown={handleNavKeyDown}
        >
          <ul className="flex gap-2 overflow-x-auto 768:flex-col">
            {SECTIONS.map((section, index) => {
              const Icon = section.icon;
              const isActive = section.id === activeId;
              return (
                <li key={section.id} className="shrink-0 768:shrink">
                  <button
                    ref={(element) => {
                      buttonRefs.current[index] = element;
                    }}
                    type="button"
                    className={NAV_BUTTON_CLASS}
                    aria-current={isActive ? 'page' : undefined}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveId(section.id)}
                  >
                    <Icon aria-hidden="true" className="size-5 shrink-0" />
                    <span>{section.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 rounded-control bg-surface p-section outline-none"
        >
          <h1 className="text-xl font-semibold">{activeSection?.label}</h1>
        </main>
      </div>
    </div>
  );
}
