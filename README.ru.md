# Shutdown Guard · Выключение после завершения задач
[中文](README.md) · [English](README.en.md) · **Русский**

Стабильная `v1.6.0` · бета `v1.6.1-beta.2` (закрытая бета) · [История изменений](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CHANGELOG.md)

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/banner.png" width="880" alt="Shutdown Guard — выключение после завершения всех задач, ночная карточка на боковой панели"></p>

[![version](https://img.shields.io/badge/version-1.6.0-2ea44f)](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CHANGELOG.md) [![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.5--rc.1-4a90d9)](https://github.com/deepseek-ai)
[![demo](https://img.shields.io/badge/%E2%96%B6-%D0%B4%D0%B5%D0%BC%D0%BE-d97757)](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dshbase: проверено установкой](https://dshbase.com/badges/dsh-shutdown-guard.svg)](https://dshbase.com/plugins/dsh-shutdown-guard/) [![dsh.so: проверено запуском](https://cdn.dsh.so/badge/dsh-shutdown-guard.svg)](https://www.dsh.so/artifact/dsh-shutdown-guard/?ref=badge) [![dsh-plugin.org: в каталоге](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/ltayshark0637/dsh-shutdown-guard) [![awesome-dsh-plugin: в каталоге](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/ltayshark0637/dsh-Shutdown-Guard/) [![dpharness: в каталоге](https://img.shields.io/badge/dpharness-%D0%B2%20%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%D0%B5-6f42c1)](https://dpharness.com/plugin/ltayshark0637/dsh-Shutdown-Guard)

Добавляет в боковую панель DeepSeek Harness карточку «выключить, когда все задачи готовы» — сразу под «Центром навыков» и над списком сессий, в реальном времени следуя за состоянием задач.

Она не выключает компьютер в момент, когда задача закончилась. Фоновые задачи ещё идут, сессия завершилась ошибкой, агент ждёт вашего ответа — всё это её останавливает. Она действует только когда выключать действительно безопасно, и пишет причину прямо на карточке.

**▶ [Интерактивное демо](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)** — посмотреть, как это выглядит и как принимается решение, ничего не устанавливая. Все данные генерируются локально, в сеть ничего не уходит.

## Установка

Опубликовано в npm — рекомендуемый способ:

```bash
dsh plugin --profile web add dsh-shutdown-guard
```

Для беты нужна явная версия; без неё ставится стабильная `1.6.0`:

```bash
dsh plugin --profile web add dsh-shutdown-guard@1.6.1-beta.2
```

Или напрямую с GitHub:

```bash
dsh plugin --profile web add github:ltayshark0637/dsh-Shutdown-Guard
```

Плагин встаёт в каталог плагинов DSH. После установки полностью закройте DSH и откройте заново — обновления страницы недостаточно.

> При ограниченной сети используйте способ через npm (он идёт через registry). Способ с GitHub — это фактически `pnpm add github:...`, нужен clone; если и он не проходит, ставьте с локального пути: Настройки DSH → Плагины → Добавить, укажите абсолютный путь к этому каталогу → установить → перезапустить.

## Три варианта оформления

| Минимал (светлая) | Радар (светлая) | Терминал (светлая) |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/01-armed-a-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/07-armed-b-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/13-armed-c-zh-light.png" width="250"> |

| Минимал (тёмная) | Радар (тёмная) | Терминал (тёмная) |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/02-armed-a-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/08-armed-b-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/14-armed-c-zh-dark.png" width="250"> |

Одна карточка, три способа её нарисовать: «Минимал» оставляет крупный заголовок и одну строку, «Радар» превращает сессии и задачи в точки, которые никогда не переставляются, «Терминал» пишет три строки команд и шесть сегментов-индикаторов. Выберите миниатюру на странице «Внешний вид» настроек — и она применится сразу, без перезапуска; сами миниатюры следуют за языком интерфейса и фоном.

Сигнальная лента внизу карточки и плавающего окна следует за состоянием: с момента взведения это классическая красно-жёлтая, а без взведения и в блокировке — две спокойные ступени того же оттенка; переход — 280 мс кроссфейда, без мигания.

Значок окна справа в шапке карточки вынимает её в отдельное плавающее окно, которое можно поставить в угол экрана и держать перед глазами; внешний вид, тема и язык в нём следуют за настройками.

## Настройки

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/12-settings-dark.png" width="380" alt="Страница настроек (тёмная)"></p>

Четыре вкладки; открывается на «Внешнем виде», все переключатели применяются сразу.

- **Внешний вид**: стиль карточки (три карточки с миниатюрами, миниатюры следуют за языком и фоном), тема, складывать по умолчанию, компактное плавающее окно, язык интерфейса.
- **Ночная вахта**: сначала переключатель «своя конфигурация» отдельной строкой, при включении появляется список конфигураций (переключить, сделать по умолчанию, переименовать, удалить, создать); ниже — четыре строки условий, «автоответ AFK» и список **что сделать по истечении отсчёта** (выключение / перезагрузка / сон / гибернация / блокировка экрана / выход из системы / свой скрипт).
- **Уведомления**: общий переключатель и четыре отдельных (начался отсчёт, скоро выключение, первая блокировка, блокировка снята).
- **Состояние**: текущая блокировка, почему не выключилось в прошлый раз, последние события.

## Частые вопросы

**В: А оно не выключит компьютер по ошибке?**
О: Конфигурация по умолчанию требует одновременного выполнения четырёх условий — «все сессии свободны», «нет фоновых задач», «в этой партии не было ошибок» и «вы сами взвели карточку»; нарушение любого из них отменяет или пропускает запуск, а вручную остановленная вами задача уже исключена.

**В: Я взвёл, но выключения не было.**
О: Откройте «Состояние» → «почему не выключилось в прошлый раз» — там названа причина (фоновые задачи, ошибки, не взведено и т. п.).

**В: Можно передумать во время отсчёта?**
О: Да — нажмите «отменить выключение» на карточке. После отмены в этом раунде **не будет отправлено ни одной команды**, а карточка остаётся взведённой для следующей партии; отправленную команду отозвать уже нельзя.

**В: Поменял настройку, ничего не произошло.**
О: И хост, и клиентский бандл загружаются только при старте DSH; HMR для локально подключённых плагинов не работает.

**В: Поддерживаются ли macOS и Linux?**
О: Windows проверен полностью. macOS и Linux реализованы, но на реальных машинах пока не тестировались — сейчас они в **закрытой бете**.

## Подробнее

Технические детали вынесены в отдельные файлы (на английском): [архитектура и условия](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.en.md) · [ключи конфигурации](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/CONFIG.en.md) · [локальная разработка](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/DEVELOPING.en.md) · [гид по бете](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/BETA.en.md)

## Лицензия

[MIT](LICENSE)
