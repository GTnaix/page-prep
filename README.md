# page-prep

Подготовка страниц к загрузке на трекер. Скрипты собирают стили, картинки, шрифты и видео, оптимизируют их и подставляют код трекера. Гео, ссылки, форму и правки конкретной страницы делает Cursor по промпту.

Три трекера: **Binom**, **Keitaro**, **AIO**. Binom запускается без флага трекера. Google есть только у Binom.

> **Полная инструкция** — в документе «Подготовка страниц к загрузке на трекер». README описывает только быстрый старт и базовые команды.

## Требования

- [Git](https://git-scm.com/download)
- [Node.js LTS](https://nodejs.org/)
- Cursor + расширение [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) (от ritwickdey)

## Быстрый старт

```bash
git clone АДРЕС-РЕПОЗИТОРИЯ .
npm install
```

Положите страницу в новую папку внутри `work` — HTML-файл один, в корне папки:

```text
work/
  land/
    страница.html
    ...файлы
```

Прогоните подготовку:

```bash
# Binom, Facebook
npm run prep -- work/land --landing
npm run prep -- work/offer --offer

# Binom, Google
npm run prep -- work/land --landing --google
npm run prep -- work/offer --offer --google

# Keitaro
npm run prep -- work/land --landing --keitaro
npm run prep -- work/offer --offer --keitaro

# AIO
npm run prep -- work/land --landing --aio
npm run prep -- work/offer --offer --aio
```

Затем откройте `index.html` через **Open with Live Server**, заполните шапку промпта из `promts/<трекер>/` и отправьте файл в чат Cursor. После проверки:

```bash
npm run pack -- work/land
```

## Команды

| Команда | Что делает |
|---------|------------|
| `npm install` | Ставит библиотеки. После клонирования и после обновления. |
| `npm run prep -- work/<папка> --landing` | Подготовка лендинга. |
| `npm run prep -- work/<папка> --offer` | Подготовка оффера или ленд-оффера. |
| `npm run format -- work/<папка>` | Выравнивает HTML. Обычно запускает сам Cursor. |
| `npm run to-html -- work/<папка>` | Возвращает `index.php` в `index.html` для просмотра. |
| `npm run pack -- work/<папка>` | Собирает ZIP для загрузки на трекер. |

Трекер: Binom — без флага, Keitaro — `--keitaro`, AIO — `--aio`. Google — `--google` (только Binom).

## Структура

| Путь | Что это |
|------|---------|
| `work/<папка>/` | Страница: исходник, результат и архив. |
| `promts/binom/` | Промпты Binom: лендинг, оффер, ленд-оффер. |
| `promts/keitaro/` | Промпты Keitaro. |
| `promts/aio/` | Промпты AIO. |
| `src/` | Скрипты и вставки трекеров. Вручную не правят. |

## Обновление

```bash
git pull
npm install
```

Если `git pull` ругается на локальные изменения — вы поправили файл самого проекта, не страницу в `work/`:

```bash
git checkout -- .
git pull
npm install
```