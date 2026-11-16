let actorToken = null;

export function setActorToken(token) {
  actorToken = token;
}

export function getActorToken() {
  return actorToken;
}

function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (actorToken) headers['X-Actor-Token'] = actorToken;
  if (options.body) headers['Content-Type'] = 'application/json';

  return fetch(path, { ...options, headers });
}

async function readJson(response) {
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const error = new Error(
      payload?.message || payload?.error || `Request failed with status ${response.status}`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return response.json();
}

export const api = {
  actors: () => request('/api/actors').then(readJson),

  courses: () => request('/api/courses').then(readJson),

  certificates: (params) => request(`/api/certificates?${buildQuery(params)}`).then(readJson),

  certificate: (id) => request(`/api/certificates/${id}`).then(readJson),

  revoke: (id) => request(`/api/certificates/${id}/revoke`, { method: 'POST' }).then(readJson),

  bulkIssue: (courseId, idempotencyKey) =>
    request('/api/bulk-issue', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ courseId }),
    }).then(readJson),

  exportCsv: (params) => request(`/api/certificates/export?${buildQuery(params)}`),
};

export async function downloadCsv(params, filename) {
  const response = await api.exportCsv(params);
  if (!response.ok) {
    let message = `Export failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message || payload?.error || message;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
