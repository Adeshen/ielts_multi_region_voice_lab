# IELTS 多地区英语口语 TTS 网页

一个本地运行的 IELTS 口语练习网页：输入一句英文后，可以同时生成多种英语音色，网页支持在线播放，并把生成过的音频和历史记录保存在本地。

## 功能概览

- 一句话生成多种英语音色，适合对比美式、英式、澳洲等发音差异。
- 支持网页内播放 MP3 音频。
- 支持历史记录展示、单条删除、清空历史。
- 音频文件保存在本地 `data/audio/`。
- 历史元数据保存在本地 `data/history.json`。
- 火山引擎凭证只放在 `.env`，不会暴露给前端页面。

## 案例演示

项目包含一个演示视频，用于说明这个网页的实际使用流程：

- 演示文件：[`media/example_multi_region.mp4`](media/example_multi_region.mp4)
- 演示内容：输入 IELTS 英文句子，选择多个英语地区音色，生成音频并在网页中播放对比。

> GitHub README 对仓库内的 `.mp4` 文件通常只渲染为链接，不会像图片一样自动内嵌播放器；浏览器也会限制带声音视频自动播放。若需要在 GitHub 页面直接显示视频播放器，可以在 GitHub 的 Issue、PR 评论或 README 网页编辑器中拖拽上传该 MP4，然后把 GitHub 生成的 `https://github.com/user-attachments/assets/...` 视频 URL 单独放在 README 一行。

## 快速启动

```bash
npm install
cp .env.example .env
npm start
```

启动后打开：

```text
http://127.0.0.1:3000
```

本项目网页入口：

- 本地网页：`http://127.0.0.1:3000`
- 本地音频访问示例：`http://127.0.0.1:3000/audio/{filename}.mp3`

开发模式可使用：

```bash
npm run dev
```

## 环境变量

在 `.env` 中配置火山引擎访问凭证：

```bash
VOLCENGINE_APP_ID=your_app_id_here
VOLCENGINE_ACCESS_TOKEN=your_access_token_here
VOLCENGINE_SECRET_KEY=your_secret_key_here
VOLCENGINE_API_VERSION=v3
HOST=127.0.0.1
PORT=3000
```

说明：

- `VOLCENGINE_APP_ID`：火山引擎语音应用 ID。
- `VOLCENGINE_ACCESS_TOKEN`：TTS 接口访问 Token。
- `VOLCENGINE_SECRET_KEY`：预留配置项，当前 V3 TTS 调用未直接使用。
- `VOLCENGINE_API_VERSION=v3`：默认使用火山引擎 V3 TTS 接口。
- `HOST=127.0.0.1`：仅监听本机，避免局域网暴露。
- `PORT=3000`：本地网页端口。

## 关键技术点

- **Node.js + Express 后端**  
  使用 Express 提供静态网页、TTS API、历史记录 API 和本地音频静态访问。

- **原生前端 HTML/CSS/JavaScript**  
  不依赖 React/Vue，页面轻量，直接通过 `fetch` 调用后端接口。

- **火山引擎 V3 TTS 接口**  
  后端调用 `https://openspeech.bytedance.com/api/v3/tts/unidirectional`，使用 `X-Api-App-Id`、`X-Api-Access-Key`、`X-Api-Resource-Id` 等请求头。

- **流式 JSON 音频解析**  
  V3 接口返回多段事件数据，后端会解析每段 JSON 事件，把其中的 base64 音频数据解码并拼接为完整 MP3。

- **本地音频持久化**  
  每次生成的音频写入 `data/audio/{recordId}-{voiceId}.mp3`，网页通过 `/audio/...` 播放。

- **本地历史记录**  
  每次生成都会写入 `data/history.json`，记录文本、生成时间、音色、音频路径和失败信息。

- **部分失败容错**  
  多个音色逐个生成。如果某个音色失败，其他成功音色仍会保存并返回，页面会显示失败原因。

