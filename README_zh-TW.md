# Woow HA OpenDesign 附加元件

將 OpenDesign **0.21.1** 封裝成獨立的 Home Assistant 附加元件，支援 `amd64` 與 `aarch64`。

- 僅透過 Home Assistant Ingress／側邊欄存取，不發布區域網路連接埠。
- OpenDesign 只監聽 `127.0.0.1`，由非特權 nginx 提供 Supervisor Ingress 入口。
- 供應商金鑰沿用 OpenDesign 的瀏覽器 `localStorage`。金鑰依瀏覽器保存，不是 HA 選項、不寫入 `/data`，也不會進入 HA 備份。
- OpenDesign 狀態保存於 `/data/opendesign`，由冷備份涵蓋。
- 系統 Chromium、Playwright 與 Noto CJK／emoji 字型提供無頭匯出。
- 支援獨立 HTML、ZIP、截圖式 PDF、PNG/JPEG，以及每張投影片為圖片的 PPTX。**不支援可編輯 PPTX**，要求此模式時會明確失敗。
- 保留上游 Local CLI 設定頁，但映像不安裝、不掛載任何本機 AI 執行環境，因此所有這類執行環境均不可用。

[English](README.md) · [附加元件說明](DOCS.md)

## 安裝

1. 在 Home Assistant 開啟 **設定 → 附加元件 → 附加元件商店 → 儲存庫**。
2. 加入 `https://github.com/WOOWTECH/Woow_ha_opendesign_add_on`。
3. 安裝並啟動 **Woow HA OpenDesign**，再從側邊欄開啟。
4. 在 OpenDesign 介面設定供應商；金鑰只留在目前瀏覽器。

本附加元件沒有設定選項，也沒有主機目錄掛載。

## 架構

```text
瀏覽器 → HA 驗證 Ingress → nginx :8099 → OpenDesign 127.0.0.1:7456
                                               ↘ /data/opendesign
                                               ↘ 系統 Chromium renderer
```

nginx 先驗證 `X-Ingress-Path`，改寫初始回應中的根路徑 URL，並在應用程式碼之前注入 shim，以處理 fetch、XHR、EventSource、WebSocket、history、worker、動態資源 URL 與 web 模式的匯出缺口。HA Ingress 的 PDF 操作會改走可下載的截圖 PDF 二進位端點，PNG/JPEG 儲存則直接呼叫 daemon 的無頭 image 端點。SSE／WebSocket 不緩衝，且對上游停用壓縮以便安全改寫。

PID 1 啟動器同時管理 nginx 與 OpenDesign；任一程序退出時會停止另一個並讓 Supervisor 重新啟動。關閉時先送 TERM、最多等待五秒，再送 KILL 並回收程序。兩者都以 OpenDesign 的 UID/GID 1001 執行，nginx PID 與暫存目錄位於 `/tmp`。

## 驗證

```sh
./tests/run.sh
```

本機測試不需要 Docker；會檢查 YAML、禁止的主機／本機執行環境耦合、JavaScript 與 shell 語法、renderer／網路安全純函式、匯出 bridge 及 Ingress fixture。CI 會先實際建置 amd64 映像，驗證健康檢查、重啟持久性、UID／路徑／CLI 缺席、Chromium PNG/JPEG、可編輯 PPTX 拒絕，以及 HTTP 截圖 PDF/PPTX 組裝，通過後才執行發布矩陣。

## 安全性

模型產生的 HTML 在套用請求政策的 renderer Chromium 中執行。允許 `data:`、`blob:`、`about:`、精確的 OpenDesign loopback origin，以及通過 DNS／IP 驗證的公共 HTTP(S)；Supervisor、link-local、RFC1918、CGNAT、其他 loopback 連接埠及 IPv6 私有／link-local 位址都會被拒絕。CJK／emoji 使用映像內建字型，不依賴遠端字型 CDN。

## 授權

執行映像衍生自 `ghcr.io/nexu-io/od:0.21.1`，OpenDesign 本身適用其上游授權與聲明。本儲存庫的附加元件封裝及整合程式採 MIT 授權，詳見 [LICENSE](LICENSE)。
