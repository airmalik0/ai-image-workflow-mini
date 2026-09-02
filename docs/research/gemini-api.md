# Gemini Image Generation API — спайк, проверено вживую

Дата: 2026-09-02. Все факты ниже получены **реальными HTTP-запросами** к
`generativelanguage.googleapis.com` (86 сгенерированных картинок, ~150 запросов).
Ключ в файлах не сохранён — везде плейсхолдер `$GEMINI_API_KEY`.

> **ВАЖНО про ключ.** В конце спайка ключ упёрся в лимит:
> ```json
> {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. …","status":"RESOURCE_EXHAUSTED"}}
> ```
> Предоплаченные кредиты проекта закончились (спайк сжёг ~86 картинок ≈ $7–8).
> Бесплатные методы (`models.list`, `countTokens`) работают, генерация — нет.
> Перед разработкой бэкенда баланс надо пополнить.

---

## 0. TL;DR для бэкенда

| Вопрос | Ответ |
|---|---|
| Эндпоинт | `POST /v1beta/models/{model}:generateContent`, ключ в заголовке `x-goog-api-key` |
| Дефолт для «Generate Image» | **`gemini-3.1-flash-image`** (или `gemini-3.1-flash-lite-image`, если важна скорость/цена) |
| Дефолт для «Edit Image» | **`gemini-3.1-flash-image`** |
| `negativePrompt` | **поля НЕТ вообще**. Только словами в промпте, и только в позитивной формулировке |
| Размер/аспект | `generationConfig.imageConfig.{aspectRatio,imageSize}` |
| Референсы | обычные `inlineData`-парты в том же `contents[0].parts` |
| Формат ответа | 2.5-flash → **PNG**, все gemini-3 → **JPEG**. Всегда base64 inline |
| Таймаут | **90 с** для 1K, **180 с** для 4K |
| Главная ловушка | отказ модели приходит **HTTP 200** без картинки (`finishReason: NO_IMAGE` / `IMAGE_SAFETY`) |
| SDK vs REST | **REST через `fetch`** (обоснование в §10) |

---

## 1. text → image

### Эндпоинт

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

Ключ можно и в query (`?key=`), но заголовок правильнее — не течёт в логи прокси.

### Минимальный рабочий запрос

`generationConfig` **не обязателен** — image-модель и без него возвращает картинку:

```json
{
  "contents": [ { "parts": [ { "text": "A red ceramic coffee mug on a wooden table, soft morning light, photorealistic" } ] } ]
}
```

Ответ (HTTP 200, 7.25 с):

```json
{
  "candidates": [{
    "content": {
      "parts": [
        { "text": "Here is your image: " },
        { "inlineData": { "mimeType": "image/png", "data": "<... 1998768 base64 chars ...>" } }
      ],
      "role": "model"
    },
    "finishReason": "STOP",
    "index": 0
  }],
  "usageMetadata": {
    "promptTokenCount": 16,
    "candidatesTokenCount": 1296,
    "totalTokenCount": 1312,
    "promptTokensDetails":     [{ "modality": "TEXT",  "tokenCount": 16 }],
    "candidatesTokensDetails": [{ "modality": "IMAGE", "tokenCount": 1290 }],
    "serviceTier": "standard"
  },
  "modelVersion": "gemini-2.5-flash-image",
  "responseId": "HN2XapOEKtL8nsEP27CN0Q0"
}
```

Обратите внимание: **перед картинкой прилетел лишний текстовый парт** `"Here is your image: "`.

### Рекомендуемый запрос для бэкенда

```json
{
  "contents": [ { "role": "user", "parts": [ { "text": "<prompt>" } ] } ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": { "aspectRatio": "16:9", "imageSize": "1K" }
  }
}
```

`responseModalities: ["IMAGE"]` — единственный способ **выключить болтовню модели**.
Проверено на `gemini-2.5-flash-image`:

| `responseModalities` | что в `parts` |
|---|---|
| не задан | `[text]`, `[inlineData]` |
| `["IMAGE"]` | `[inlineData]` ← нужный вариант |
| `["TEXT","IMAGE"]` | `[text]`, `[inlineData]` |
| `["TEXT"]` | `[text]`, `[inlineData]` (игнорируется) |
| `["BANANA"]` | HTTP 400, `Invalid value at 'generation_config.response_modalities[0]' … "BANANA"` |

### Где лежит картинка

`candidates[0].content.parts[N].inlineData` → `{ mimeType, data }`, `data` — **base64 без префикса** `data:`.
Партов может быть несколько (текст + картинка), поэтому парсить надо **перебором `parts` с поиском `inlineData`**, а не `parts[0]`.

### Формат вывода зависит от модели (не документировано!)

| Модель | mimeType | 1K по умолчанию |
|---|---|---|
| `gemini-2.5-flash-image` | `image/png` (~1.5 МБ) | 1024×1024 |
| `gemini-3.1-flash-lite-image` | `image/jpeg` (~0.7 МБ) | 1408×768 |
| `gemini-3.1-flash-image` | `image/jpeg` (~0.7 МБ) | 1408×768 |
| `gemini-3-pro-image` | `image/jpeg` (~0.8 МБ) | 1408×768 |

Заставить 2.5-flash отдать JPEG **нельзя**: `responseFormat.image.mimeType: "IMAGE_JPEG"` принимается (HTTP 200) и молча игнорируется — всё равно PNG.

### Токены = деньги

Число output-токенов **не зависит от промпта**, только от модели и размера:

| Модель | 512 | 1K | 2K | 4K |
|---|---|---|---|---|
| `gemini-2.5-flash-image` | — | 1290 | 1290 | 1290 |
| `gemini-3.1-flash-lite-image` | — | 1120 | — | — |
| `gemini-3.1-flash-image` | 1120* | 1120 | 1680 | 2520 |
| `gemini-3-pro-image` | — | 1120 | 1120 | 2000 |

