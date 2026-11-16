import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setActorToken, downloadCsv } from './api';
import BulkIssuePanel from './components/BulkIssuePanel.jsx';
import CertificateTable from './components/CertificateTable.jsx';
import CertificateDetail from './components/CertificateDetail.jsx';

const DEFAULT_SORT = 'issued_date';
const DEFAULT_DIR = 'desc';

export default function App() {
  const [actors, setActors] = useState([]);
  const [actor, setActor] = useState(null);
  const [bootError, setBootError] = useState(null);

  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey, setSortKey] = useState(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState(DEFAULT_DIR);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const listRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api
      .actors()
      .then((rows) => {
        if (cancelled) return;
        setActors(rows);
        if (rows.length > 0) {
          setActorToken(rows[0].token);
          setActor(rows[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) setBootError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!actor) return undefined;

    const requestId = listRequest.current + 1;
    listRequest.current = requestId;

    setLoading(true);
    setError(null);

    api
      .certificates({ q: debouncedSearch, sort: sortKey, dir: sortDir, page, pageSize })
      .then((data) => {
        if (listRequest.current !== requestId) return;
        setList(data);
        setLoading(false);
      })
      .catch((err) => {
        if (listRequest.current !== requestId) return;
        setError(err.message);
        setLoading(false);
      });

    return undefined;
  }, [actor, debouncedSearch, sortKey, sortDir, page, pageSize, refreshKey]);

  useEffect(() => {
    if (!actor) return undefined;
    let cancelled = false;
    api
      .courses()
      .then((rows) => {
        if (!cancelled) setCourses(rows);
      })
      .catch(() => {
        if (!cancelled) setCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, refreshKey]);

  const handleActorChange = (event) => {
    const next = actors.find((item) => item.token === event.target.value);
    if (!next) return;
    setActorToken(next.token);
    setActor(next);
    setList(null);
    setPage(1);
    setNotice(null);
    setError(null);
    setSelectedId(null);
  };

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'issued_date' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      await downloadCsv(
        { q: debouncedSearch, sort: sortKey, dir: sortDir },
        `certificates-${actor.tenantSlug}.csv`,
      );
      setNotice('Export downloaded with the current search and sort applied.');
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  if (bootError) {
    return (
      <div className="boot">
        <div className="alert alert-error">
          <strong>Cannot reach the API.</strong> {bootError}
        </div>
      </div>
    );
  }

  const tenantLabel = actor ? `${actor.tenantName} · ${actor.timezone}` : 'Loading tenant…';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Certificate Admin Console</h1>
            <p className="subtle">{tenantLabel}</p>
          </div>
        </div>

        <div className="actor-picker">
          <label htmlFor="actor-select">Acting admin</label>
          <select
            id="actor-select"
            value={actor ? actor.token : ''}
            onChange={handleActorChange}
            disabled={actors.length === 0}
          >
            {actors.map((item) => (
              <option key={item.token} value={item.token}>
                {item.email} ({item.tenantName})
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="content">
        <BulkIssuePanel
          courses={courses}
          onCompleted={() => {
            refresh();
            setNotice(null);
          }}
          onError={(message) => setError(message)}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by learner name or serial number"
                aria-label="Search certificates"
              />
            </div>

            <div className="toolbar-actions">
              <button type="button" className="btn" onClick={refresh} disabled={loading}>
                Refresh
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExport}
                disabled={exporting || !actor}
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          {notice && <div className="alert alert-success">{notice}</div>}

          <CertificateTable
            items={list?.items ?? []}
            loading={loading}
            error={error}
            onRetry={refresh}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSelect={(id) => setSelectedId(id)}
            page={list?.page ?? page}
            totalPages={list?.totalPages ?? 1}
            total={list?.total ?? 0}
            pageSize={pageSize}
            onPageSizeChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            onPageChange={(value) => setPage(value)}
            search={debouncedSearch}
          />
        </section>
      </main>

      {selectedId != null && (
        <CertificateDetail
          certificateId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
