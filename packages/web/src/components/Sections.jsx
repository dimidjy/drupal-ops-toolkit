import { useState } from 'react';
import { Board } from './Board.jsx';
import { History } from './History.jsx';
import { Jira } from './Jira.jsx';
import { PageCompare } from './PageCompare.jsx';
import { Pipelines } from './Pipelines.jsx';
import { Review } from './Review.jsx';
import { Tests } from './Tests.jsx';
import { Visual } from './Visual.jsx';
import { VisualTesting } from './VisualTesting.jsx';

/** @import { Api } from '../api.js' */

/**
 * @param {string} id
 * @param {readonly (readonly [string, string])[]} tabs
 */
function savedTab(id, tabs) {
  const fallback = /** @type {string} */ (tabs[0]?.[0]);
  try {
    const value = localStorage.getItem(`dops-tab-${id}`);
    return tabs.some(([key]) => key === value) ? /** @type {string} */ (value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The shape every dashboard section shares: a title, a switch between its tabs
 * (the chosen one is remembered per section) and the tab's content.
 *
 * @param {{ id: string, title: string, tabs: readonly (readonly [string, string])[],
 *   children: (tab: string) => import('react').ReactNode }} props
 */
export function TabbedSection({ id, title, tabs, children }) {
  const [tab, setTab] = useState(() => savedTab(id, tabs));

  /** @param {string} next */
  function choose(next) {
    setTab(next);
    try {
      localStorage.setItem(`dops-tab-${id}`, next);
    } catch {
      return;
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <div className="segmented" role="tablist" aria-label={`${title} views`}>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => choose(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {children(tab)}
    </section>
  );
}

/**
 * @param {{ api: Api, onOpenRun: (runId: string) => void }} props
 */
export function DeploySection({ api, onOpenRun }) {
  return (
    <TabbedSection
      id="deploy"
      title="Deploy"
      tabs={[
        ['pipelines', 'Pipelines'],
        ['history', 'History'],
      ]}
    >
      {(tab) =>
        tab === 'pipelines' ? (
          <Pipelines api={api} onStarted={onOpenRun} />
        ) : (
          <History api={api} onOpen={onOpenRun} />
        )
      }
    </TabbedSection>
  );
}

/** @param {{ api: Api }} props */
export function TestsSection({ api }) {
  return (
    <TabbedSection
      id="tests"
      title="UI tests"
      tabs={[
        ['run', 'Run'],
        ['history', 'History'],
      ]}
    >
      {(tab) => <Tests api={api} view={/** @type {'run' | 'history'} */ (tab)} />}
    </TabbedSection>
  );
}

/** @param {{ api: Api }} props */
export function VisualSection({ api }) {
  return (
    <TabbedSection
      id="visual"
      title="Visual"
      tabs={[
        ['before-after', 'Before / after'],
        ['a-b', 'A vs B'],
        ['reports', 'Reports'],
      ]}
    >
      {(tab) =>
        tab === 'before-after' ? (
          <VisualTesting api={api} />
        ) : tab === 'a-b' ? (
          <PageCompare api={api} />
        ) : (
          <Visual api={api} />
        )
      }
    </TabbedSection>
  );
}

/** @param {{ api: Api }} props */
export function ReviewSection({ api }) {
  return (
    <TabbedSection
      id="review"
      title="Review"
      tabs={[
        ['review', 'Review'],
        ['history', 'History'],
      ]}
    >
      {(tab) => <Review api={api} view={/** @type {'review' | 'history'} */ (tab)} />}
    </TabbedSection>
  );
}

/** @param {{ api: Api }} props */
export function JiraSection({ api }) {
  return (
    <TabbedSection
      id="jira"
      title="Jira"
      tabs={[
        ['issue', 'Issue'],
        ['board', 'Board'],
        ['reports', 'Board history'],
      ]}
    >
      {(tab) =>
        tab === 'issue' ? (
          <Jira api={api} />
        ) : (
          <Board api={api} view={tab === 'board' ? 'board' : 'history'} />
        )
      }
    </TabbedSection>
  );
}
