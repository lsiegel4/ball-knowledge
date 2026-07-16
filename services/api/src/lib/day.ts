// "Today" in Eastern time as YYYY-MM-DD. en-CA locale formats as ISO date.
// Timezone-aware so the daily boundary is midnight ET regardless of server region.
export const todayET = (d: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
