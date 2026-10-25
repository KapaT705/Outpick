# Dota mid helper

Инструменты для роста винрейта на миде. Данные берутся из Stratz API (токен в `.env`).

## Запуск сайта
```bash
cd web && npm run dev
```
Открыть http://localhost:3000

## Обновление данных (мета, матчапы, твой пул)
```bash
node scripts/refresh-data.mjs
```

## Структура
- `web/` — сайт (Next.js): драфт-помощник
- `data/` — кэш данных Stratz в JSON
- `scripts/refresh-data.mjs` — обновление `data/`
- `analysis/` — разовые скрипты и отчёты разбора статистики

## Приложение для Windows / macOS (папка `desktop/`)
Electron-оболочка вокруг того же сайта: внутри запускается автономная сборка Next на случайном локальном порту.
```bash
cd desktop && npm install
npm run build:win   # установщик и портативная версия в desktop/dist
npm run build:mac   # dmg для проверки на Маке
```
- Данные Stratz (`data/*.json`) копируются в ресурсы приложения при сборке.
- Журнал драфтов и настройки (токен Stratz, Steam ID) хранятся в папке пользователя: Windows `%APPDATA%\Dota Mid Helper`, macOS `~/Library/Application Support/Dota Mid Helper`. Задаются на странице «Настройки» внутри приложения.
- Сборка не подписана: Windows при первом запуске покажет предупреждение SmartScreen («Подробнее» → «Выполнить в любом случае»).
