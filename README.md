# aoqi-update

Air 奥奇传说的版本更新清单镜像（jsDelivr / Cloudflare Pages 节点）。

- `update/v1/<产品>/<平台>/<渠道>.json`：客户端读取的清单信封，由离线私钥签名（ES256），客户端验签后才会使用。
- `update/history/`：每次发布的存档。

内容由主仓库的 `tools/release-update.py` 自动发布，请勿手工修改。

## 静态更新节点

Cloudflare Worker：`aoqi-update-mirrors`，正式域名 `https://update-cf.howe.wang/update/v1/`。

`npm ci && npm run build` 对当前稳定清单验签，检查产品、平台和渠道，再将原始签名信封原样复制到 `public/update/v1/`。只部署正式稳定清单，不部署测试渠道、历史存档、工具和凭据。公钥在 `config/manifest-keys.json`，轮换时与发布仓库同步。

`npm run deploy:cloudflare` 使用已登录的 Cloudflare CLI 构建并部署。`cloudflare.config.ts` 是部署配置；`wrangler.config.ts` 由 `cf init` 为静态资源构建生成，只供 `cf` 调用的构建工具读取。发布仓库的 `static-host` 上传器在 Git 节点完成后检查本次清单逐字节一致，再自动运行部署命令，因此下次正常发布会同步更新此节点。

Vercel 正式节点：`https://aoqi-update-mirror.vercel.app/update/v1/`，项目为 `howe3/aoqi-update-mirror`。使用 `vercel.json` 的静态构建、短缓存和真实 404 配置。`npm run deploy:vercel` 明确指定团队和项目部署正式节点；本地 `.vercel/project.json` 保存链接，不提交凭据。未验签的内容或不存在的渠道不会回退到首页。用户已确认此公开镜像属于个人非商业用途并使用当前 Hobby 套餐；未开通付费套餐。

Vercel GitHub 自动连接尚未授权（CLI 返回需要 GitHub Login Connection），因此发布自动化采用发布仓库的 `static-host` 上传器，通过已登录的官方 CLI 更新，不依赖 GitHub 连接。需要在另一台机器发布时，先 `npm ci` 并完成两个 CLI 的账号登录；不要复制或提交认证令牌。

使用全局 CLI：`cf auth login`、`vercel login`；交互授权由账户持有人完成。CLI 的认证文件、`.cloudflare/`、`.vercel/` 和生成的 `public/` 均不入库。服务器只接收公开清单，不接收离线签名私钥。