\* при `imageSize:"512"` у 3.1-flash отдалось 704×384, но `candidatesTokensDetails` всё равно показал 1120 (замерено один раз).
`gemini-3-pro-image` дополнительно тратит `thoughtsTokenCount` 136–220 на запрос (это оплачиваемые thinking-токены).

Входная картинка 512×512 или 1024×1024 = **258 токенов** (проверено `countTokens`).

---

## 2. image + text → image (edit)

Отдельного эндпоинта нет. Та же `generateContent`, картинка идёт **обычным партом** рядом с текстом.

```json
{
  "contents": [ { "role": "user", "parts": [
    { "inlineData": { "mimeType": "image/png", "data": "<base64 исходника>" } },
    { "text": "Change the mug color to bright blue and add a small yellow rubber duck sitting next to the mug. Keep everything else identical." }
  ] } ],
  "generationConfig": { "responseModalities": ["IMAGE"] }
}
```

**Редактирование реально работает** — проверено глазами и численно:

| Модель | HTTP | время | выход | изменено пикселей (>15/255) |
|---|---|---|---|---|
| `gemini-2.5-flash-image` | 200 | 10.6 с | PNG 1024×1024 | 16.6 % |
| `gemini-3.1-flash-image` | 200 | 11.5 с | JPEG 1024×1024 | 16.6 % |
| `gemini-3-pro-image` | 200 | 20.0 с | JPEG 1024×1024 | 15.7 % |

То есть ~84 % кадра сохраняется попиксельно — правка локальная, а не перерисовка.
Субъективно наиболее верен исходной композиции `gemini-3.1-flash-image`; `gemini-3-pro-image` слегка перекадрирует.

Дополнительно:
* **Порядок партов не важен** — `[image, text]` и `[text, image]` дали идентичный результат и одинаковый `usageMetadata`.
* **Аспект наследуется от входа автоматически**: подали 1024×1024 → получили 1024×1024, хотя `aspectRatio` не задавали (у gemini-3 дефолт без входа — 1408×768).
* `promptTokenCount` при редактировании: 284 = 26 TEXT + 258 IMAGE.

---

## 3. Несколько референсов + промпт

Формат ровно тот же: **N партов `inlineData` подряд, затем текстовый парт**.

```json
{
  "contents": [ { "role": "user", "parts": [
    { "inlineData": { "mimeType": "image/jpeg", "data": "<ref A>" } },
    { "inlineData": { "mimeType": "image/jpeg", "data": "<ref B>" } },
    { "inlineData": { "mimeType": "image/jpeg", "data": "<ref C>" } },
    { "text": "Using the first image as the character reference, the second image as the wall pattern reference, and the third image as the object reference: draw the fox character standing in front of a wall tiled with that exact pattern, holding the brass teapot. Keep the flat vector illustration style of image 1." }
  ] } ],
  "generationConfig": { "responseModalities": ["IMAGE"], "imageConfig": { "aspectRatio": "1:1" } }
}
```

**Результат: все три референса реально учтены** (персонаж, паттерн стены, объект в лапах) — см.
`img09_ref3_25f_0_0.png` и `img09_ref3_3pro_0_0.jpg`.
Разница качества:
* `gemini-2.5-flash-image` — вклеил фотографический чайник в векторную сцену, стиль не унифицирован.
* `gemini-3-pro-image` / `gemini-3.1-flash-image` — перерисовали чайник в плоском векторе, композиция цельная. **Для Preset с массивом `references` брать gemini-3.x.**

### Как ссылаться на конкретный референс

Работают оба способа, разницы в качестве не увидел:
1. «the first image / the second image» + все картинки подряд.
2. Чередование меток и картинок: `{text:"CHARACTER REFERENCE:"}, {image}, {text:"PATTERN REFERENCE:"}, {image}, …`

### Сколько картинок реально принимает API

**Жёсткого лимита на количество нет.** Проверено:

| N входных картинок | 2.5-flash | 3.1-flash | 3-pro |
|---|---|---|---|
| 5 / 10 / 14 / 15 / 16 / 20 / 22 | 200 | 200 | 200 |
| 100 (25 813 prompt-токенов) | 200 | — | — |
| 140 (36 133 токена, **выше заявленного `inputTokenLimit` 32768**) | 200 | — | — |
| 200 (51 613 токенов) | 200 | — | — |

То есть документированные «до 14 референсов» — это **рекомендация по качеству, а не ограничение API**.
Валидатор их не проверяет; сверх ~5–6 картинок модель начинает терять детали, но 400 не отдаёт.

### Размер запроса

Документированный лимит «20 МБ inline» **на практике не форсится**. Проверено `gemini-2.5-flash-image`:

| JSON payload | результат |
|---|---|
| 11 МБ | 200, 15.2 с |
| 22 МБ | 200, 13.9 с |
| 33 МБ | 200, 18.1 с |
| 44 МБ | 200, 15.5 с |
| **88 МБ** | 200, 27.6 с |
| **176 МБ** | 200, 38.3 с |

Полагаться на это **не стоит** (лимит могут включить в любой момент), но и городить Files API ради 3 референсов по 1 МБ не нужно. Практическое правило для бэкенда: **сжимать референсы до ~1024 px / JPEG q85 перед отправкой** — 512×512 и 1024×1024 стоят одинаковых 258 токенов, так что большие картинки не дают ничего, кроме трафика.

---

## 4. negativePrompt

### Поля НЕТ. Точка.

Проверено перебором всех вероятных мест — везде HTTP 400 «Cannot find field»:

