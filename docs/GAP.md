# OpenHyperKnow — Target Alignment Tracker

目标：复刻 Hyperknow 全部功能。每完成一项验证一项，未对齐的持续补。

## 功能对齐表

| # | 功能 | Hyperknow 表现 | 状态 | 验证 |
|---|------|---------------|------|------|
| 1 | 白板 canvas | Excalidraw view-mode, pan/zoom/grid | ✅ v2 | ✅ 拖拽平移/缩放/网格 |
| 2 | 白板手写卡片 | Virgil/Xiaolai + wobble 边框 + 荧光笔标题 | ✅ v2 | ✅ 化学方程式卡+水循环卡 |
| 3 | 白板工具栏 | ✕/标题药丸/缩放%/页导航/语音药丸 | ✅ v2 | ✅ |
| 4 | 白板分栏 | 列标题(紫色 Excalidraw 文本+黄色高亮条) | ✅ v2 | ✅ Photosynthesis Equation 列 |
| 5 | 白板对话面板 | 右侧 Conversation + Ask input | ✅ v2 | ✅ |
| 6 | 白板提问中断 | ask → 学生答 → agent 确认继续 | ✅ v1 | ✅ (WiFi课验证) |
| 7 | 课程生成 research | 并行搜索显示来源 | ✅ v1 | ✅ |
| 8 | 课程生成问卷 | 4 题 multi/single | ✅ v1 | ✅ |
| 9 | **蓝图确认** | Course Blueprint 卡 + sessions + 编辑/确认 | ✅ | ✅ 14 sessions 卡确认流程 |
| 10 | 课程保存 | 持久化 + 重启存活 | ✅ | ✅ data/courses.json, 重启验证 |
| 11 | 课程页 | 封面+tags+进度条+unit 列表 / 图例+lecture 卡 | ✅ | ✅ 3 栏布局 |
| 12 | Learn/Practice 分离 | Learn(蓝)→白板, Practice→练习 | ✅ | ✅ Learn 跳白板实测 |
| 13 | 进度系统 | lesson 勾选 + 进度% + 持久化 | ✅ | ✅ 13% 重启后保留 |
| 14 | Practice 练习 | 揭卡 Q/A | ✅ | ✅ (内嵌 lecture 卡) |
| 15 | Exam 测验 | MCQ 计分 | ✅ v1 | ✅ (内嵌) |
| 16 | Courses 列表页 | 课程网格 + 删除 | ✅ | ✅ |
| 17 | History | 会话历史列表 | ❌ 未做 | — |
| 18 | Marketplace | 公开课程市场 | ❌ 未做 | — |
| 19 | 生成流程速度 | 蓝图先行(用户确认后再生成细节) | ✅ | ✅ 比 Hyperknow(15min) 快 |

## 剩余待做（低优先级）
- [ ] History 页（本地会话历史列表）
- [ ] Marketplace（公开课分享 — 需要多用户系统，先做导出/导入 .json 代替）
- [ ] 蓝图拒绝→带反馈重生成（已实现，未单独验证）
- [ ] Practice 独立页（当前内嵌在课程页，功能等价）
