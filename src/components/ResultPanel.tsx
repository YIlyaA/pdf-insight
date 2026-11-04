import { useId, useMemo, type Ref } from 'react';
import { coverageLabel, downloadFileName } from '../lib/format';
import type { Coverage } from '../lib/pipeline';
import type { Insight } from '../lib/schema';
import { Button } from './Button';
import { COPY } from './copy';
import { downloadJson } from './downloadJson';
import { InsightView } from './InsightView';
import { JsonView } from './JsonView';
import { Tabs } from './Tabs';

interface ResultPanelProps {
  fileName: string;
  insight: Insight;
  coverage: Coverage | null;
  onCopy(json: string): void;
  onNext(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function ResultPanel(props: ResultPanelProps) {
  const { fileName, insight, coverage, onCopy, onNext, headingRef } = props;
  const headingId = useId();
  const json = useMemo(() => JSON.stringify(insight, null, 2), [insight]);

  return (
    <section className="panel result" aria-labelledby={headingId}>
      <div className="result-head">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="panel-title file-name"
          title={fileName}
        >
          {fileName}
        </h2>
        {coverage && (
          <p className="coverage">{coverageLabel(coverage.analyzedTo, coverage.totalPages)}</p>
        )}
        <div className="actions">
          <Button variant="primary" onClick={() => downloadJson(json, downloadFileName(fileName))}>
            {COPY.download}
          </Button>
          <Button onClick={() => onCopy(json)}>{COPY.copy}</Button>
          <Button variant="ghost" onClick={onNext}>
            {COPY.next}
          </Button>
        </div>
      </div>
      <Tabs
        labelledBy={headingId}
        tabs={[
          { id: 'preview', label: COPY.tabPreview, panel: <InsightView insight={insight} /> },
          {
            id: 'json',
            label: COPY.tabJson,
            panel: <JsonView json={json} />,
            panelClassName: 'json-box',
          },
        ]}
      />
    </section>
  );
}
