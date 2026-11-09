# Stealth School Escape

Напиши первую часть кода (или подготовь структуру) для 3D браузерной игры от первого лица на Three.js и HTML5 Canvas/JavaScript.

Название игры: "Побег пацана: Стелс школьник" (Stealth Boy Escape).

### 1. Концепция и Сюжет

- Игрок — школьник, запертый дома за плохие оценки. Задача: скрытно исследовать дом, собирать предметы и искать способ сбежать.

- В доме есть НПС (Мама / Папа), патрулирующие комнаты и регулярно проверяющие, находится ли игрок в своей комнате за рабочим столом.

- Графика: Low-poly 3D от первого лица (First-Person View), управление мышей через PointerLockControls.

### 2. Выбор Сложности (Difficulty Levels)

В главном меню игроку предлагается выбор сложности:

- Легкий (Easy): Проверка комнаты каждые 60 секунд, предупреждение за 10 сек, сниженное зрение ИИ.

- Нормальный (Normal): Проверка каждые 35–40 секунд, предупреждение за 5 сек, стандартные параметры.

- Хардкор (Hardcore): Случайные проверки каждые 15–30 секунд, бесшумные шаги, шанс 35% того, что родители заглянут под кровать или в шкаф при проверке.

### 3. Механика Проверок и Реакция на Отсутствие

- Таймер проверки: Когда приходит время проверки, проигрывается аудио/текстовое предупреждение ("Иду проверять уроки!").

- Успех: Игрок должен успеть прибежать в комнату и сесть за письменный стол/лечь на кровать.

- Тревога: Если родитель заходит в комнату, а игрока нет — включается режим «ТРЕВОГА». Родитель начинает бегать по всему дому и искать игрока до поимки.

### 4. Управление и Стелс

- WASD — ходьба, Shift — бег, Space — прыжок, C / Ctrl — присесть (бесшумный стелс).

- Индикатор шума: Бег привлекает внимание сразу; ходьба — средне; приседание — бесшумно.

- Укрытия: Шкафы, место под кроватью, коробки.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e68c9e75-1a2a-4f7b-a2b2-f325cba3b694).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
