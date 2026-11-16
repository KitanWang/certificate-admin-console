import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const OUTCOME_LABELS = {
  issued: 'Issued',
  skipped: 'Skipped',
  failed: 'Failed',
};

const REASON_LABELS = {
  already_certified: 'Already holds an active certificate',
  enrolment_not_completed: 'Enrolment not completed',
  issue_failed: 'Issuance failed',
};

export default function BulkIssuePanel({ courses, onCompleted, onError }) {
  const [courseId, setCourseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const inFlight = useRef(false);
  // One key per intended operation. A retry after a transport error reuses the
  // same key so the server can replay instead of issuing twice.
  const keys = useRef(new Map());

  useEffect(() => {
    if (courses.length === 0) {
      setCourseId('');
      return;
    }
    const exists = courses.some((course) => String(course.id) === String(courseId));
    if (!exists) setCourseId(String(courses[0].id));
  }, [courses, courseId]);

  const selected = courses.find((course) => String(course.id) === String(courseId));

  const submit = async () => {
    if (inFlight.current || !selected) return;

    inFlight.current = true;
    setBusy(true);
    setError(null);

    let key = keys.current.get(selected.id);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(selected.id, key);
    }

    try {
      const payload = await api.bulkIssue(selected.id, key);
      setResult(payload);
      keys.current.delete(selected.id);
      onCompleted?.(payload);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) keys.current.delete(selected.id);
      onError?.(err.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const counts = result?.counts;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Bulk issue</h2>
          <p className="subtle">
            Issues certificates to every completed learner who does not already hold one.
          </p>
        </div>
      </div>

      <div className="issue-controls">
        <label className="field">
          <span>Course</span>
          <select
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setResult(null);
              setError(null);
            }}
            disabled={courses.length === 0 || busy}
          >
            {courses.length === 0 && <option value="">No courses</option>}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} — {course.eligible} eligible of {course.completed} completed
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={busy || !selected || selected.eligible === 0}
        >
          {busy ? 'Issuing…' : 'Issue certificates'}
        </button>

        {busy && <span className="status-text">Working…</span>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {counts && (
        <div className="issue-result">
          <div className="summary">
            <span className="summary-item summary-issued">{counts.issued} issued</span>
            <span className="summary-item summary-skipped">{counts.skipped} skipped</span>
            <span className="summary-item summary-failed">{counts.failed} failed</span>
            <span className="subtle">{counts.total} learners evaluated</span>
          </div>

          <table className="table table-compact">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>Serial</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((row) => (
                <tr key={row.learnerId}>
                  <td className="strong">{row.learnerName}</td>
                  <td>
                    <span className={`pill pill-${row.outcome}`}>
                      {OUTCOME_LABELS[row.outcome] ?? row.outcome}
                    </span>
                  </td>
                  <td className="subtle">
                    {row.reason ? REASON_LABELS[row.reason] ?? row.reason : '—'}
                  </td>
                  <td className="mono">{row.serial ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="subtle">
            Batch {result.batchId} · key {result.idempotencyKey}
          </p>
        </div>
      )}
    </section>
  );
}
