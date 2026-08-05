export type ColorGroupId =
  | "red"
  | "orange"
  | "green"
  | "purple"
  | "brown"
  | "white"
  | "dark";

export type ColorGroup = {
  id: ColorGroupId;
  label: string;
  /** css var names defined in styles.css */
  fill: string;
  stroke: string;
  on: string;
  toppings: string[];
};

export const COLOR_GROUPS: ColorGroup[] = [
  {
    id: "red",
    label: "red",
    fill: "var(--topping-red)",
    stroke: "var(--topping-red-deep)",
    on: "var(--topping-red-on)",
    toppings: [
      "Fresh raspberries",
      "Pomegranate seeds",
      "Strawberry compote",
      "Cherry jam",
      "Cranberry jam",
      "Sliced plums",
    ],
  },
  {
    id: "orange",
    label: "orange",
    fill: "var(--topping-orange)",
    stroke: "var(--topping-orange-deep)",
    on: "var(--topping-orange-on)",
    toppings: [
      "Diced mango",
      "Apricot preserves",
      "Papaya chunks",
      "Orange zest",
      "Persimmon slices",
      "Sliced bananas",
      "Lemon curd",
      "Pineapple chunks",
      "Passionfruit pulp",
    ],
  },
  {
    id: "green",
    label: "green",
    fill: "var(--topping-green)",
    stroke: "var(--topping-green-deep)",
    on: "var(--topping-green-on)",
    toppings: [
      "Kiwi slices",
      "Mashed avocado",
      "Pumpkin seeds",
      "Chopped pistachios",
      "Fresh mint leaves",
      "Matcha spread",
    ],
  },
  {
    id: "purple",
    label: "purple",
    fill: "var(--topping-purple)",
    stroke: "var(--topping-purple-deep)",
    on: "var(--topping-purple-on)",
    toppings: [
      "Fresh blueberries",
      "Blackberry jam",
      "Acai puree",
      "Boysenberry syrup",
      "Lavender syrup",
    ],
  },
  {
    id: "brown",
    label: "tan",
    fill: "var(--topping-brown)",
    stroke: "var(--topping-brown-deep)",
    on: "var(--topping-brown-on)",
    toppings: [
      "Maple syrup",
      "Creamy peanut butter",
      "Almond butter",
      "Toasted pecans",
      "Crushed walnuts",
      "Cookie dough",
      "Date syrup",
      "Cinnamon",
    ],
  },
  {
    id: "white",
    label: "white",
    fill: "var(--topping-white)",
    stroke: "var(--topping-white-deep)",
    on: "var(--topping-white-on)",
    toppings: [
      "Coconut whipped cream",
      "Oat yogurt",
      "Powdered sugar",
      "Macadamia nuts",
      "Cashew cream",
      "Toasted coconut flakes",
    ],
  },
  {
    id: "dark",
    label: "dark",
    fill: "var(--topping-dark)",
    stroke: "var(--topping-dark-deep)",
    on: "var(--topping-dark-on)",
    toppings: [
      "Dark chocolate chips",
      "Cacao nibs",
      "Black chia seeds",
      "Blackstrap molasses",
      "Poppy seeds",
    ],
  },
];
