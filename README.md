# IELTS 多地区英语口语 TTS 网页

一个本地运行的 IELTS 口语练习网页：输入一句英文后，可以同时生成多种英语音色；也可以切换到口语录音模式，自己放题目并录制答案。网页支持在线播放，并把音频和历史记录保存在本地。

## 功能概览

- 一句话生成多种英语音色，适合对比美式、英式、澳洲等发音差异。
- 支持网页内播放 MP3 音频。
- 支持 Dictation 听写模式：可生成新听写音频，也可直接复用 Audio comparison 历史音频；输入答案后自动评分和标出错词，并可选用 DeepSeek 做更灵活的 AI 复核。
- 支持在历史记录里直接录制自己的朗读，并和生成音频对比播放。
- 支持单独的口语录音页面，可以自己输入 IELTS 题目/文段，并在同一个题目下保存多次回答录音。
- 支持纯口语记录页面，只做自由录音和 ASR 转写，不进入 IELTS 评分和范文分析流程。
- 支持调用豆包 Seed ASR 识别口语录音，再调用 DeepSeek 生成 IELTS 评分、问题诊断和改写范文。
- 口语分析会对齐 12 类 IELTS 母题和 179 个高频核心词及自然变体，提示已使用词、可补充词和范文目标词。
- 口语分析会提取 Part 2 范文关键词和展开路线，方便一分钟准备时做 cue-card 笔记。
- 口语分析结果支持折叠/展开，长范文不会把后续录音卡片挤得太远。
- 支持站点密码保护，避免公开部署后被他人消耗 TTS/ASR/LLM 额度。
- 支持历史记录展示、单条删除、清空历史。
- 音频文件保存在本地 `data/audio/`。
- 跟读录音保存在本地 `data/recordings/`。
- 口语题目和录音分别保存在本地 `data/speaking-history.json`、`data/speaking-recordings/`。
- 纯口语记录保存在本地 `data/voice-notes-history.json`，录音文件复用 `data/speaking-recordings/`。
- 听写记录保存在本地 `data/dictation-history.json`，听写音频复用 `data/audio/`。
- 历史元数据保存在本地 `data/history.json`。
- 支持配置火山引擎 TOS 对象存储；配置后新生成的 TTS、听写音频和录音文件会写入 TOS 桶，旧本地音频仍可回退播放。
- 火山引擎凭证只放在 `.env`，不会暴露给前端页面。

## 案例演示

<table>
<tr>
<td width="100%">

### 多地区音色生成与播放对比
---
https://github.com/Adeshen/ielts_multi_region_voice_lab/raw/refs/heads/main/media/example_multi_region.mp4

</td>
</tr>
</table>

演示内容：输入 IELTS 英文句子，选择多个英语地区音色，生成音频并在网页中播放对比。

> 如果 GitHub 仍然把上方视频显示为普通链接，请在 GitHub 的 Issue、PR 评论或 README 网页编辑器中拖拽上传 `media/example_multi_region.mp4`，然后把 GitHub 生成的 `https://github.com/user-attachments/assets/...` 地址替换上面的 raw 视频 URL。`user-attachments` 地址是 GitHub README 中最稳定的内嵌视频播放器方式。

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

