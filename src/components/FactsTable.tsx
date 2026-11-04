import type { ReactNode } from 'react';
import { useCollapse } from './ResultSection';

export interface FactRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Set when the label is model text (document language). */
  labelLang?: string;
  /** Set when the value is model text (document language). */
  valueLang?: string;
  numeric?: boolean;
}

/** Two-column facts table; below 640 px CSS turns rows into label/value pairs. */
export function FactsTable({ rows, caption }: { rows: FactRow[]; caption?: string }) {
  const { visible, listId, toggle } = useCollapse(rows);
  return (
    <>
      <table id={listId} className="facts">
        {caption && <caption className="facts-caption">{caption}</caption>}
        <tbody>
          {visible.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                lang={row.labelLang}
                dir={row.labelLang ? 'auto' : undefined}
                className={row.labelLang ? 'facts-label-text' : undefined}
              >
                {row.label}
              </th>
              <td
                lang={row.valueLang}
                dir={row.valueLang ? 'auto' : undefined}
                className={row.numeric ? 'num' : undefined}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {toggle}
    </>
  );
}
