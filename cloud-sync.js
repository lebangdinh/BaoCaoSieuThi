(() => {
  'use strict';

  const CFG = window.CLOUD_CONFIG || {};
  const TOKEN_KEY = 'td_cloud_api_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function requireToken() {
    let token = getToken();
    if (!token) {
      token = prompt('Dán API_TOKEN của anh vào đây. Token chỉ lưu trong trình duyệt này, không đưa lên GitHub.');
      if (token) {
        token = token.trim();
        localStorage.setItem(TOKEN_KEY, token);
      }
    }
    if (!token) throw new Error('Chưa nhập API_TOKEN');
    return token;
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const callback = '__tdCloudCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => cleanup(new Error('API phản hồi quá lâu')), 15000);

      function cleanup(error, data) {
        clearTimeout(timer);
        delete window[callback];
        script.remove();
        error ? reject(error) : resolve(data);
      }

      window[callback] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error('Không kết nối được Apps Script'));

      const url = new URL(CFG.apiUrl);
      Object.entries({...params, callback}).forEach(([k, v]) => url.searchParams.set(k, v));
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  async function checkApi() {
    const token = requireToken();
    const result = await jsonp({action: 'meta', token, key: CFG.stateKey || 'MAIN'});
    if (!result.ok) throw new Error(result.error || 'API báo lỗi');
    alert(`Kết nối thành công API V8\nRevision hiện tại: ${result.revision || 0}`);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    alert('Đã xóa API_TOKEN trên trình duyệt này.');
  }

  function injectButton() {
    const actions = document.querySelector('.actions');
    if (!actions || document.getElementById('cloudCheckBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'cloudCheckBtn';
    btn.className = 'btn blue';
    btn.textContent = '☁ Kiểm tra Cloud';
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Đang kiểm tra...';
        await checkApi();
      } catch (err) {
        alert('Lỗi Cloud: ' + (err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = '☁ Kiểm tra Cloud';
      }
    };
    actions.prepend(btn);

    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = '🔑 Đổi token';
    reset.onclick = clearToken;
    actions.prepend(reset);
  }

  if (!CFG.apiUrl) {
    console.error('[Cloud] Thiếu apiUrl trong assets/cloud-config.js');
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
