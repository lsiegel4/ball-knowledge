import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Restrained azure accent — the single pop against near-black.
const azure: MantineColorsTuple = [
  "#eaf3ff",
  "#d3e4ff",
  "#a3c6ff",
  "#71a7ff",
  "#5e9eff",
  "#4d84e6",
  "#3f6ec2",
  "#31579e",
  "#22417a",
  "#132b57",
];

// Custom near-black ramp so bodies/panels/borders match the minimal-dark spec
// instead of Mantine's default blue-grey darks.
const ink: MantineColorsTuple = [
  "#ececee", // 0  text
  "#c9c9cd", // 1
  "#9a9aa0", // 2
  "#7a7a80", // 3  muted text
  "#2f2f34", // 4  strong border
  "#232327", // 5  line
  "#131315", // 6  panel / elevated surface
  "#0b0b0c", // 7  body background
  "#08080a", // 8
  "#050506", // 9
];

export const theme = createTheme({
  primaryColor: "azure",
  primaryShade: 4,
  colors: { azure, dark: ink },
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  defaultRadius: "md",
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontWeight: "300", fontSize: "1.9rem" },
      h3: { fontWeight: "400" },
    },
  },
  cursorType: "pointer",
});
