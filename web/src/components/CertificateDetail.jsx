import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export default function CertificateDetail({ certificateId, onClose, onChanged }) {
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.certificate(certificateId);
      setCertificate(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [certificateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await api.revoke(certificateId);
      await load();
      setConfirming(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRevoking(false);
    }
  };

  const isActive = certificate?.status === 'ACTIVE';

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Certificate detail"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <h2>Certificate detail</h2>
            {certificate && <p className="subtle mono">{certificate.serial}</p>}
          </div>
          <button type="button" className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <div className="skeleton skeleton-block" />}

        {error && <div className="alert alert-error">{error}</div>}

        {!loading && certificate && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>Learner</dt>
                <dd className="strong">{certificate.learnerName}</dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>{certificate.courseTitle}</dd>
              </div>
              <div>
                <dt>Serial number</dt>
                <dd className="mono">{certificate.serial}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`pill ${isActive ? 'pill-active' : 'pill-revoked'}`}>
                    {isActive ? 'Active' : 'Revoked'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Issued ({certificate.tenant.timezone})</dt>
                <dd className="mono">{certificate.issuedLocalDateTime}</dd>
              </div>
              <div>
                <dt>Issued (UTC)</dt>
                <dd className="mono">{certificate.issuedAtUtc}</dd>
              </div>
              {certificate.revokedAtUtc && (
                <div>
                  <dt>Revoked ({certificate.tenant.timezone})</dt>
                  <dd className="mono">{certificate.revokedLocalDateTime}</dd>
                </div>
              )}
              {certificate.batchId && (
                <div>
                  <dt>Batch</dt>
                  <dd className="mono">{certificate.batchId}</dd>
                </div>
              )}
            </dl>

            <div className="section">
              <h3>Audit trail</h3>
              {certificate.auditEvents.length === 0 && (
                <p className="subtle">No audit events recorded.</p>
              )}
              <ul className="audit-list">
                {certificate.auditEvents.map((event) => (
                  <li key={event.id}>
                    <span className={`pill pill-${event.action.toLowerCase()}`}>{event.action}</span>
                    <span className="mono">{event.createdAtLocal}</span>
                    <span className="subtle">{event.actorEmail}</span>
                    {event.batchId && <span className="subtle mono">batch {event.batchId}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="dialog-actions">
              {!isActive && <span className="subtle">This certificate is already revoked.</span>}

              {isActive && !confirming && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setConfirming(true)}
                >
                  Revoke certificate
                </button>
              )}

              {isActive && confirming && (
                <div className="confirm">
                  <span>
                    Revoke this certificate? The learner will no longer hold a valid certificate.
                  </span>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setConfirming(false)}
                      disabled={revoking}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={revoke}
                      disabled={revoking}
                    >
                      {revoking ? 'Revoking…' : 'Confirm revoke'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
