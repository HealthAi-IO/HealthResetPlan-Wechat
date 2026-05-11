/**
 * 统一 HTTP 请求封装：自动注入 JWT、设备 ID、UA。
 */
const app = getApp();

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.baseUrl + path,
      method,
      data,
      header: {
        Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
        'X-Platform': 'wechat',
        'X-App-Version': '0.1.0'
      },
      success: res => {
        if (res.statusCode === 200 && res.data && res.data.code === 0) {
          resolve(res.data.data);
        } else {
          reject(res.data || { code: res.statusCode, message: 'request_failed' });
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  get: (path, data) => request('GET', path, data),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  del: (path, data) => request('DELETE', path, data)
};
