/**
 * 统一 HTTP 请求封装：自动注入 JWT、平台信息，并统一解包 { code, message, data }。
 */
const app = getApp();
let redirectingToLogin = false;

function parseBody(body) {
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch (e) { return body; }
}

function normalizeError(res, fallbackMessage) {
  const body = parseBody(res && res.data);
  if (body && typeof body === 'object') {
    return {
      code: body.code || (res && res.statusCode) || -1,
      message: body.message || body.msg || fallbackMessage,
      data: body.data,
      traceId: body.traceId
    };
  }
  return {
    code: (res && res.statusCode) || -1,
    message: body || fallbackMessage,
  };
}

function isAuthExpired(res, body) {
  const statusCode = res && res.statusCode;
  if (statusCode === 401) return true;
  if (statusCode === 403 && (!body || typeof body !== 'object' || !body.code)) return true;
  return false;
}

function handleAuthExpired() {
  app.clearAuth();
  if (redirectingToLogin) return;
  redirectingToLogin = true;

  wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
  setTimeout(() => {
    redirectingToLogin = false;
    const pages = getCurrentPages();
    const current = pages.length ? pages[pages.length - 1].route : '';
    if (current === 'pages/login/index') return;
    wx.navigateTo({ url: '/pages/login/index' });
  }, 500);
}

function normalizeFail(err) {
  const errMsg = err && err.errMsg ? err.errMsg : '';
  if (errMsg.indexOf('url not in domain list') >= 0 || errMsg.indexOf('不在以下 request 合法域名列表中') >= 0) {
    return { code: -1, message: '请在开发者工具勾选“不校验合法域名”' };
  }
  if (errMsg.indexOf('fail') >= 0 || errMsg.indexOf('timeout') >= 0) {
    return { code: -1, message: '无法连接服务器，请检查后端和网络' };
  }
  return { code: -1, message: errMsg || '网络异常，请稍后重试' };
}

function request(method, path, data, extraHeaders = {}) {
  return doRequest(method, app.globalData.baseUrl, path, data, extraHeaders);
}

function doRequest(method, baseUrl, path, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + path,
      method,
      data,
      timeout: requestTimeout(path),
      header: {
        'content-type': 'application/json',
        Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
        'X-Platform': 'wechat',
        'X-App-Version': app.globalData.appVersion || '0.2.0',
        ...extraHeaders
      },
      success: res => {
        const body = parseBody(res.data);
        if (res.statusCode === 200 && body && body.code === 0) {
          resolve(body.data);
        } else {
          if (isAuthExpired(res, body)) {
            handleAuthExpired();
            reject(normalizeError({ ...res, data: body }, '登录已过期，请重新登录'));
            return;
          }
          console.warn('[http]', method, path, res.statusCode, body);
          reject(normalizeError({ ...res, data: body }, `请求失败(${res.statusCode})`));
        }
      },
      fail: err => {
        console.warn('[http.fail]', method, path, err);
        reject(normalizeFail(err));
      }
    });
  });
}

function uploadTo(baseUrl, path, filePath, name, formData) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: baseUrl + path,
      filePath,
      name,
      formData,
      timeout: requestTimeout(path),
      header: {
        Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
        'X-Platform': 'wechat',
        'X-App-Version': app.globalData.appVersion || '0.2.0'
      },
      success: res => {
        const body = parseBody(res.data);
        if (res.statusCode === 200 && body && body.code === 0) {
          resolve(body.data);
        } else {
          if (isAuthExpired(res, body)) {
            handleAuthExpired();
            reject(normalizeError({ ...res, data: body }, '登录已过期，请重新登录'));
            return;
          }
          console.warn('[upload]', path, res.statusCode, body);
          reject(normalizeError({ ...res, data: body }, `上传失败(${res.statusCode})`));
        }
      },
      fail: err => {
        console.warn('[upload.fail]', path, err);
        reject(normalizeFail(err));
      }
    });
  });
}

module.exports = {
  get: (path, data, headers) => request('GET', path, data, headers),
  post: (path, data, headers) => request('POST', path, data, headers),
  put: (path, data, headers) => request('PUT', path, data, headers),
  del: (path, data, headers) => request('DELETE', path, data, headers),
  upload(path, filePath, name = 'file', formData = {}) {
    return uploadTo(app.globalData.baseUrl, path, filePath, name, formData);
  }
};

function requestTimeout(path) {
  return path.indexOf('/ai/') >= 0 || path.indexOf('/reports/analyze') >= 0
    ? 120000
    : 15000;
}
