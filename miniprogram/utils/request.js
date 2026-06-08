/**
 * 统一 HTTP 请求封装：自动注入 JWT、设备 ID、UA。
 */
const app = getApp();
const DEV_FALLBACK_BASE_URL = 'http://127.0.0.1:8080/api/v1';

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

function shouldRetryWithLocalhost(resOrErr) {
  const baseUrl = app.globalData.baseUrl || '';
  if (baseUrl.indexOf('127.0.0.1') >= 0 || baseUrl.indexOf('localhost') >= 0) return false;
  const statusCode = resOrErr && resOrErr.statusCode;
  const errMsg = resOrErr && resOrErr.errMsg ? resOrErr.errMsg : '';
  return !statusCode || statusCode === 404 || statusCode >= 500 || errMsg.indexOf('fail') >= 0;
}

function request(method, path, data) {
  return doRequest(method, app.globalData.baseUrl, path, data, true);
}

function doRequest(method, baseUrl, path, data, allowLocalRetry) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + path,
      method,
      data,
      header: {
        'content-type': 'application/json',
        Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
        'X-Platform': 'wechat',
        'X-App-Version': '0.1.0'
      },
      success: res => {
        const body = parseBody(res.data);
        if (res.statusCode === 200 && body && body.code === 0) {
          resolve(body.data);
        } else {
          console.warn('[http]', method, path, res.statusCode, body);
          if (allowLocalRetry && shouldRetryWithLocalhost(res)) {
            doRequest(method, DEV_FALLBACK_BASE_URL, path, data, false).then(resolve).catch(reject);
            return;
          }
          reject(normalizeError({ ...res, data: body }, `请求失败(${res.statusCode})`));
        }
      },
      fail: err => {
        console.warn('[http.fail]', method, path, err);
        if (allowLocalRetry && shouldRetryWithLocalhost(err)) {
          doRequest(method, DEV_FALLBACK_BASE_URL, path, data, false).then(resolve).catch(reject);
          return;
        }
        reject(normalizeFail(err));
      }
    });
  });
}

module.exports = {
  get: (path, data) => request('GET', path, data),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  del: (path, data) => request('DELETE', path, data),
  upload(path, filePath, name = 'file', formData = {}) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: app.globalData.baseUrl + path,
        filePath,
        name,
        formData,
        header: {
          Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
          'X-Platform': 'wechat',
          'X-App-Version': '0.1.0'
        },
        success: res => {
          const body = parseBody(res.data);
          if (res.statusCode === 200 && body && body.code === 0) {
            resolve(body.data);
          } else {
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
};
