# aoqi-update

Air 奥奇传说的版本更新清单镜像（jsDelivr / Cloudflare Pages 节点）。

- `update/v1/<产品>/<平台>/<渠道>.json`：客户端读取的清单信封，由离线私钥签名（ES256），客户端验签后才会使用。
- `update/history/`：每次发布的存档。

内容由主仓库的 `tools/release-update.py` 自动发布，请勿手工修改。
