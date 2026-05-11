# HealthResetPlan-Wechat

> 健康重启计划微信小程序，功能与 Flutter 客户端基本一致。

## 目录

```
HealthResetPlan-Wechat/
 ├── project.config.json
 ├── project.private.config.json   # 个人 appid 占位（请勿提交真实值）
 └── miniprogram/
      ├── app.js / app.json / app.wxss / sitemap.json
      ├── pages/
      │    ├── home/        # 首页
      │    ├── profile/     # 健康档案
      │    ├── report/      # 检查报告 OCR
      │    ├── plan/        # AI 个性化计划
      │    ├── clock/       # 打卡
      │    ├── stats/       # 数据趋势
      │    └── settings/    # 我的（含云同步说明）
      ├── components/
      ├── services/
      └── utils/
           └── request.js   # API 封装
```

## 关键约束

- 主密钥（UMK）不在小程序内生成 / 持久化，全部走客户端 / Web 端备份。
- 上传到云端的健康敏感数据必须经过 AES-256-GCM 加密。
- 蓝牙能力（体脂秤 / 血压计 / 手环）使用 `wx.openBluetoothAdapter` 系列 API。

## 本地开发

1. 使用 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 打开本目录。
2. 替换 `project.config.json` 中的 `appid` 为您自己的小程序 AppID。
3. 启动调试。

## 文档

[`/docs/11-小程序开发`](../docs/11-小程序开发)。