- TTS 多音色对比：`http://127.0.0.1:3000`
- 口语录音模式：`http://127.0.0.1:3000/speaking.html`
- 纯口语记录：`http://127.0.0.1:3000/voice-notes.html`
- Dictation 听写模式：`http://127.0.0.1:3000/dictation.html`
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
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-chat
VOLCENGINE_ASR_SUBMIT_ENDPOINT=https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit
VOLCENGINE_ASR_QUERY_ENDPOINT=https://openspeech.bytedance.com/api/v3/auc/bigmodel/query
VOLCENGINE_ASR_RESOURCE_ID=volc.seedasr.auc
VOLCENGINE_ASR_MODEL_NAME=bigmodel
VOLCENGINE_ASR_AUDIO_BASE_URL=https://your-public-tunnel.example.com
TOS_BUCKET=english-audio-019eead1a8f778e4b0edbcb18a2b1b0f-tosalias
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_ACCESS_KEY_ID=your_tos_access_key_id_here
TOS_ACCESS_KEY_SECRET=your_tos_access_key_secret_here
TOS_PREFIX=ielts-voice-lab
SITE_PASSWORD=choose_a_site_password_here
SITE_SESSION_SECRET=generate_a_long_random_session_secret_here
HOST=127.0.0.1
PORT=3000
```

说明：

- `VOLCENGINE_APP_ID`：火山引擎语音应用 ID。
- `VOLCENGINE_ACCESS_TOKEN`：TTS 和 ASR 接口访问 Token。
- `VOLCENGINE_SECRET_KEY`：预留配置项，当前 V3 TTS 调用未直接使用。
- `VOLCENGINE_API_VERSION=v3`：默认使用火山引擎 V3 TTS 接口。
- `DEEPSEEK_API_KEY`：口语评分和范文改写使用的 DeepSeek API Key。
- `DEEPSEEK_MODEL=deepseek-chat`：默认分析模型，可按需替换。
- `VOLCENGINE_ASR_SUBMIT_ENDPOINT`：火山语音录音文件识别提交接口。
- `VOLCENGINE_ASR_QUERY_ENDPOINT`：火山语音录音文件识别查询接口。
- `VOLCENGINE_ASR_RESOURCE_ID=volc.seedasr.auc`：豆包录音文件识别 2.0 资源 ID。
- `VOLCENGINE_ASR_MODEL_NAME=bigmodel`：录音文件识别模型名。
- `VOLCENGINE_ASR_AUDIO_BASE_URL`：火山 ASR 需要能公网访问录音文件。例如用 ngrok/cloudflared 暴露本地 `http://127.0.0.1:3000` 后，把公网 HTTPS 地址填在这里。
- `TOS_BUCKET`：火山引擎 TOS 桶名，本项目默认示例为 `english-audio-019eead1a8f778e4b0edbcb18a2b1b0f-tosalias`。
- `TOS_REGION`：TOS 所在地域，例如 `cn-beijing`。
- `TOS_ENDPOINT`：TOS endpoint，例如 `tos-cn-beijing.volces.com`。
- `TOS_ACCESS_KEY_ID` / `TOS_ACCESS_KEY_SECRET`：火山账号访问密钥。注意这不是语音 App ID、Access Token 或 Secret Key。
- `TOS_PREFIX`：写入桶内的对象前缀，默认 `ielts-voice-lab`。
- `SITE_PASSWORD`：站点访问密码。配置后，网页、API、音频文件都会要求先登录。
- `SITE_SESSION_SECRET`：登录 cookie 和 ASR 音频签名用的随机密钥，建议使用长随机字符串。
- `HOST=127.0.0.1`：仅监听本机，避免局域网暴露。
- `PORT=3000`：本地网页端口。

## 关键技术点

- **Node.js + Express 后端**
  使用 Express 提供静态网页、TTS API、历史记录 API 和本地音频静态访问。

- **原生前端 HTML/CSS/JavaScript**
  不依赖 React/Vue，页面轻量，直接通过 `fetch` 调用后端接口。

- **火山引擎 V3 TTS 接口**
  后端调用 `https://openspeech.bytedance.com/api/v3/tts/unidirectional`，使用 `X-Api-App-Id`、`X-Api-Access-Key`、`X-Api-Resource-Id` 等请求头。

- **站点密码保护**
  配置 `SITE_PASSWORD` 后，Express 会用 HttpOnly cookie 保护页面、API 和本地音频文件。火山 ASR 需要读取口语录音，因此后端会给提交到火山的单条录音 URL 自动附加签名 token，而不是公开整个录音目录。

- **流式 JSON 音频解析**
  V3 接口返回多段事件数据，后端会解析每段 JSON 事件，把其中的 base64 音频数据解码并拼接为完整 MP3。

- **本地音频持久化**
  未配置 TOS 时，每次生成的音频写入 `data/audio/{recordId}-{voiceId}.mp3`，网页通过 `/audio/...` 播放。

