# Waffle Baffle

I want to create a puzzle called "Waffle Baffle". It is essentially about utilizing the waffle diagram and asking the users to figure out which category is shaded more. But I want to use the theme of waffles and various toppings.

So here's how I want you to set it up:

Generate a square grid of size 10x10 (users can also change the size to 15x15, 20x20 and 25x25). Let's call this grid size LxL for now.

Then add the texture of this grid to look like a waffle.

Now let X1 be an integer randomly chosen between 53% * L and 58% * L inclusive.

Let X2 = L^2 - X1.

We randomly pick X1 number of cells in this square grid by a tan colour that represents peanut butter, and randomly the remaining X2 number of cells by a red color that represents strawberry jam.

We then ask the users to figure out which toppings is used more on the waffle.

Users are allowed to repeat this game an unlimited number of times.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://waffle-baffle.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/71e6c377-392a-43cd-8148-361ddefda375).

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
