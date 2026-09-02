# OpenAI Images API — проверено вживую (2026-09-02)

Все факты ниже получены реальными запросами до начала реализации. Ключ в файлы не попадал.

## Доступные модели

`GET /v1/models` на рабочем ключе отдаёт: `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`,
`gpt-image-2`, `gpt-image-2-2026-04-21`, `chatgpt-image-latest`.

Берём **`gpt-image-2`** — свежая модель, умеет все три нужные операции.

## text → image

```
POST https://api.openai.com/v1/images/generations
Authorization: Bearer <key>
Content-Type: application/json

{ "model": "gpt-image-2", "prompt": "...", "n": 1, "size": "1024x1024" }
```

Ответ: `{ "data": [ { "b64_json": "<base64>" } ] }` — изображение приходит **base64,
а не ссылкой**. Проверено: 3 запроса, все HTTP 200, ~1.8–2.0 МБ base64 на картинку.

## image + text → image (редактирование)

```
POST https://api.openai.com/v1/images/edits
Authorization: Bearer <key>
Content-Type: multipart/form-data

model=gpt-image-2
image[]=@source.png
prompt=Make the apple bright blue and add a small yellow rubber duck next to it.
       Keep everything else identical.
```

HTTP 200 за **17.3 с**. Правка выполняется буквально: цвет объекта изменён, новый объект добавлен,
фон и композиция сохранены.

## Несколько референсов одним запросом

Поле `image[]` повторяется:

```
image[]=@ref1.png
image[]=@ref2.png
prompt=Combine: place both apples side by side on a marble table, studio lighting.
```

HTTP 200 за **18.8 с**. Обе входные картинки учтены.

Это то, ради чего провайдер и выбран: `Preset.references` — массив, и он уходит в API как массив,
а не остаётся полем в модели данных, которое никуда не передаётся.

## Чего у API нет

- **Отдельного поля negative prompt нет.** Как и у Gemini. Негатив вклеивается в текст промпта
  силами `RequestBuilder`; формулировка — утвердительная («сцена не должна содержать …»),
  а не список ключевых слов через запятую.
- Управление пропорциями — через `size` фиксированным набором значений, а не произвольным
  соотношением сторон.

## Тайминги и таймауты

Генерация — единицы секунд, редактирование — 17–19 с на 1024×1024. HTTP-таймаут ставим 120 с,
таймаут job'а целиком — 10 минут, как и для Gemini.

## Ошибки

Конверт единый: `{ "error": { "message": "...", "type": "...", "code": "..." } }`.
Неверный ключ — HTTP 401, `code: "invalid_api_key"`. Это невосстановимая ошибка конфигурации,
`retryable: false`. Ретраятся 429, 500, 502, 503, 504 и сетевые сбои.

## Дополнено после реализации провайдера

Факты, найденные уже при написании адаптера, живыми запросами:

- **`size` принимает произвольное `ШИРИНАxВЫСОТА`**, а не фиксированный перечень: текст ошибки при
  неверном значении сам подсказывает допустимые. Подтверждены `1024x1024` и `1824x1024`.
- `quality` — `low | medium | high | auto`; `background` — `transparent | opaque | auto`.
- По умолчанию возвращается **PNG** (определяется по сигнатуре байтов — MIME в ответе не указан).
- В ответе есть `usage` с разбивкой токенов.
- Ошибка `429` бывает двух разных смыслов, как и у Gemini: `rate_limit_exceeded` ретраится
  (задержка берётся из заголовка `Retry-After`), а `insufficient_quota` и
  `billing_hard_limit_reached` — нет, это кончившиеся деньги.