- **火山引擎 TOS 音频存储**
  配置 `TOS_BUCKET`、`TOS_REGION`、`TOS_ENDPOINT`、`TOS_ACCESS_KEY_ID` 和 `TOS_ACCESS_KEY_SECRET` 后，新生成的 TTS 音频、Dictation 音频、跟读录音、Speaking 录音和 Voice notes 录音会写入 TOS。前端仍使用 `/audio/...`、`/recordings/...`、`/speaking-recordings/...` 访问，由 Express 做鉴权并从 TOS 流式转发，因此不需要把桶设为公开读。删除历史记录时会同步删除对应 TOS 对象，并兼容清理旧的本地文件。

- **Dictation 听写训练**
  新增 `/dictation.html`。用户输入句子后选择音色和语速生成听写音频，页面默认隐藏原文；也可以在 Audio comparison 历史音频旁点击 Dictation，直接复用已经生成的 MP3，不再次调用火山 TTS。提交听写答案后，后端做词级 diff，返回正确词、漏听词、多写词、拼写相近词、wrong word、function words 漏听和 179 高频核心词命中情况。

- **DeepSeek 听写复核**
  Dictation 的基础评分使用本地程序，速度快且不消耗 LLM。每次听写尝试也可以点击 AI review，由 DeepSeek 复核原句和学习者答案，更灵活地区分可接受拼写/词形变化、真正影响理解的错误、可能的弱读/连读/尾音问题，并给出下一步训练建议。

- **浏览器麦克风录音**
  前端支持录制学习者朗读，TTS 跟读录音保存到 `data/recordings/`，口语模式录音保存到 `data/speaking-recordings/`，网页可直接播放，便于和 TTS 音频对比。

- **口语录音模式**
  新增 `/speaking.html`，可手动输入题目或文段，保存为练习卡片，再在同一个题目下反复录制多个 answer attempts。录音默认限制为 2 分钟，适合 IELTS Part 2，也可以切换为 30 秒、1 分钟或 3 分钟；所有录音都会限制在 3 分钟以内。每条录音都可以单独播放、转写、分析和删除。该模式不调用火山 TTS。

- **纯口语记录模式**
  新增 `/voice-notes.html`，用于自由录音和转写。它不需要先创建 IELTS 题目，也不会调用 DeepSeek 做评分；适合日常 shadowing、复述、自由表达或临时口语日记。录音可设置 30 秒、1 分钟、2 分钟或 3 分钟上限，保存后可自动或手动调用豆包 Seed ASR 转写。

- **DeepSeek 口语分析**
  对录音填写回答文字稿后，后端调用 DeepSeek 生成 IELTS 维度评分、改进建议、句子修正和更自然的 Band 7.5-8.0 范文。分析还会输出 Part 2 cue-card 关键词和 speaking route，帮助学习者从关键词复述，而不是死背整篇范文。如果该录音先经过火山 ASR 转写，ASR 分段时间戳和停顿/语速摘要也会一起传给 DeepSeek，用于辅助判断 fluency、pacing 和 organization。当前分析不做真正 phonetic pronunciation 评分。

- **IELTS 母题与核心词对齐**
  `src/ieltsVocabulary.js` 内置 12 类口语母题，以及 179 个高频雅思核心词材料中整理出的自然词形/短语变体。分析 prompt 会要求模型判断最接近的母题，识别学习者已经自然使用的核心词，推荐 5-10 个适合该回答的词组，并在范文中自然使用部分目标词，避免为了覆盖词汇而硬塞表达。

- **可折叠分析面板**
  Speaking 页面中每条录音的分析结果默认以摘要形式展示，点击 Expand 才显示句子修正、范文和练习建议，避免历史记录过长时难以切换和定位其他练习卡片。