| Куда положили | Ответ |
|---|---|
| `generationConfig.negativePrompt` | 400 `Unknown name "negativePrompt" at 'generation_config': Cannot find field.` |
| `generationConfig.negative_prompt` | 400 `Unknown name "negative_prompt" at 'generation_config'` |
| `generationConfig.imageConfig.negativePrompt` | 400 `Unknown name "negativePrompt" at 'generation_config.image_config'` |
| корень запроса `negativePrompt` | 400 `Unknown name "negativePrompt": Cannot find field.` |
| `generationConfig.imageConfig.personGeneration` | 400 `Unknown name "personGeneration" at 'generation_config.image_config'` |

Подтверждено **официальным discovery-документом** (`GET https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`):

```json
"ImageConfig": {
  "type": "object",
  "description": "Config for image generation features.",
  "properties": {
    "imageSize":   { "type": "string", "description": "… Supported values are `512`, `1K`, `2K`, `4K`. …" },
    "aspectRatio": { "type": "string", "description": "… Supported aspect ratios: `1:1`, `1:4`, `4:1`, `1:8`, `8:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, or `21:9`. …" }
  }
}
```

Ровно два поля. `negativePrompt` есть только у **устаревшего** `ai.models.generateImages()` (Imagen), который (а) deprecated, (б) по API-ключу вообще не работает — возвращает *«This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI)»*.

### Как формулировать вместо него — эмпирика

Промпт-база: `"A busy shopping street in Tokyo at night, neon signs, photorealistic"`, цель — убрать людей и машины. Все четыре с `seed: 7`, `aspectRatio: "16:9"`:

| Вариант | Формулировка | Результат |
|---|---|---|
| baseline | без ограничений | люди и машины есть |
| **naive** | `… Negative prompt: people, cars, text` | ❌ **не сработало** — люди на кадре остались, текста полно (`img13_neg_naive`) |
| **imperative** | `… Do not include any people, cars or vehicles.` | ✅ сработало — улица пустая (`img13_neg_dont`) |
| **semantic positive** | `An empty, deserted shopping street … completely devoid of people and vehicles — only bare wet asphalt and empty sidewalks.` | ✅ сработало лучше всех, кадр чистый (`img13_neg_positive`) |

**Правило для бэкенда:** поле `negativePrompt` из UI надо **транслировать в текст промпта**, причём не как список ключевых слов. Рабочий шаблон:

```
{positive_prompt}

