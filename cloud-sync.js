(() => {
  'use strict';

  const CFG = window.CLOUD_CONFIG || {};
  const TOKEN_KEY = 'td_cloud_api_token';
  const META_KEY = 'td_cloud_meta_v81';
  const DEVICE_KEY = 'td_cloud_device_v8';
  const DIRTY_KEY = 'td_cloud_dirty_v81';
  const SYNCABLE_PREFIX = 'td_';
  const EXCLUDED_KEYS = new Set([TOKEN_KEY, META_KEY, DEVICE_KEY, DIRTY_KEY]);

  const POLL_MS = 15000;
  let autoTimer = null;
  let pollTimer = null;
  let syncing = false;
  let lastRemoteNoticeRevision = 0;

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() :
        'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function getActor() {
    try {
      const role = typeof window.getRole === 'function' ? window.getRole() : '';
      return role || 'browser-user';
    } catch (_) {
      return 'browser-user';
    }
  }

  function getToken(promptWhenMissing = true) {
    let token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token && promptWhenMissing) {
      token = (prompt(
        'Dán API_TOKEN của anh vào đây.\n' +
        'Token chỉ lưu trong trình duyệt này, không đưa lên GitHub.'
      ) || '').trim();
      if (token) localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  }

  function getMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function setMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(meta || {}));
    updateStatus();
  }

  function isDirty() {
    return localStorage.getItem(DIRTY_KEY) === '1';
  }

  function setDirty(value) {
    localStorage.setItem(DIRTY_KEY, value ? '1' : '0');
    updateStatus();
  }

  function isEditing() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function collectState() {
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || EXCLUDED_KEYS.has(key) || !key.startsWith(SYNCABLE_PREFIX)) continue;
      storage[key] = localStorage.getItem(key);
    }
    return {
      schema: 'td-cloud-state-v8',
      savedAt: new Date().toISOString(),
      appUrl: location.origin + location.pathname,
      storage
    };
  }

  function applyState(state) {
    if (!state || state.schema !== 'td-cloud-state-v8' || !state.storage) {
      throw new Error('Dữ liệu cloud không đúng định dạng');
    }

    const existing = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SYNCABLE_PREFIX) && !EXCLUDED_KEYS.has(key)) {
        existing.push(key);
      }
    }
    existing.forEach(key => localStorage.removeItem(key));

    Object.entries(state.storage).forEach(([key, value]) => {
      if (key.startsWith(SYNCABLE_PREFIX) && !EXCLUDED_KEYS.has(key)) {
        localStorage.setItem(key, String(value));
      }
    });
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      if (!CFG.apiUrl) return reject(new Error('Thiếu apiUrl trong cloud-config.js'));

      const callback = '__tdCloud_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('API phản hồi quá lâu')), 20000);

      function finish(error, data) {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) {}
        script.remove();
        error ? reject(error) : resolve(data);
      }

      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error('Không kết nối được Apps Script'));

      const url = new URL(CFG.apiUrl);
      Object.entries({...params, callback}).forEach(([key, value]) => {
        url.searchParams.set(key, String(value ?? ''));
      });
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  async function postForm(params) {
    if (!CFG.apiUrl) throw new Error('Thiếu apiUrl trong cloud-config.js');

    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => body.set(key, String(value ?? '')));

    const response = await fetch(CFG.apiUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body,
      redirect: 'follow'
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    try { return JSON.parse(text); }
    catch (_) { throw new Error('API trả về dữ liệu không hợp lệ'); }
  }

  async function getRemoteMeta() {
    const token = getToken(false);
    if (!token) return null;
    const result = await jsonp({
      action: 'meta',
      token,
      key: CFG.stateKey || 'MAIN'
    });
    if (!result.ok) throw new Error(result.error || 'API báo lỗi');
    return result;
  }

  async function checkApi() {
    const token = getToken(true);
    if (!token) throw new Error('Chưa nhập API_TOKEN');

    const result = await getRemoteMeta();
    setMeta({
      ...getMeta(),
      revision: Number(result.revision || 0),
      updatedAt: result.updatedAt || '',
      checkedAt: new Date().toISOString()
    });

    notify(
      result.exists
        ? `Kết nối thành công. Cloud đang ở revision ${result.revision || 0}.`
        : 'Kết nối thành công. Cloud chưa có dữ liệu.'
    );
    return result;
  }

  async function pushCloud(force = false, silent = false) {
    if (syncing) return;
    const token = getToken(true);
    if (!token) throw new Error('Chưa nhập API_TOKEN');

    syncing = true;
    updateStatus('Đang đẩy dữ liệu...');
    try {
      const stateText = JSON.stringify(collectState());
      const meta = getMeta();
      const result = await postForm({
        action: 'save',
        token,
        key: CFG.stateKey || 'MAIN',
        payload: utf8ToBase64(stateText),
        actor: getActor(),
        device: getDeviceId(),
        baseRevision: force ? '' : (meta.revision || '')
      });

      if (result.conflict) {
        setMeta({...meta, revision: Number(result.currentRevision || 0), updatedAt: result.updatedAt || ''});
        throw new Error(
          'Cloud đã được sửa trên máy khác. Hãy tải từ cloud trước, ' +
          'hoặc dùng “Ghi đè cloud” nếu chắc chắn máy này đúng.'
        );
      }
      if (!result.ok) throw new Error(result.error || 'Không lưu được dữ liệu');

      setDirty(false);
      setMeta({
        revision: Number(result.revision || 0),
        updatedAt: result.updatedAt || new Date().toISOString(),
        lastPushAt: new Date().toISOString()
      });

      if (!silent) notify(`Đã đẩy dữ liệu lên cloud – revision ${result.revision}.`);
      return result;
    } finally {
      syncing = false;
      updateStatus();
    }
  }

  async function pullCloud({silent = false, force = false} = {}) {
    if (syncing) return;
    const token = getToken(true);
    if (!token) throw new Error('Chưa nhập API_TOKEN');

    syncing = true;
    updateStatus('Đang tải dữ liệu...');
    try {
      const result = await jsonp({
        action: 'load',
        token,
        key: CFG.stateKey || 'MAIN'
      });
      if (!result.ok) throw new Error(result.error || 'Không tải được dữ liệu');
      if (!result.exists || !result.payload) {
        if (!silent) notify('Cloud chưa có dữ liệu. Hãy đẩy dữ liệu từ máy chính trước.');
        return result;
      }

      if (!force && isDirty()) {
        throw new Error('Máy này có thay đổi chưa đẩy lên cloud. Không tự tải đè.');
      }

      if (!silent) {
        const ok = confirm(
          `Tải dữ liệu cloud revision ${result.revision}?\n` +
          'Dữ liệu ứng dụng trên trình duyệt này sẽ được thay thế.'
        );
        if (!ok) return result;
      }

      const state = JSON.parse(base64ToUtf8(result.payload));
      applyState(state);
      setDirty(false);
      setMeta({
        revision: Number(result.revision || 0),
        updatedAt: result.updatedAt || '',
        lastPullAt: new Date().toISOString()
      });

      if (silent) {
        location.reload();
      } else {
        alert('Đã tải dữ liệu cloud. Trang sẽ tải lại.');
        location.reload();
      }
      return result;
    } finally {
      syncing = false;
      updateStatus();
    }
  }

  function scheduleAutoPush() {
    if (!CFG.autoSync || !getToken(false)) return;
    setDirty(true);
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      pushCloud(false, true).catch(error => {
        console.warn('[Cloud auto-sync]', error);
        updateStatus('Chưa đồng bộ: ' + error.message);
      });
    }, Number(CFG.autoSyncDelayMs || 5000));
  }

  async function pollRemote() {
    if (syncing || document.hidden || !getToken(false)) return;
    try {
      const remote = await getRemoteMeta();
      if (!remote || !remote.exists) return;

      const local = getMeta();
      const remoteRevision = Number(remote.revision || 0);
      const localRevision = Number(local.revision || 0);

      if (remoteRevision <= localRevision) return;

      setMeta({...local, remoteRevision, remoteUpdatedAt: remote.updatedAt || ''});

      if (!isDirty() && !isEditing()) {
        updateStatus(`Có dữ liệu mới r${remoteRevision} – đang tự cập nhật...`);
        await pullCloud({silent: true, force: true});
        return;
      }

      if (lastRemoteNoticeRevision !== remoteRevision) {
        lastRemoteNoticeRevision = remoteRevision;
        notify(
          `Cloud có dữ liệu mới revision ${remoteRevision}. ` +
          'Máy này đang chỉnh sửa hoặc có thay đổi chưa đồng bộ, nên chưa tự tải đè.'
        );
      }
      updateStatus(`Cloud mới hơn: r${remoteRevision} • máy này r${localRevision}`);
    } catch (error) {
      console.warn('[Cloud poll]', error);
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollRemote, POLL_MS);
    setTimeout(pollRemote, 2500);
  }

  function hookApplicationSaves() {
    if (typeof window.saveRaw === 'function' && !window.saveRaw.__cloudWrapped) {
      const original = window.saveRaw;
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        scheduleAutoPush();
        return result;
      };
      wrapped.__cloudWrapped = true;
      window.saveRaw = wrapped;
    }

    if (typeof window.setDB === 'function' && !window.setDB.__cloudWrapped) {
      const original = window.setDB;
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        scheduleAutoPush();
        return result;
      };
      wrapped.__cloudWrapped = true;
      window.setDB = wrapped;
    }

    const originalSetItem = localStorage.setItem.bind(localStorage);
    if (!localStorage.__tdCloudPatched) {
      localStorage.setItem = function(key, value) {
        originalSetItem(key, value);
        if (
          typeof key === 'string' &&
          key.startsWith(SYNCABLE_PREFIX) &&
          !EXCLUDED_KEYS.has(key)
        ) {
          scheduleAutoPush();
        }
      };
      localStorage.__tdCloudPatched = true;
    }
  }

  function notify(message) {
    if (typeof window.toast === 'function') window.toast(message);
    else alert(message);
  }

  function updateStatus(customText = '') {
    const el = document.getElementById('tdCloudStatus');
    const badge = document.getElementById('tdCloudBadge');
    const meta = getMeta();

    let text = customText;
    if (!text) {
      if (!getToken(false)) text = 'Chưa nhập API token';
      else if (isDirty()) text = `Có thay đổi chưa đồng bộ${meta.revision ? ' • cloud r' + meta.revision : ''}`;
      else if (meta.revision) {
        text = `Cloud r${meta.revision}${meta.updatedAt ? ' • ' + new Date(meta.updatedAt).toLocaleString('vi-VN') : ''}`;
      } else text = 'Cloud đã cấu hình, chưa có revision';
    }

    if (el) el.textContent = text;
    if (badge) {
      badge.textContent = isDirty() ? '● Chưa đồng bộ' : (meta.revision ? `● r${meta.revision}` : '● Cloud');
      badge.style.color = isDirty() ? '#fbbf24' : '#4ade80';
    }
  }

  function run(action) {
    Promise.resolve().then(action).catch(error => {
      console.error('[Cloud V8.1]', error);
      alert('Lỗi Cloud: ' + (error.message || error));
    });
  }

  function clearToken() {
    if (!confirm('Xóa API token đang lưu trên trình duyệt này?')) return;
    localStorage.removeItem(TOKEN_KEY);
    setMeta({});
    setDirty(false);
    updateStatus();
    notify('Đã xóa API token trên máy này.');
  }

  function injectUi() {
    if (document.getElementById('tdCloudPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'tdCloudPanel';
    panel.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:60;
      width:min(430px,calc(100vw - 32px));background:#0b1728;
      border:1px solid #263955;border-radius:16px;padding:14px;
      color:#e9f1ff;box-shadow:0 22px 60px rgba(0,0,0,.45);
      display:none
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <b style="font-size:17px">☁ Đồng bộ Google Sheets V8.1</b>
        <button id="tdCloudClose" class="btn">✕</button>
      </div>
      <div id="tdCloudStatus" class="muted" style="margin:10px 0 12px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button id="tdCloudPush" class="btn primary">↑ Đẩy lên cloud</button>
        <button id="tdCloudPull" class="btn blue">↓ Tải từ cloud</button>
        <button id="tdCloudCheck" class="btn">✓ Kiểm tra API</button>
        <button id="tdCloudForce" class="btn red">⚠ Ghi đè cloud</button>
      </div>
      <button id="tdCloudToken" class="btn" style="width:100%;margin-top:8px">🔑 Đổi / xóa API token</button>
      <p class="muted" style="font-size:12px;margin:10px 0 0">
        Tự đẩy sau khi lưu/import. Mỗi 15 giây kiểm tra dữ liệu mới và tự tải khi máy này không có thay đổi chưa lưu.
      </p>
    `;
    document.body.appendChild(panel);

    const actions = document.querySelector('.actions');
    if (actions && !document.getElementById('tdCloudOpen')) {
      const open = document.createElement('button');
      open.id = 'tdCloudOpen';
      open.className = 'btn blue';
      open.innerHTML = `☁ Cloud <span id="tdCloudBadge" style="font-size:11px;color:#4ade80"></span>`;
      open.onclick = () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        updateStatus();
      };
      actions.prepend(open);
    }

    document.getElementById('tdCloudClose').onclick = () => panel.style.display = 'none';
    document.getElementById('tdCloudCheck').onclick = () => run(checkApi);
    document.getElementById('tdCloudPush').onclick = () => run(() => pushCloud(false, false));
    document.getElementById('tdCloudPull').onclick = () => run(() => pullCloud({silent:false, force:false}));
    document.getElementById('tdCloudForce').onclick = () => {
      if (confirm('Ghi đè dữ liệu cloud bằng dữ liệu máy này?')) run(() => pushCloud(true, false));
    };
    document.getElementById('tdCloudToken').onclick = clearToken;
    updateStatus();
  }

  function init() {
    if (!CFG.apiUrl) {
      console.error('[Cloud V8.1] Thiếu apiUrl trong cloud-config.js');
      return;
    }

    getDeviceId();
    injectUi();
    hookApplicationSaves();
    startPolling();

    setTimeout(hookApplicationSaves, 1500);
    setTimeout(hookApplicationSaves, 4000);

    window.addEventListener('focus', pollRemote);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollRemote();
    });
  }

  window.TDCloud = Object.freeze({
    check: checkApi,
    push: () => pushCloud(false, false),
    pull: () => pullCloud({silent:false, force:false}),
    forcePush: () => pushCloud(true, false),
    clearToken,
    poll: pollRemote
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
