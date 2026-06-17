# HealthResetPlan-Wechat

健康重启计划微信小程序，功能与 Flutter APP 主流程对齐，包含健康档案、指标录入、报告 OCR、AI 计划、打卡、趋势统计、AI 助理、会员中心和端到端加密云同步。

## 目录

```text
HealthResetPlan-Wechat/
├── project.config.json              # 微信开发者工具打开这个目录时使用
├── project.private.config.json      # 个人本地配置，不建议提交真实敏感信息
└── miniprogram/
    ├── app.js / app.json / app.wxss
    ├── pages/
    │   ├── home/                    # 首页仪表盘
    │   ├── profile/                 # 健康档案
    │   ├── indicators/              # 指标录入与历史
    │   ├── report/                  # 检查报告 OCR
    │   ├── plan/                    # 本地 7 天计划 + AI 个性化计划
    │   ├── clock/                   # 饮食、运动、用药、称重打卡
    │   ├── stats/                   # 趋势统计
    │   ├── chat/                    # AI 健康助理
    │   ├── membership/              # 会员中心
    │   ├── sync/                    # 端到端加密云同步
    │   └── settings/                # 我的
    ├── components/
    └── utils/
        ├── config.js                # 开发/体验/正式版 API 地址
        ├── http.js                  # 统一 HTTP 入口
        ├── request.js               # wx.request / uploadFile 封装
        ├── storage.js               # 本地健康数据
        ├── plan.js                  # 计划生成与 AI 计划解析
        └── sync.js                  # 加密同步队列
```

## 已对齐的 APP 功能

- 首页：今日完成度、关键指标、今日计划、快捷入口、云同步入口。
- 健康档案：昵称、性别、年龄、身高体重、目标、慢病标签、用药记录。
- 指标：体重、血压、血糖、心率、血脂、体脂、腰围、血氧、睡眠、步数。
- 报告 OCR：拍照/相册上传，后端 AI 识别后可导入指标。
- 计划：本地 7 天计划，登录会员后调用 `/ai/plan/generate` 生成 AI 计划。
- 打卡：饮食、运动、用药、称重、饮水记录与提醒规则。
- 统计：按指标展示最近趋势、历史记录和头像上传。
- AI 助理：调用 `/ai/chat`，结合档案和最近指标生成建议。
- 会员：套餐、兑换码、微信支付下单占位。
- 云同步：指标数据入队、客户端加密、推送/拉取。

## 本地开发

1. 安装并打开微信开发者工具。
2. 选择“导入项目”，目录选择 `HealthResetPlan-Wechat`，不要直接选 `miniprogram`。
3. 把 `project.config.json` 里的 `appid` 替换成你自己的小程序 AppID。
4. 后端本地运行后，按需修改 `miniprogram/utils/config.js` 的 `develop` 地址。
5. 开发者工具里如果连接本地后端，勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。

## 上线前必须改

- `miniprogram/utils/config.js`：
  - `trial` 改成体验版后端 HTTPS 地址。
  - `release` 改成正式版后端 HTTPS 地址。
- 微信公众平台后台配置服务器域名：
  - request 合法域名：你的后端域名。
  - uploadFile 合法域名：同一个后端域名。
  - downloadFile 合法域名：如果头像或文件下载走同域名，也填同一个。
- 后端必须支持 HTTPS，且证书可信。
- 小程序隐私协议里声明头像、健康数据、报告图片、AI 分析用途。

更详细步骤见 [微信小程序上线步骤](../docs/11-小程序开发/02-微信小程序上线步骤.md)。