The scene must not contain: {negative_prompt}. Describe an image completely without them.
```

Что совпадает с официальной рекомендацией доки: *«Use "semantic negative prompts": Instead of saying "no cars," describe the intended scene positively: "an empty, deserted street with no signs of traffic."»*

### Заодно проверено про `seed`

`generationConfig.seed` **принимается** (HTTP 200), но **воспроизводимости не даёт**:

```
одинаковый seed 12345, два прогона: mean|diff| = 55.3
разные seed 12345 vs 999:            mean|diff| = 46.0
```

Две картинки с одним seed отличаются друг от друга **сильнее**, чем картинки с разными seed. Обещать пользователю «повторить генерацию по seed» нельзя.

`candidateCount: 2` → 400 `Multiple candidates is not enabled for this model`. Батч из N картинок = N запросов.

---

## 5. Размер и аспект

### Где живут параметры

Только `generationConfig.imageConfig`. Всё остальное — 400:

```
generationConfig.aspectRatio    → 400 Unknown name "aspectRatio" at 'generation_config'
generationConfig.bananaField    → 400 Unknown name "bananaField" at 'generation_config'
```

### Два независимых слоя валидации

1. **Proto-валидация** — общий список для всего API:
   ```
   aspectRatio "3:7" → 400: "* GenerateContentRequest.generation_config.image_config.aspect_ratio:
   aspect_ratio must be one of '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3',
   '4:5', '5:4', '8:1', '9:16', '16:9', or '21:9'."
   ```
2. **Per-model проверка** — своя формулировка:
   ```
   aspectRatio "1:4" на 2.5-flash → 400: "Aspect ratio 1:4 is not supported for this model"
   imageSize "8K"   на 3-pro      → 400: "Unsupported image_size '8K'. Supported values are: 1K, 2K, 4K, 512, 512P, 512PX."
   imageSize "2K"   на lite       → 400: "Image size 2K is not supported for this model"
   ```

### aspectRatio — что реально принимает каждая модель (все 14 значений перебраны)

| aspectRatio | 2.5-flash (PNG) | 3.1-flash | 3-pro |
|---|---|---|---|
| `1:1` | ✅ 1024×1024 | ✅ 1024×1024 | ✅ 1024×1024 |
| `2:3` | ✅ 832×1248 | ✅ | ✅ |
| `3:2` | ✅ 1248×832 | ✅ | ✅ |
| `3:4` | ✅ 864×1184 | ✅ | ✅ |
| `4:3` | ✅ 1184×864 | ✅ | ✅ |
| `4:5` | ✅ 896×1152 | ✅ | ✅ |
| `5:4` | ✅ 1152×896 | ✅ | ✅ |
| `9:16` | ✅ 768×1344 | ✅ | ✅ 768×1376 |
| `16:9` | ✅ 1344×768 | ✅ 1408×768 | ✅ 1408×768 |
| `21:9` | ✅ 1536×672 | ✅ | ✅ |
| `1:4` | ❌ 400 | ✅ 512×2064 | ❌ 400 |
| `4:1` | ❌ 400 | ✅ | ❌ 400 |
| `1:8` | ❌ 400 | ✅ | ❌ 400 |
| `8:1` | ❌ 400 | ✅ 2928×352 | ❌ 400 |

**Экстремальные баннерные пропорции (1:4, 4:1, 1:8, 8:1) есть только у `gemini-3.1-flash-image`.**

### imageSize

| Значение | 2.5-flash | lite | 3.1-flash | 3-pro |
|---|---|---|---|---|
| `512` / `512P` | ❌ 400 | ❌ 400 | ✅ (704×384 при дефолтном аспекте) | ❌ 400 |
| `1K` | ✅ 1024×1024 | ✅ 1408×768 | ✅ 1408×768 | ✅ 1408×768 |
| `2K` | ⚠️ **проглочен и проигнорирован** → 1024×1024 | ❌ 400 | ✅ 2816×1536 | ✅ 2752×1536 |
| `4K` | ⚠️ **проглочен и проигнорирован** → 1024×1024 | ❌ 400 | ✅ 5632×3072 | ✅ 5632×3072 |
| `8K` (невалидное) | ⚠️ **HTTP 200**, 1024×1024 | — | — | ❌ 400 с перечислением |

⚠️ **Ловушка:** `gemini-2.5-flash-image` **не валидирует `imageSize` вообще** — принимает даже `"8K"` и молча отдаёт 1024×1024. На 2.5-flash нельзя доверять «раз 200 — значит применилось». Валидировать `imageSize` надо на своей стороне.

### Дефолтный аспект у gemini-3 «плавающий»

Без `aspectRatio` gemini-3 модели **сами выбирают пропорции по смыслу промпта**:

* «coffee mug on a wooden table» → 1408×768 (альбом)
* «a tall narrow lighthouse standing on a cliff, **vertical composition**» → **848×1264 (портрет)**
* при редактировании → аспект входной картинки

`gemini-2.5-flash-image` без `aspectRatio` всегда даёт 1024×1024.

**Для бэкенда: всегда задавайте `aspectRatio` явно**, иначе размер выхода непредсказуем.

### `responseFormat` — есть в схеме, но НЕ работает

В discovery-документе появился новый `generationConfig.responseFormat.image` (`ImageResponseFormat`) с полями `delivery: INLINE|URI`, `mimeType`, `aspectRatio`, `imageSize`. Соблазнительно — `delivery: "URI"` вернул бы ссылку вместо 2 МБ base64.

**Не работает ни на одной модели:**

```
responseFormat.image.delivery = "URI"           → 400 {"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}
responseFormat.image.mimeType = "IMAGE_JPEG"    → 200, но всё равно PNG
responseFormat.image.aspectRatio = "ASPECT_RATIO_SIXTEEN_BY_NINE" → 200, игнорируется
```

Вывод: **пользоваться `generationConfig.imageConfig`**, `responseFormat` — задел на будущее.

---

## 6. Новый Interactions API (важно знать, но брать не обязательно)

Официальная дока image-generation **полностью переехала** на новый эндпоинт и больше не упоминает `generateContent`:

> *«While generateContent remains fully supported, we recommend the Interactions API for all new development.»*

Проверен вживую — работает.

```
POST https://generativelanguage.googleapis.com/v1beta/interactions
x-goog-api-key: $GEMINI_API_KEY

{
  "model": "gemini-3.1-flash-image",
  "input": "A red ceramic coffee mug on a wooden table",
  "response_format": { "type": "image", "aspect_ratio": "16:9", "image_size": "1K" }
}
```

Ответ (200, 12.5 с) — **совершенно другая форма**:

```json
{
  "id": "v1_ChdGT09YYW9VTl9yN25zRVB2NW5Td1Fv…",
  "status": "completed",
  "object": "interaction",
  "model": "gemini-3.1-flash-image",
  "service_tier": "standard",
  "created": "2026-09-02T08:49:24Z",
  "usage": {
    "total_tokens": 1534, "total_input_tokens": 10, "total_output_tokens": 1524,
    "output_tokens_by_modality": [ { "modality": "image", "tokens": 1120 } ],
    "total_thought_tokens": 0, "raw_prompt_token": 452
  },
  "steps": [
    { "type": "thought", "signature": "<opaque base64>" },
    { "type": "model_output", "content": [ { "type": "image", "mime_type": "image/jpeg", "data": "<base64>" } ] }
  ]
}
```

Что проверено:

| Что | Результат |
|---|---|
| `gemini-2.5-flash-image` | ✅ работает (хотя дока его в таблице Interactions не перечисляет), отдаёт PNG |
| `gemini-3.1-flash-lite-image` | ✅ работает |
| **Редактирование / референсы** | `input` = **плоский список контент-блоков**: `[{"type":"image","mime_type":"image/png","data":"…"},{"type":"text","text":"Make the mug bright green."}]`. Работает. |
| `input` как turn-list (`[{role:"user",content:[…]}]`) | ❌ 400 `When using the steps-based API version, use step_list input format instead of turn_list.` |
| `response_format.mime_type` | только `image/jpeg`: `The value 'image/png' is not supported for 'response_format.mime_type'. Supported values: 'image/jpeg'.` |
| Отказ по safety | **200**, `status: "completed"`, но в `steps[].content` вместо картинки текст: `"I can't generate an image of a decapitated human body."` |
| Несуществующая модель | 404, **строковые коды ошибок**: `{"error":{"message":"Model 'gemini-9-ultra-image' not found. Did you mean 'gemini-3-pro-image'? …","code":"not_found"}}` |

**Рекомендация:** для тестового задания брать **`generateContent`** — стабилен, документирован в REST-референсе, поддержан SDK, форма ответа проще.

Главное отличие в обработке ошибок: у `generateContent` `error.code` — **число** (404) и `error.status` — строка (`NOT_FOUND`); у Interactions `error.code` — **строка** (`not_found`), числового кода в теле нет. Один маппер на оба не натянется.

---

## 7. Таблица моделей

Замеры: 5 последовательных прогонов одного промпта на модель (`bench_t2i.json`).

| Модель | 1K: min / медиана / max | 4K: min / мед / max | Формат | 1K по умолч. | Edit | Референсы | Экстрим-аспекты | 512 | 2K/4K | thinking |
|---|---|---|---|---|---|---|---|---|---|---|
| `gemini-3.1-flash-lite-image` | **4.0 / 4.2 / 4.5 с** | ❌ | JPEG | 1408×768 | ✅ | ✅ (хуже) | ❌ | ❌ | ❌ | нет |
| `gemini-2.5-flash-image` | 7.6 / 7.8 / 10.3 с | ❌ | **PNG** | 1024×1024 | ✅ | ✅ (стиль не сводит) | ❌ | ❌ | ❌ (молча игнор) | нет |
| `gemini-3.1-flash-image` | 10.7 / 11.8 / 12.5 с | 28.0 / 28.5 / 30.4 с | JPEG | 1408×768 | ✅ **лучшая верность** | ✅ **отлично** | ✅ 1:4,4:1,1:8,8:1 | ✅ | ✅ | да |
| `gemini-3-pro-image` | 17.3 / 19.4 / 20.3 с | 31.7 / 34.6 / 38.0 с | JPEG | 1408×768 | ✅ (слегка перекадрирует) | ✅ **отлично** | ❌ | ❌ | ✅ | да, 136–220 токенов |

Промежуточные замеры: `3.1-flash` 2K ≈ 18 с, `3-pro` 2K ≈ 21.7 с.

### Качество (субъективно, по одинаковым промптам)

* **`gemini-3-pro-image`** — заметно богаче свет, композиция, детализация.
* **`gemini-3.1-flash-image`** — очень близко к pro за половину времени. Лучше всех держит исходник при редактировании.
* **`gemini-3.1-flash-lite-image`** — на удивление хорош для 4 секунд, но проще по свету и композиции.
* **`gemini-2.5-flash-image`** — legacy. Только 1024×1024, при смешивании референсов не сводит стили. Дока прямо говорит: *«we strongly recommend that customers transition to Nano Banana 2 Lite»*.

### Цены (официальная страница pricing, за одну картинку)

| Модель | 512 | 1K | 2K | 4K |
|---|---|---|---|---|
| `gemini-3.1-flash-lite-image` | — | **$0.0336** | — | — |
| `gemini-2.5-flash-image` | — | $0.039 | — | — |
| `gemini-3.1-flash-image` | $0.045 | $0.067 | $0.101 | $0.151 |
| `gemini-3-pro-image` | — | $0.134 | $0.134 | $0.24 |

### Рекомендация

* **Generate Image (дефолт): `gemini-3.1-flash-image`.**
  Единственная модель, у которой есть всё сразу: 512/1K/2K/4K, все 14 аспектов, сильная работа с несколькими референсами, JPEG на выходе (вдвое меньше трафика, чем PNG у 2.5), ~12 с на 1K. Дока сама называет её *«your go-to image generation model»*.
* **Edit Image (дефолт): тоже `gemini-3.1-flash-image`.**
  Наибольшая верность исходнику при локальной правке, аспект входа наследует автоматически. Заводить для edit отдельную модель незачем.
* **`gemini-3-pro-image`** — опция «High quality» (в 1.7× медленнее, в 2× дороже).
* **`gemini-3.1-flash-lite-image`** — опция «Fast / draft» и превью: 4 секунды, $0.034.
* **`gemini-2.5-flash-image`** — не брать дефолтом. Держать в списке только если в задании явно назван «Nano Banana».

---

## 8. Ошибки и лимиты → статусы job'а

Все тела ниже — реальные ответы.

| # | Сценарий | HTTP | Тело (сокращённо) | Статус job'а | Retry? |
|---|---|---|---|---|---|
| 1 | Неверный API-ключ | **400** | `{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"…ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com"}]}}` | `failed` (config error, алерт ops) | ❌ |
| 2 | Ключ пустой / не передан | **403** | `{"error":{"code":403,"message":"Method doesn't allow unregistered callers (callers without established identity)…","status":"PERMISSION_DENIED"}}` | `failed` (config error) | ❌ |
| 3 | Несуществующая модель | **404** | `{"error":{"code":404,"message":"models/gemini-9-ultra-image is not found for API version v1beta, or is not supported for generateContent…","status":"NOT_FOUND"}}` | `failed` (validation) | ❌ |
| 4 | Модель снята с обслуживания | **404** | `{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash…","status":"NOT_FOUND"}}` | `failed` (config error) | ❌ |
| 5 | Невалидное значение в config | **400** | `{"error":{"code":400,"message":"Aspect ratio 1:4 is not supported for this model","status":"INVALID_ARGUMENT"}}` / `"Unsupported image_size '8K'. Supported values are: 1K, 2K, 4K, 512, 512P, 512PX."` | `failed` (validation) — ловить своей валидацией до вызова | ❌ |
| 6 | Неизвестное поле в JSON | **400** | `{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"negativePrompt\" at 'generation_config': Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"…BadRequest","fieldViolations":[…]}]}}` | `failed` (bug) | ❌ |
| 7 | `contents` отсутствует | **400** | `{"error":{"code":400,"message":"* GenerateContentRequest.contents: contents is not specified\n","status":"INVALID_ARGUMENT"}}` | `failed` (validation) | ❌ |
| 8 | `parts: []` | **400** | `{"error":{"code":400,"message":"Request has empty input.","status":"INVALID_ARGUMENT"}}` | `failed` (validation) | ❌ |
| 9 | **Пустой промпт** `text: ""` | **200 (!)** | `{"candidates":[{"finishReason":"NO_IMAGE","index":0}],"usageMetadata":{"serviceTier":"standard"},…}` | `failed` («опишите, что нарисовать») | ❌ |
| 10 | **Safety-блок, 2.5-flash / 3.1-flash**, `responseModalities:["IMAGE"]` | **200 (!)** | `{"candidates":[{"content":{},"finishReason":"NO_IMAGE","index":0}],"usageMetadata":{"promptTokenCount":18,"totalTokenCount":18,…}}` | `rejected` (content policy) | ❌ |
| 11 | **Safety-блок, 3-pro** | **200 (!)** | `{"candidates":[{"content":{},"finishReason":"IMAGE_SAFETY","finishMessage":"Unable to show the generated image. The image was filtered out because it violated Google's Generative AI Prohibited Use policy. You will not be charged for blocked images. Try rephrasing the prompt…","index":0}],"usageMetadata":{"thoughtsTokenCount":220,…}}` | `rejected` — `finishMessage` можно показать пользователю | ❌ |
| 12 | Safety-блок при `responseModalities:["TEXT","IMAGE"]` | **200 (!)** | `finishReason: "STOP"`, а в `parts[0].text`: `"I cannot fulfill this request. My purpose is to be helpful and harmless…"` | `rejected` | ❌ |
| 13 | Промпт без картиночного намерения («What is the capital of France?») | **200 (!)** | `{"candidates":[{"finishReason":"NO_IMAGE","index":0}]}` | `failed` | ❌ |
| 14 | **429 — RPM-квота модели** | **429** | `{"error":{"code":429,"message":"You exceeded your current quota… * Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 500, model: gemini-2.5-flash-preview-image\nPlease retry in 34.286670503s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"…QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel","quotaValue":"500","quotaDimensions":{"model":"gemini-2.5-flash-preview-image","location":"global"}}]},{"@type":"…RetryInfo","retryDelay":"34s"}]}}` | `queued/retrying` | ✅ **по `RetryInfo.retryDelay`** |
| 15 | **429 — кончились кредиты** | **429** | `{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing…","status":"RESOURCE_EXHAUSTED"}}` — **`details` нет** | `failed` (billing) + алерт | ❌ **ретрай бесполезен** |
| 16 | **503 — сервис недоступен** | **503** | `{"error":{"code":503,"message":"The service is currently unavailable.","status":"UNAVAILABLE"}}` | `queued/retrying` | ✅ экспоненциальный backoff |

### Что из этого критично

**1) Отказ модели приходит с HTTP 200.** Пять из шестнадцати сценариев — успешный HTTP с отсутствующей картинкой. Наивный код `res.ok ? save(parts[0].inlineData.data)` упадёт с `TypeError` и запишет job как «упал по внутренней ошибке» вместо «контент отклонён».

