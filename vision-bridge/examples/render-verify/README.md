# render-verify 闭合示例（04 票冻结范围）

「参考图 → HTML 实现 → 截图 → 像素比对」的可复现验证闭环，**不需要任何视觉 key**。

## 文件

- `reference.png` — 参考图（400x300：浅灰底 + 蓝色卡片 + 黄色内块），由 `scripts/render-verify.mjs` 用 PIL 确定性生成。
- `v1.html` — 故意不准的初版（卡片颜色/位置/尺寸全错）。
- `v2.html` — 按 `vision_pixel_diff` 最差区域迭代后的终版（颜色/位置/尺寸与参考一致）。
- `RESULTS.md` — 每次运行后由脚本写出的数值验收结果。

## 运行

```bash
cd vision-bridge
node scripts/render-verify.mjs
```

脚本用 managed=false 的运行时：`vision_html_screenshot` 渲染两份 HTML（视口 400x300），
`vision_pixel_diff` 分别与 `reference.png` 比较，断言**初版差异 > 终版差异**并写出数值证据。
