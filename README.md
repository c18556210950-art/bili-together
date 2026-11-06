# B站一起看

Greasy Fork 安装入口：https://greasyfork.org/zh-CN/scripts/604091

服务器使用说明：https://wilder.asia/bili-together/

源码仓库：https://github.com/c18556210950-art/bili-together 。MIT 许可，欢迎提交问题和改进。

## 1.1.0 更新

- 适配“稍后再看”播放页及旧入口；与普通播放页按相同视频和分 P 同步。切换视频后保留邀请码，重新加入当前视频对应的房间；不会替其他人自动切换视频或共享私人列表。
- 从稍后再看复制邀请时生成当前视频的普通播放页链接，朋友不需要有相同的稍后再看列表。
- 面板闲置 5 秒自动隐藏为“一起看”按钮，悬停或点击展开；可取消“闲置 5 秒自动隐藏”并记住选择。输入邀请码、键盘操作和等待允许播放时不自动隐藏。

已在登录后的 B 站稍后再看页面核查视频标识及实际列表切换，配合自动测试验证邀请链接、切换隔离和面板隐藏。尚未在多个真实 B 站播放器中进行完整同步验收。

每位参与者安装 Tampermonkey 和本脚本。打开视频 → 新建房间 → 复制邀请 → 将邀请链接发给其他参与者。邀请链接会自动加入；普通打开视频时，面板可以输入相同邀请码加入。支持 2–30 人，所有成员都能控制，最后操作的人负责持续校准进度，离开后自动接续。暂停、播放、拖动和倍速通过 WSS 同步，偏差超过 0.8 秒时纠正。

房间按邀请码和视频 BV/av 编号及分 P 隔离；番剧按 ep 单集编号隔离（暂不支持 ss 页面识别）。成员需打开同一种编号链接；分享面板生成的完整链接最稳妥。不代传视频、不绕过会员、地区或登录限制。现代桌面浏览器为主要目标；手机需自行具备可运行油猴脚本的浏览器。请允许油猴在 B 站执行脚本。浏览器禁止自动播放时，点击面板中的允许播放按钮。

邀请码是房间凭证，不公开发布。服务只在内存中保存房间、播放进度、倍速和连接，空房立即删除，服务重启也会清空；不持久化聊天或账号信息。人数上限 30，房间上限 500，心跳清理失联连接，消息限长和限速。缓冲、设备休眠及后台标签页限速可能造成短暂误差，恢复后会校正；这不是逐帧同步。

## 本地运行

Node.js 22+，执行 `npm ci`、`npm test`、`npm start`。默认仅监听 127.0.0.1:18770。生产用 Nginx 终止 TLS 和代理 WebSocket。脚本固定使用 wilder.asia，迁移需修改 endpoint、安装与更新地址。

## 生产运维

- 服务：`bili-together.service`，开机启动，异常自动重启，独立低权限账号 bilitogether。
- 目录：`/opt/bili-together/current`；版本：`/opt/bili-together/releases/`。
- Nginx 路由：`/etc/nginx/bili-together.locations`，由现有 HTTPS server 引入。
- 健康检查：`https://wilder.asia/bili-together/health`。
- 日志：`journalctl -u bili-together`。
- 更新：上传源码和 package-lock.json，在服务器版本目录运行 `npm ci --omit=dev --ignore-scripts`，切换 current 链接后重启服务。部署前先运行测试。本机专用部署脚本及部署记录不包含在公开仓库。
- 回退：将 current 链接切回上一版本后重启 bili-together。完全移除时先移除 reverse-proxy.conf 中 bili-together include，通过 nginx -t 后 reload，再停止服务。

已验证本地多人协议测试与脚本模拟视频事件测试；线上另做 HTTPS 和三连接同步验证。未在真人 B 站账号的多个浏览器中进行端到端验收，网站播放器变化可能需要调整。测试文件不需要上传至公开入口。

实现参考：[Tampermonkey 官方文档](https://www.tampermonkey.net/documentation.php?locale=en)、[ws 官方文档](https://github.com/websockets/ws)。