```js
const cand = json.candidates?.[0];
const img  = cand?.content?.parts?.find(p => p.inlineData)?.inlineData;
if (!img) {
  // cand.finishReason: NO_IMAGE | IMAGE_SAFETY | IMAGE_PROHIBITED_CONTENT |
  //                    IMAGE_RECITATION | IMAGE_OTHER | PROHIBITED_CONTENT | SAFETY | STOP
  throw new ContentRejected(cand?.finishReason ?? 'NO_IMAGE', cand?.finishMessage);
}
```

**2) Разные модели отдают разный `finishReason` на один и тот же запрещённый промпт** (`NO_IMAGE` у 2.5/3.1-flash, `IMAGE_SAFETY` у 3-pro). Маппер должен покрывать весь набор.

**3) Два разных 429.** Отличать по наличию `error.details[]`:
* есть `RetryInfo` / `QuotaFailure` → временный, ретраить через `retryDelay`;
* `details` нет → кончились деньги, ретраить нельзя.

**4) `safetySettings` не помогают.** Все четыре категории с `threshold: "BLOCK_NONE"` — ответ прежний, `NO_IMAGE`. Фильтр картинок отдельный.

**5) Заголовка `Retry-After` НЕТ.** В ответе 429 из заголовков только `X-Gemini-Service-Tier: standard`. Задержку брать **из тела**: `error.details[].retryDelay` (строка `"34s"`) либо парсить `message` (`"Please retry in 34.286670503s"`).

