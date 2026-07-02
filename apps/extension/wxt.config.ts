import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "refynr — spreadsheet quality",
    description:
      "Non-destructive spreadsheet cleansing: paste data, get a health score, review every change, copy the cleaned result back.",
    permissions: ["sidePanel", "clipboardWrite"],
    action: {
      default_title: "Open refynr",
    },
  },
});