- **凭证隔离**  
  `.env` 被 `.gitignore` 忽略，前端页面只看到本地 voice ID，不会看到火山引擎 Token、speaker 或 resource 配置。

## 参考文档

- 火山引擎语音控制台：<https://console.volcengine.com/speech/app>
- 火山引擎音色列表：<https://www.volcengine.com/docs/6561/97465?lang=zh>
- 火山引擎 TTS 接入文档：<https://www.volcengine.com/docs/6561/1719100?lang=zh>
- 火山引擎鉴权/接口相关文档：<https://www.volcengine.com/docs/6561/1359370?lang=zh>
- 火山引擎 V3 TTS 文档：<https://www.volcengine.com/docs/6561/1598757>

## 项目结构

```text
.
├── public/
│   ├── index.html      # 前端页面
│   ├── styles.css      # 页面样式
│   └── app.js          # 前端交互逻辑
├── src/
│   ├── storage.js      # 本地音频和历史记录读写
│   ├── voices.js       # 本地音色 ID 到火山 speaker/resource 的映射
│   └── volcengine.js   # 火山引擎 TTS 调用与音频解析
├── data/
│   ├── audio/          # 本地生成的 MP3 音频
│   └── history.json    # 历史记录
├── media/
│   └── example_multi_region.mp4  # 案例演示视频
├── server.js           # Express 服务入口
├── package.json
├── .env.example
└── README.md
```

## API 说明

### `GET /api/history`

返回历史记录，按最新生成时间倒序排列。

### `POST /api/tts`

生成语音。

请求示例：

```json
{
  "text": "Some people believe that public transport should be free in large cities.",
  "voices": ["us_female", "uk_female", "au_male"],
  "speedRatio": 1,
  "volumeRatio": 1
}
```

返回示例：

```json
{
  "id": "record-id",
  "text": "Some people believe that public transport should be free in large cities.",
  "createdAt": "2026-05-29T12:02:43.223Z",
  "items": [
    {
      "voiceId": "us_female",
      "label": "American English - Female",
      "audioUrl": "/audio/record-id-us_female.mp3"
    }
  ],
  "errors": []
}
```

### `DELETE /api/history/:id`

删除单条历史记录，并删除对应 MP3 文件。

### `DELETE /api/history`

清空全部历史记录，并删除全部历史音频文件。

## 当前音色预设

前端使用稳定的本地 ID，后端在 `src/voices.js` 中映射到火山引擎 speaker/resource。

- `us_female`：美式英语女声
- `us_male`：美式英语男声
- `uk_female`：英式英语女声
- `uk_male`：英式英语男声
- `au_male`：澳洲英语男声
- `en_expressive_female`：通用英语情感女声

默认勾选：

- `us_female`
- `uk_female`
- `au_male`

## 常见问题

### 为什么不用旧版 `BV*` 音色？

火山引擎旧版 V1/BV 音色可能需要额外资源授权。当前账号调用旧接口时返回过：

```text
requested resource not granted
```

所以项目默认使用已经跑通的 V3 大模型 TTS 接口。

### 生成的音频在哪里？

音频文件在：

```text
data/audio/
```

历史记录在：

```text
data/history.json
```

### 如何增加新音色？

编辑 `src/voices.js`，新增一个本地 voice ID，并配置：

- `label`
- `shortLabel`
- `region`
- `gender`
- `speaker`
- `resourceId`

然后在 `public/index.html` 的音色选择区新增对应 checkbox。

## 验证方式

```bash
node --check server.js
node --check src/volcengine.js
node --check src/voices.js
node --check src/storage.js
node --check public/app.js
```

也可以启动服务后，在网页输入一句 IELTS 句子并生成音频，确认：

- 页面显示生成成功。
- `data/audio/` 下出现 MP3 文件。
- `data/history.json` 写入记录。
- 历史记录刷新页面后仍然存在。