### Реальные лимиты (замерено)

* Пачка **240 запросов за 11 с (~1300 RPM)** — все 200.
* Пачка **1500 запросов за 11.4 с** — `{200: 416, 429: 1083, 503: 1}`, в теле 429: `quotaValue: "500"`, `quotaId: GenerateRequestsPerMinutePerProjectPerModel`.
* → **500 запросов в минуту на модель на проект**. Квота **на проект, не на ключ**, и **отдельная на каждую модель** — раскидать нагрузку по двум моделям = удвоить пропускную способность.
* 503 встретился 2 раза за ~150 запросов — редкий, но реальный: **обязательно ретраить**.

---

## 9. Таймауты и retry-политика

Худшее наблюдавшееся время генерации — **38.0 с** (`gemini-3-pro-image` @ 4K). С 176-МБ запросом — 38.3 с. TTFB на ошибках валидации — 0.4–0.9 с.

| Что | Значение |
|---|---|
| HTTP-таймаут на 512/1K | **90 с** |
| HTTP-таймаут на 2K/4K | **180 с** |
| Таймаут job'а целиком (с ретраями) | **10 мин** |
| Retryable HTTP-коды | `408, 429 (только с details), 500, 502, 503, 504` + сетевые/`ECONNRESET` |
| Ретраев | 3 (итого 4 попытки) |
| Backoff | экспоненциальный `1s → 2s → 4s` + jitter; **на 429 — `max(backoff, RetryInfo.retryDelay)`** |
| НЕ ретраить | все `400`, `403`, `404`, `429` без `details`, и любой ответ с `finishReason` ≠ картинка |