- **火山语音 ASR 转写**
  口语录音页面可点击 Transcribe，后端把录音文件的公网 URL 提交到火山语音录音文件识别接口，再轮询查询文字稿并自动填入分析输入框。ASR 复用 `VOLCENGINE_APP_ID` 和 `VOLCENGINE_ACCESS_TOKEN`，不需要把火山凭证暴露到前端。根据官方录音文件识别文档，音频字段使用 `url`，因此纯 `127.0.0.1` 本地地址不能被火山服务器访问。转写成功后会保存 ASR utterance segments、起止时间、最长停顿、估算语速等 timing evidence。转写速度受公网隧道、WAV 文件大小和火山任务排队影响；默认最多轮询约 60 秒，单次火山请求默认 20 秒网络超时。

- **浏览器端 WAV 录音**
  口语模式使用 Web Audio API 在浏览器端编码 WAV，避免默认 WebM 录音格式不被火山 ASR 支持。

- **本地历史记录**
  TTS 记录写入 `data/history.json`，口语录音题目写入 `data/speaking-history.json`，听写训练写入 `data/dictation-history.json`，分别记录文本、生成时间、音频路径、听写尝试和失败信息。

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
- 豆包 Seed ASR 模型页：<https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seed-asr-2-0>
- 豆包录音文件识别文档：<https://www.volcengine.com/docs/6561/1354868?lang=zh>

## 项目结构

