/**
 * API client — switches between local (in-memory) and Cloudflare D1 backend.
 * Set window.SMS_API_BASE = 'https://your-worker.workers.dev' to use cloud.
 * Leave empty / undefined for offline demo mode (existing in-memory behavior).
 */
(function () {
  const BASE = (typeof window !== 'undefined' && window.SMS_API_BASE) || '';

  function token() {
    return localStorage.getItem('sms_token') || '';
  }

  async function req(path, opts = {}) {
    if (!BASE) throw new Error('NO_API');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      localStorage.removeItem('sms_token');
      throw new Error('UNAUTHORIZED');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }
    if (!res.ok) throw new Error(res.statusText);
    return res;
  }

  window.SMS_API = {
    enabled: !!BASE,
    base: BASE,

    async login(email, password) {
      const data = await req('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.token) localStorage.setItem('sms_token', data.token);
      return data;
    },

    logout() {
      localStorage.removeItem('sms_token');
    },

    async listStudents(params = {}) {
      const q = new URLSearchParams(params).toString();
      return req('/api/students' + (q ? '?' + q : ''));
    },

    async createStudent(data) {
      return req('/api/students', { method: 'POST', body: JSON.stringify(data) });
    },

    async updateStudent(id, data) {
      return req('/api/students/' + id, { method: 'PUT', body: JSON.stringify(data) });
    },

    async deleteStudent(id) {
      return req('/api/students/' + id, { method: 'DELETE' });
    },

    async getSettings() {
      return req('/api/settings');
    },

    async saveSettings(data) {
      return req('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
    },

    async runBackup() {
      return req('/api/backup', { method: 'POST' });
    },

    async backupLogs() {
      return req('/api/backup/logs');
    },

    exportCsvUrl() {
      return BASE + '/api/students/export';
    },
  };
})();