Дока подтверждает: *«If you receive an error indicating that you should retry your request (such as a 429 RESOURCE_EXHAUSTED or 503 UNAVAILABLE), we recommend implementing an exponential backoff strategy… (for example, 1 second), then increase the delay exponentially (for example, 2s, 4s, 8s).»*

Стриминг (`:streamGenerateContent?alt=sse`) проверить не успел — упёрся в исчерпанные кредиты. Для картинок он всё равно мало что даёт: изображение приходит одним куском в конце.

---

## 10. SDK vs REST — рекомендация: **REST**

Пакет `@google/genai` проверен вживую (установлен, запущен, сгенерировал и отредактировал картинку).

**Что он собой представляет:** версия **2.20.0** (опубликована 2026-08-31), `node >= 20`, dual ESM/CJS, типы есть (`dist/genai.d.ts`, 664 КБ). Ставит **29 МБ / 41 пакет**: `google-auth-library` (нужен только для Vertex), `protobufjs` (локальный токенайзер), `ws` (Live API), `web-streams-polyfill` 8.7 МБ. Для одного POST'а с API-ключом не нужно ничего из этого.

**Аргументы против SDK (все проверены):**

1. **Retry по умолчанию выключен.** В `apiCall`: `if (!retryOptions) return runFetch();`. На локальном сервере, всегда отдающем 503: без `retryOptions` — 1 попытка; с `retryOptions:{attempts:3}` — 3. Ретраи всё равно писать/включать руками.
2. **`httpOptions.timeout` мутирует глобальный undici-диспетчер процесса** (`Symbol.for('undici.globalDispatcher.1')`). Поставив 180 с на 4K-генерацию, вы задираете таймауты **всем остальным `fetch` в приложении**.
3. **Маппинг ошибок SDK не упрощает — усложняет.** `ApiError` имеет два своих поля: `name` и `status: number`. Гугловый JSON запихнут в `message` **строкой целиком**, так что `error.status: "RESOURCE_EXHAUSTED"`, `details[].retryDelay` и `reason: "API_KEY_INVALID"` приходится доставать через `JSON.parse(e.message)`. При этом в `catch` прилетают **три разных класса**: `ApiError` (HTTP 4xx/5xx), `DOMException` (таймаут/abort, `instanceof ApiError === false`), голый `Error` (клиентская валидация). В REST-версии ветка одна: `if (!res.ok) { const {error} = await res.json(); }` — и `error.code`, `error.status`, `error.details` доступны структурно.
4. **Неотключаемый `console.log` из библиотеки.** Геттер `.text` на чисто-картиночном ответе печатает `there are non-text parts inlineData in the response…`.
5. **Типы не отражают рантайм.** В `ImageConfig` SDK объявлены `personGeneration`, `outputMimeType`, `imageOutputOptions`, `prominentPeople` — половина помечена «not supported in Gemini API», и `personGeneration` живьём даёт **400 Unknown name**. `responseModalities` типизирован как сырой `string[]` — опечатку `'IMAGES'` компилятор не поймает.
6. **`generateImages()` (с тем самым `negativePrompt`) по API-ключу не работает**: *«This method is only supported by the Gemini Enterprise Agent Platform»* — и он уже deprecated.

**Что честно за SDK:** готовый рантайм-enum `FinishReason` (18 значений, включая все шесть картиночных), беспроблемный `tsc --strict`, задел на Files API / Live API / Vertex.

**Итог.** Для бэкенда с job-статусами — **тонкий `geminiClient.ts` на голом `fetch`** (~120 строк): `AbortSignal.timeout()` для дедлайна (локальный, без глобальных эффектов), свой цикл ретраев с уважением к `RetryInfo.retryDelay`, один `switch` по `error.status` и второй по `candidates[0].finishReason`. Значения `FinishReason` скопировать как локальный union-тип — 18 строк, ноль зависимостей.

Минимальный рабочий REST-вызов (проверен, 200 OK, 7.3 с):

```js
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  },
);
```

Если в критериях приёмки явно ждут «использован официальный SDK» — он ставится и работает, но **обязательно** передавайте `httpOptions.retryOptions` (иначе ретраев нет) и учитывайте глобальный undici-эффект от `timeout`.

---

## 11. Расхождения с официальной документацией

