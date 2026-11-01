# 视频与共享手机网页部署

桌面与手机使用相同的 Next.js 前端、会话API与工具实现。手机端不需要另外克隆一份项目。生产共享服务应绑定回环地址，由已有可信私人网络桥接转发。不要直接将文件、模型或管理接口暴露公网。

开发依赖按 package-lock.json 安装。使用独立构建目录，清除继承的 __NEXT_PRIVATE_ORIGIN、__NEXT_PRIVATE_STANDALONE_CONFIG：

```sh
PI_WEB_DESKTOP_BUILD=1 PI_WEB_BUILD_DIR=.next-mobile-release node node_modules/next/dist/bin/next build --webpack
```

桌面打包使用 scripts/prepare-desktop.mjs、对应 arm64 Rust构建和 scripts/package-access-macos.py。构建需要当前官方 Node、Rust工具链和项目锁定依赖。发布产物不携带任何个人配置或云端API密钥。Mac安装包的共享后端指针为用户自己的 ~/.pi/agent/shared-backend.json；不配置时使用原有独立配置目录。

可选视频路由文件位于当前Pi配置目录的 pi-web-context/video-models.json。目录权限0700，文件0600，沿用模型提供商安全认证，禁止在文件中复制API密钥。准确结构请以 lib/video-analysis.ts 的 VideoRoute 配置类型及测试为准；上游地址仅允许经过审查的本机统一网关回环地址或MiniMax中国区视频接口，不提供任意代理能力。视频能力不是仅修改模型input标签即可获得，需要真实支持video_url的引擎。

本地Qwen oMLX与云端MiniMax路由是独立的，按当前选中的模型调用；文件工具能力关闭时不提供video_analyze。先使用自己生成的短MP4验证时序、方向、两段内容差异，再测试上传、取消和错误。当前80MiB单次视频分析预算是内存/base64与请求体边界，超过时明确报错；文件上传与下载接口的预算是另一层。不得将失败结果描述为分析成功。

普通新消息与附件通知不得重排历史、注入变化日期或刷新旧system/tool前缀。发布前执行managed prefix、附件、视频、命令健康与模型列表回归。显式改模型、能力、记忆或手动压缩会改变请求前缀，属于用户操作而非缓存故障。

配置示例（不含密钥，ffprobe路径请填写部署机器的真实路径）：

```json
{"version":1,"routes":[{"provider":"mac-local-unified","model":"Qwen3.8-27B-oMLX-8bit","endpoint":"http://127.0.0.1:12349/v1/chat/completions","maxBytes":83886080,"ffprobe":"/absolute/path/to/ffprobe"}]}
```
