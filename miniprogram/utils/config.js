const APP_VERSION = '0.2.0';

const API_BASE_URLS = {
  develop: 'https://api.jkcqplan.com/api/v1',
  trial: 'https://api.jkcqplan.com/api/v1',
  release: 'https://api.jkcqplan.com/api/v1'
};

function getEnvVersion() {
  try {
    const account = wx.getAccountInfoSync();
    return account && account.miniProgram && account.miniProgram.envVersion
      ? account.miniProgram.envVersion
      : 'develop';
  } catch (e) {
    return 'develop';
  }
}

function getApiBaseUrl() {
  try {
    const override = wx.getStorageSync('hrp_api_base_url');
    if (override && !isPrivateDevUrl(override)) return override;
    if (override) wx.removeStorageSync('hrp_api_base_url');
  } catch (e) {}

  const envVersion = getEnvVersion();
  return API_BASE_URLS[envVersion] || API_BASE_URLS.develop;
}

function isPrivateDevUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url || '');
}

module.exports = {
  APP_VERSION,
  API_BASE_URLS,
  getEnvVersion,
  getApiBaseUrl
};
