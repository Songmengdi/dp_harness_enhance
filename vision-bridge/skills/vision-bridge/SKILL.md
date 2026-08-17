---
name: vision-bridge
description: 视觉桥（vision-bridge）——纯文本模型指挥视觉工具看图的完整方法：vision_glance / vision_ground / vision_detect 提语义问题，vision_crop / vision_pixel_diff / vision_dominant_colors 做像素级事实核对。Use when 需要看图、定位图中元素、裁剪、比较两张图、测量颜色、或收到「读不了图片」的提示时。
---

# 视觉桥（vision-bridge）使用协议

你是纯文本模型，看不到图片。本会话的视觉能力由 vision-bridge 提供：
语义问题交给远程视觉模型，像素级事实交给本地确定性工具。

## 可用工具

- `vision_glance`（远程）：看图回答。无 question = 全景描述；带 question = 围绕问题回答；ocr=true 逐字转写文字；多图一次传入逐张独立描述。
- `vision_ground`（远程）：按目标名定位，返回原图像素框。
- `vision_detect`（远程）：盘点某类元素，返回带编号清单 + 逐字可见文字 + 像素框。
- `vision_crop`（本地）：按像素框裁剪成文件（产物在工作区 artifacts 目录）。
- `vision_pixel_diff`（本地）：两图逐像素差异（比例/最差区域/热力图/报告）。
- `vision_dominant_colors`（本地）：区域主色分布 + 候选色打分。
- `vision_media` / `vision_frames`（本地）：媒体元数据 / 视频抽帧。

## 明眼人协议（指挥视觉模型的方法）

1. 第一轮不要提问，先要全景描述（物体/颜色/形状/位置/文字逐字/布局）；你的预设可能是错的，先拿描述再核对假设。
2. 提问要具体可观测：数量、颜色名、九宫格方位+比例坐标、文字逐字转写；拒绝模糊的主观判断。
3. 每次提问都要求：直接回答 + 实际所见 + 视觉证据 + 信心(0-10) + 补充；绝不接受只答「是/否/没有」。
4. 对关键声明追问到证据层（在哪里看到、什么特征支撑）；对方说「不确定」就要求明说，禁止编造。
5. 多图时要求逐张独立描述，对比结论由你自己推理。
6. 远程回答不是像素级证据：坐标用 vision_crop 复核，颜色用 vision_dominant_colors 复核，差异用 vision_pixel_diff 复核。

## 组合套路

- 定位 → 裁剪：`vision_ground` 拿框 → `vision_crop` 按框裁出文件 → 把裁剪产物喂给下一步。
- 重建 → 验证：参考图 vs 你的实现截图 → `vision_pixel_diff` 给数值证据，按最差区域迭代。
- 长截图：先 `vision_crop` 分段再逐段 `vision_glance`（ocr=true）。

<!-- VISION_BRIDGE_ROUTE_C_SKILL_MARKER -->