```text
.
├── public/
│   ├── index.html      # TTS 多音色对比页面
│   ├── speaking.html   # 口语录音模式页面
│   ├── voice-notes.html # 纯口语记录页面
│   ├── dictation.html  # Dictation 听写训练页面
│   ├── styles.css      # 页面样式
│   ├── app.js          # TTS 页面交互逻辑
│   ├── speaking.js     # 口语录音页面交互逻辑
│   ├── voice-notes.js  # 纯口语记录页面交互逻辑
│   └── dictation.js    # 听写训练页面交互逻辑
├── src/
│   ├── dictation.js    # 听写词级 diff 和错词统计
│   ├── audioStore.js   # 本地/TOS 音频对象存储
│   ├── storage.js      # 本地音频和历史记录读写
│   ├── volcengineAsr.js # 火山语音 ASR 录音文件识别
│   ├── deepseek.js     # DeepSeek 口语评分和范文改写
│   ├── ieltsVocabulary.js # IELTS 母题、179 高频核心词及自然变体
│   ├── voices.js       # 本地音色 ID 到火山 speaker/resource 的映射
│   └── volcengine.js   # 火山引擎 TTS 调用与音频解析
├── data/
│   ├── audio/          # 本地生成的 MP3 音频
│   ├── recordings/     # 学习者跟读录音
│   ├── speaking-recordings/ # 口语模式录音
│   ├── history.json    # TTS 历史记录
│   ├── speaking-history.json # 口语题目记录
│   ├── voice-notes-history.json # 纯口语记录
│   └── dictation-history.json # 听写训练记录
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

### `GET /api/storage`

返回当前音频对象存储模式。

返回示例：

```json
{
  "mode": "tos"
}
```

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

删除单条历史记录，并删除对应 MP3 文件和跟读录音。

### `POST /api/history/:id/recordings`

给某条历史记录追加一条学习者录音。

请求示例：

```json
{
  "dataUrl": "data:audio/wav;base64,..."
}
```

### `DELETE /api/history/:id/recordings/:recordingId`

删除某条历史记录下的一条学习者录音。

### `DELETE /api/history`

清空全部历史记录，并删除全部历史音频文件和跟读录音。

### `GET /api/dictation`

返回听写训练记录，包含原句、音频、音色、语速和最近听写尝试。

### `POST /api/dictation`

生成一条听写训练音频。

请求示例：

```json
{
  "sourceText": "The coastal environment is home to many rare species.",
  "voiceId": "uk_female",
  "speedRatio": 0.9,
  "volumeRatio": 1
}
```

### `POST /api/dictation/:id/check`

提交听写答案并返回词级 diff、准确率和错词统计。

请求示例：

```json
{
  "userText": "The costal environment is home to many rare spaces."
}
```

### `POST /api/dictation/:id/attempts/:attemptId/review`

对某次听写尝试调用 DeepSeek 做 AI 复核。基础 `check` 不会自动调用 DeepSeek，只有点击 AI review 时才会消耗 LLM 额度。

### `POST /api/dictation/from-history`

把 TTS 历史记录里的某条已生成音频复用为听写训练，不重新调用 TTS，也不会在删除听写记录时删除原始 TTS 音频。

请求示例：

```json
{
  "historyId": "tts-history-record-id",
  "voiceId": "uk_female"
}
```

### `DELETE /api/dictation/:id`

删除一条听写记录，并删除对应 MP3 文件。

### `DELETE /api/dictation`

清空全部听写记录，并删除对应 MP3 文件。

### `GET /api/speaking`

返回口语录音模式下保存的题目和录音。

### `POST /api/speaking`

保存一个新的口语题目或文段。

请求示例：

```json
{
  "prompt": "Describe a time when you learned something useful from another person."
}
```

### `POST /api/speaking/:id/recordings`

给某个口语题目追加一条录音。

### `POST /api/speaking/:id/recordings/:recordingId/transcribe`

使用豆包 Seed ASR 对本地录音文件做语音识别，并把返回文字稿保存到该录音。

### `POST /api/speaking/:id/recordings/:recordingId/analyze`

基于题目和回答文字稿生成 IELTS 口语评分、改进建议和改写范文。

请求示例：

```json
{
  "transcript": "I want to talk about a useful skill I learned from my friend..."
}
```

说明：可以先调用 `transcribe` 自动生成文字稿，再调用 `analyze` 做评分和范文改写。

### `DELETE /api/speaking/:id/recordings/:recordingId`

删除某个口语题目下的一条录音。

### `DELETE /api/speaking/:id`

删除一个口语题目，并删除它下面的全部录音。

### `DELETE /api/speaking`

清空全部口语题目和口语模式录音。

### `GET /api/voice-notes`

返回纯口语记录，按最新创建时间倒序排列。

### `POST /api/voice-notes`

保存一条纯口语录音。该接口只保存录音和标题，不做转写。

请求示例：

```json
{
  "title": "Morning speaking note",
  "dataUrl": "data:audio/wav;base64,..."
}
```

### `POST /api/voice-notes/:id/transcribe`

使用豆包 Seed ASR 对纯口语录音做转写，并把文字稿和 ASR timing evidence 保存到该记录。

### `DELETE /api/voice-notes/:id`

删除一条纯口语记录，并删除对应录音文件。

### `DELETE /api/voice-notes`

清空全部纯口语记录，并删除对应录音文件。

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

未配置 TOS 时，音频文件在：

```text
data/audio/
```

配置 TOS 后，新音频对象写入桶：

```text
english-audio-019eead1a8f778e4b0edbcb18a2b1b0f-tosalias/ielts-voice-lab/
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
node --check src/volcengineAsr.js
node --check src/deepseek.js
node --check src/dictation.js
node --check src/storage.js
node --check src/audioStore.js
node --check public/app.js
node --check public/speaking.js
node --check public/voice-notes.js
node --check public/dictation.js
```

也可以启动服务后，在网页输入一句 IELTS 句子并生成音频，确认：

- 页面显示生成成功。
- `data/audio/` 下出现 MP3 文件。
- 点击历史记录里的 Record，可以录制并保存自己的朗读。
- `data/recordings/` 下出现录音文件。
- `data/history.json` 写入记录。
- 历史记录刷新页面后仍然存在。
- 打开 `/speaking.html`，保存一条题目后可以录制、播放、删除自己的回答。
- `data/speaking-history.json` 和 `data/speaking-recordings/` 正常写入。
- 在录音下方点击 Transcribe 自动生成回答文字稿，再点击 Analyze 得到评分和改写范文。
- 分析结果默认折叠，点击 Expand/Collapse 可以展开或收起长范文。
- 打开 `/voice-notes.html`，直接录音并转写，确认 `data/voice-notes-history.json` 正常写入。
- 配置 `SITE_PASSWORD` 后，未登录访问页面会跳转登录页，未登录 API 返回 401；登录后可以正常使用 TTS、ASR 和历史记录。
