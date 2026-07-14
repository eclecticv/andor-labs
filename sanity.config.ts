import {defineConfig} from "sanity";
import {structureTool} from "sanity/structure";
import {schemaTypes} from "./sanity/schemaTypes";

export default defineConfig({
  name: "andorlabs",
  title: "And/or Labs",
  projectId: "2b9cfqwh",
  dataset: "production",
  plugins: [structureTool()],
  schema: {types: schemaTypes},
});
