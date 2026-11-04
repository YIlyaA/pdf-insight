import { useId, useMemo, type Ref } from 'react';
import {
  coverageLabel,
  docTypeLabel,
  downloadFileName,
  formatDate,
  formatInsightText,
  languageName,
  pagesLabel,
} from '../lib/format';
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
  /** Copies text to the clipboard and announces the outcome politely. */
  onCopy(text: string): void;
  onNext(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** Small facts under the title: type, language, pages, date (a null date is left out). */
function factChips(doc: Insight['document']): string[] {
  const chips = [
    docTypeLabel(doc.type),
    COPY.languageChip(languageName(doc.language)),
    pagesLabel(doc.pages),
  ];
  if (doc.date) chips.push(formatDate(doc.date));
  return chips;
}

export function ResultPanel(props: ResultPanelProps) {
  const { fileName, insight, coverage, onCopy, onNext, headingRef } = props;
  const headingId = useId();
  const json = useMemo(() => JSON.stringify(insight, null, 2), [insight]);
  const { title, language } = insight.document;

  return (
    <section className="panel result" aria-labelledby={headingId}>
      <header className="result-head">
        {title && (
          <p className="panel-meta file-name" title={fileName}>
            {fileName}
          </p>
        )}
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="panel-title result-title"
          lang={title ? language : undefined}
          dir="auto"
        >
          {title ?? fileName}
        </h2>
        <ul className="chips">
          {factChips(insight.document).map((chip, index) => (
            <li key={index} className="chip">
              {chip}
            </li>
          ))}
        </ul>
        {coverage && (
          <p className="coverage">{coverageLabel(coverage.analyzedTo, coverage.totalPages)}</p>
        )}
      </header>
      <div className="actions">
        <Button variant="primary" onClick={() => downloadJson(json, downloadFileName(fileName))}>
          {COPY.download}
        </Button>
        <Button onClick={() => onCopy(formatInsightText(insight))}>{COPY.copyText}</Button>
        <Button onClick={() => onCopy(json)}>{COPY.copy}</Button>
        <Button variant="ghost" onClick={onNext}>
          {COPY.next}
        </Button>
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