| # | Дока говорит | На деле | Комментарий |
|---|---|---|---|
| 1 | Гайд image-generation целиком на **Interactions API**, `generateContent` в нём не упомянут ни разу | `generateContent` полностью работает, REST-референс живой и не deprecated | Дока опережает реальность |
| 2 | *«Up to 14 reference images»* | API принял **200 картинок** и 51 613 prompt-токенов без ошибки | 14 — рекомендация по качеству, не лимит |
| 3 | *«total request size … 20MB»* | Прошёл payload **176 МБ** | Лимит не форсится; полагаться нельзя, но Files API ради трёх референсов не нужен |
| 4 | `ImageConfig.imageSize` — *«Supported values are 512, 1K, 2K, 4K»* | На модель по-разному: 512 — только `3.1-flash`; 2K/4K — только `3.1-flash` и `3-pro`; **`2.5-flash` молча игнорирует любое значение** | Валидировать на своей стороне |
| 5 | `ImageConfig.aspectRatio` — 14 значений | 1:4, 4:1, 1:8, 8:1 работают **только у `gemini-3.1-flash-image`** | Сообщение об ошибке при этом честное |
| 6 | *«By default … otherwise **generates 1:1 squares**»* | Без входной картинки gemini-3 даёт **1408×768** (или портрет, если промпт «vertical»); квадрат только у `2.5-flash` | Всегда задавать `aspectRatio` явно |
| 7 | Таблица разрешений: 16:9 @ 1K = **1376×768** | Фактически **1408×768**; 16:9 @ 2K у 3-pro = 2752×1536, у 3.1-flash = 2816×1536 | Не полагаться на точные пиксели из доки |
| 8 | Формат выхода прозой не назван; единственный документированный MIME — `IMAGE_JPEG` | `gemini-2.5-flash-image` отдаёт **PNG**, заставить его отдать JPEG нельзя | Тип файла брать из `inlineData.mimeType` |
| 9 | `ImageResponseFormat.delivery: URI` | 400 `Request contains an invalid argument.` на всех трёх моделях | Не реализовано |
| 10 | Interactions-таблица моделей — только `gemini-3-pro-image` и `gemini-3.1-flash-image` | Через Interactions отработали **все четыре**, включая `2.5-flash` и `lite` | Дока отстаёт |
| 11 | Rate limits: конкретные RPM/TPM/RPD **из доки убраны** | Замерено: **500 RPM на модель на проект** (`GenerateRequestsPerMinutePerProjectPerModel`) | Цифра пришла в теле 429 |
| 12 | `seed` — «Seed used in decoding» | Воспроизводимости **нет**: одинаковый seed различается сильнее, чем разные | Не обещать reproducible-генерацию |
| 13 | SDK-тип `ImageConfig` содержит `personGeneration` | 400 `Unknown name "personGeneration" at 'generation_config.image_config'` | Поле Vertex-only |
| 14 | `negativePrompt` — у `generateImages` (Imagen) | `generateImages` по API-ключу не работает вовсе; Imagen deprecated (shutdown 2026-08-17) | negative prompt недоступен ни в каком виде |
| 15 | *«All generated images include a SynthID watermark»* | **Не проверял** — детектора SynthID нет | Единственный пункт без проверки |

---

## 12. Сохранённые картинки

Рабочая директория: `/private/tmp/claude-501/-Users-malik-Projects/47948ac0-2478-4e14-8dea-3de2b642b00a/scratchpad/gemini-spike`

**text → image (шаг 1)**
* `img01_t2i_25flash_0_1.png` — 1024×1024, базовая генерация, `gemini-2.5-flash-image`
* `img04_3pro_default_0_0.jpg`, `img04_31f_default_0_0.jpg`, `img04_31flite_default_0_0.jpg` — 1408×768, дефолт gemini-3
* `img04_3pro_4K_0_0.jpg`, `img04_31f_4K_0_0.jpg` — 5632×3072, 4K
* `img04_3pro_ar169_2K_0_0.jpg` (2752×1536), `img04_31f_2K_0_0.jpg` (2816×1536)

**edit (шаг 2)** — исходник `img01_t2i_25flash_0_1.png`, правка «синяя кружка + жёлтый утёнок»
* `img08_edit_25f_0_0.png` — 2.5-flash
* `img08_edit_31f_0_0.jpg` — 3.1-flash (**лучшая верность исходнику**)
* `img08_edit_3pro_0_0.jpg` — 3-pro
* `img08_edit_25f_textfirst_0_0.png` — обратный порядок партов

**референсы (шаг 3)**
* Входы: `refA_fox_small.jpg`, `refB_tiles_small.jpg`, `refC_teapot_small.jpg` — по 512×512
* `img09_ref3_25f_0_0.png` — 3 референса, 2.5-flash (стиль не сведён)
* `img09_ref3_3pro_0_0.jpg` — 3 референса, 3-pro (**лучший результат**)
* `img09_ref3_31f_0_0.jpg` — 3 референса, 3.1-flash
* `img09_ref2_25f_0_0.png` — 2 референса
* `img09_ref3_labeled_25f_0_0.png` — вариант с текстовыми метками

**negative prompt (шаг 4)** — все 16:9, seed 7
* `img13_neg_baseline_0_0.png` / `img13_neg_naive_0_0.png` (**не сработало**) / `img13_neg_dont_0_0.png` (✅) / `img13_neg_positive_0_0.png` (✅ лучший)

**аспекты и размеры (шаг 5)**
* `img06_ar_*.png` — 10 рабочих аспектов на `2.5-flash`
* `img07_3.1-f_ar_1_4_0_0.jpg` (512×2064), `img07_3.1-f_ar_8_1_0_0.jpg` (2928×352) — экстрим-баннеры, только 3.1-flash
* `img05_3pro_ar_1_1_0_0.jpg`, `img05_3pro_ar_9_16_0_0.jpg`, `img05_31f_ar_1_1_0_0.jpg`
* `img03_25f_size_2K_0_0.png`, `img03_25f_size_4K_0_0.png`, `img05_25f_size_bad_0_0.png` — доказательство, что 2.5-flash игнорирует `imageSize`
* `img23_512_31f_0_0.jpg`, `img23_512P_31f_0_0.jpg` — 704×384

**seed** — `img23_seedA_0_0.png`, `img23_seedB_0_0.png` (одинаковый seed 12345, разные картинки), `img23_seedC_0_0.png`

**Interactions API** — `img22_flat_content_list.jpg`, `img22_step_user_input.jpg`

**бенчмарк скорости** — `bench_<model>_<i>_0_0.{png,jpg}`, по 5 прогонов на конфигурацию

**прочее** — `img23_3pro_landscape_prompt_0_0.jpg` (848×1264, автовыбор портретного аспекта по смыслу промпта)

**сырые ответы** — `raw_*.json` (base64 заменён на `<... N b64 chars ...>`), `bench_t2i.json`, `aspect_ratios_25flash.json`, `discovery.json` (официальный discovery-документ v1beta)
