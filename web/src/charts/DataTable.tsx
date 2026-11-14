import type { ReactNode } from 'react'

/** "A table behind every chart" (docs/accessibility.md): a disclosure with the chart's numbers. */
export function DataTable({ summary, caption, head, rows }: { summary: string; caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="data-table">
      <summary>{summary}</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {c}
                    </th>
                  ) : (
                    <td key={j}>{c}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
