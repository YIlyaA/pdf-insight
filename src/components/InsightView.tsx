import { docTypeLabel, formatAmount, formatDate, languageName, pagesLabel } from '../lib/format';
import type { Insight } from '../lib/schema';
import { COPY } from './copy';
import { FactsTable, type FactRow } from './FactsTable';
import { NoData, ResultSection, TextList } from './ResultSection';

type Amount = Insight['amounts'][number];

function groupByCurrency(amounts: Insight['amounts']): [string, Amount[]][] {
  const groups = new Map<string, Amount[]>();
  for (const amount of amounts) {
    const group = groups.get(amount.currency);
    if (group) group.push(amount);
    else groups.set(amount.currency, [amount]);
  }
  return Array.from(groups);
}

function documentRows(insight: Insight): FactRow[] {
  const { document: doc } = insight;
  return [
    { key: 'language', label: COPY.fields.language, value: languageName(doc.language) },
    { key: 'type', label: COPY.fields.type, value: docTypeLabel(doc.type) },
    {
      key: 'title',
      label: COPY.fields.title,
      value: doc.title ?? COPY.noData,
      valueLang: doc.title ? doc.language : undefined,
    },
    { key: 'date', label: COPY.fields.date, value: doc.date ? formatDate(doc.date) : COPY.noData },
    // Not numeric: every Dokument value is left-aligned, like the label/value rows above it.
    { key: 'pages', label: COPY.fields.pages, value: pagesLabel(doc.pages) },
  ];
}

/** "Podgląd" tab. Every model string is a text node tagged with the document language. */
export function InsightView({ insight }: { insight: Insight }) {
  const lang = insight.document.language;
  const amountGroups = groupByCurrency(insight.amounts);
  const dateRows: FactRow[] = insight.dates.map((item, index) => ({
    key: `${item.date}-${index}`,
    label: item.context || COPY.noData,
    labelLang: item.context ? lang : undefined,
    value: formatDate(item.date),
    numeric: true,
  }));

  return (
    <div className="result-grid">
      <div className="result-column">
        <ResultSection title={COPY.sections.summary} className="result-section-lead">
          <p className="summary" lang={lang} dir="auto">
            {insight.summary}
          </p>
        </ResultSection>
        <ResultSection title={COPY.sections.keyPoints}>
          <TextList items={insight.keyPoints} lang={lang} />
        </ResultSection>
      </div>
      <div className="result-column">
        <ResultSection title={COPY.sections.document}>
          <FactsTable rows={documentRows(insight)} />
        </ResultSection>
        <ResultSection title={COPY.sections.entities}>
          <h4 className="result-subtitle">{COPY.organizations}</h4>
          <TextList items={insight.entities.organizations} lang={lang} />
          <h4 className="result-subtitle">{COPY.people}</h4>
          <TextList items={insight.entities.people} lang={lang} />
        </ResultSection>
        <ResultSection title={COPY.sections.amounts}>
          {amountGroups.length === 0 ? (
            <NoData />
          ) : (
            amountGroups.map(([currency, items]) => (
              <FactsTable
                key={currency}
                caption={currency}
                rows={items.map((item, index) => ({
                  key: `${currency}-${index}`,
                  label: item.context || COPY.noData,
                  labelLang: item.context ? lang : undefined,
                  value: formatAmount(item.value, item.currency),
                  numeric: true,
                }))}
              />
            ))
          )}
        </ResultSection>
        <ResultSection title={COPY.sections.dates}>
          {dateRows.length === 0 ? <NoData /> : <FactsTable rows={dateRows} />}
        </ResultSection>
        <ResultSection title={COPY.sections.keywords}>
          <TextList items={insight.keywords} lang={lang} variant="tags" />
        </ResultSection>
      </div>
    </div>
  );
}
