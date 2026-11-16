const COLUMNS = [
  { key: 'learner', label: 'Learner', sortable: true },
  { key: 'course', label: 'Course', sortable: true },
  { key: 'serial', label: 'Serial number', sortable: true },
  { key: 'issued_date', label: 'Issued (local)', sortable: true },
  { key: 'status', label: 'Status', sortable: false },
];

function SortIndicator({ active, direction }) {
  if (!active) return <span className="sort-indicator" aria-hidden="true">↕</span>;
  return (
    <span className="sort-indicator is-active" aria-hidden="true">
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  );
}

function StatusPill({ status }) {
  return (
    <span className={`pill ${status === 'ACTIVE' ? 'pill-active' : 'pill-revoked'}`}>
      {status === 'ACTIVE' ? 'Active' : 'Revoked'}
    </span>
  );
}

export default function CertificateTable({
  items,
  loading,
  error,
  onRetry,
  sortKey,
  sortDir,
  onSort,
  onSelect,
  page,
  totalPages,
  total,
  pageSize,
  onPageSizeChange,
  onPageChange,
  search,
}) {
  return (
    <div className="table-wrap">
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className={column.key === 'status' ? 'col-status' : undefined}>
                {column.sortable ? (
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => onSort(column.key)}
                    aria-sort={
                      sortKey === column.key
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {column.label}
                    <SortIndicator active={sortKey === column.key} direction={sortDir} />
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
            <th className="col-actions" aria-label="Actions" />
          </tr>
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, index) => (
              <tr key={`skeleton-${index}`} className="skeleton-row">
                <td colSpan={6}>
                  <div className="skeleton" />
                </td>
              </tr>
            ))}

          {!loading && items.map((item) => (
            <tr key={item.id} onClick={() => onSelect(item.id)} className="clickable">
              <td>
                <span className="strong">{item.learnerName}</span>
              </td>
              <td>{item.courseTitle}</td>
              <td>
                <span className="mono">{item.serial}</span>
              </td>
              <td>
                <span className="mono">{item.issuedLocalDateTime}</span>
              </td>
              <td>
                <StatusPill status={item.status} />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(item.id);
                  }}
                >
                  View
                </button>
              </td>
            </tr>
          ))}

          {!loading && items.length === 0 && !error && (
            <tr>
              <td colSpan={6}>
                <div className="empty">
                  <p className="empty-title">
                    {search ? 'No certificates match this search' : 'No certificates issued yet'}
                  </p>
                  <p className="subtle">
                    {search
                      ? `Nothing matched "${search}". Try a learner name or a serial number.`
                      : 'Use bulk issue above to issue certificates for a course.'}
                  </p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="table-footer">
        <div className="subtle">
          {loading ? 'Loading…' : `${total} certificate${total === 1 ? '' : 's'}`}
        </div>

        <div className="pager">
          <label className="page-size">
            Rows
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn-small"
            onClick={() => onPageChange(page - 1)}
            disabled={loading || page <= 1}
          >
            Previous
          </button>
          <span className="subtle">
            Page {page} of {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onPageChange(page + 1)}
            disabled={loading || page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
